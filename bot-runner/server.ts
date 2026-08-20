// Bot-Runner: holt Läufe aus der Queue und arbeitet die Schritte im Browser ab.
// Läuft als eigener Dienst (Node.js + Playwright), NICHT im Worker/Portal.
//
//   npm install && npx playwright install chromium
//   SUPABASE_URL=… SERVICE_ROLE_KEY=… npm start

import { createClient } from "@supabase/supabase-js";
import { chromium, type Page } from "playwright";

console.log(`[${new Date().toISOString()}] Runner-Modul geladen`);

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const POLL_MS = Number(process.env.POLL_MS ?? 5000);
const HEADLESS = process.env.HEADLESS !== "false";
const WORKER_NAME = process.env.WORKER_NAME ?? `runner-${process.pid}`;
// Ohne Proxy startet standardmäßig kein Lauf (REQUIRE_PROXY=false zum Testen).
const REQUIRE_PROXY = process.env.REQUIRE_PROXY !== "false";

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("SUPABASE_URL und SERVICE_ROLE_KEY bzw. SUPABASE_SERVICE_ROLE_KEY müssen gesetzt sein.");
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

interface Step {
  action: "goto" | "fill" | "click" | "select" | "wait" | "screenshot" | "advance" | "extract" | "handoff";
  selector?: string;
  value?: string;
  pattern?: string;
  label?: string;
  optional?: boolean;
  timeout?: number;
}

interface Run {
  id: string;
  profile_id: string;
  assignment_id?: string | null;
  proxy_id?: string | null;
  proxy_session?: string | null;
  input_data: Record<string, string>;
  credentials: Record<string, string>;
  log: { at: string; msg: string }[];
}

/** Ersetzt {{platzhalter}} durch Lauf-Daten. */
function render(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (_m, key) => vars[key] ?? "");
}

async function appendLog(runId: string, current: Run["log"], msg: string) {
  const log = [...current, { at: new Date().toISOString(), msg }].slice(-200);
  await db.from("bot_runs").update({ log }).eq("id", runId);
  console.log(`[${runId}] ${msg}`);
  return log;
}

async function runSteps(page: Page, run: Run, steps: Step[]) {
  const vars = { ...run.input_data, ...run.credentials };
  let log = run.log ?? [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (!step) continue;
    const timeout = step.timeout ?? 20000;
    const selector = step.selector ? render(step.selector, vars) : "";
    const value = step.value ? render(step.value, vars) : "";

    await db.from("bot_runs").update({ current_step: i + 1 }).eq("id", run.id);

    try {
      switch (step.action) {
        case "goto":
          await page.goto(value, { waitUntil: "domcontentloaded", timeout });
          break;
        case "fill":
          await page.fill(selector, value, { timeout });
          break;
        case "click":
          await page.click(selector, { timeout });
          break;
        case "select":
          await page.selectOption(selector, value, { timeout });
          break;
        case "wait":
          if (selector) await page.waitForSelector(selector, { timeout });
          else await page.waitForTimeout(Number(value) || 1000);
          break;
        case "screenshot": {
          const buf = await page.screenshot({ fullPage: false });
          const path = `bot-runs/${run.id}/${Date.now()}.png`;
          await db.storage.from("documents").upload(path, buf, { contentType: "image/png" });
          await db.from("bot_runs").update({ screenshot_path: path }).eq("id", run.id);
          break;
        }
        case "advance": {
          const maxClicks = Math.min(Math.max(Number(value) || 8, 1), 15);
          for (let clickIndex = 0; clickIndex < maxClicks; clickIndex++) {
            const bodyText = await page.locator("body").innerText({ timeout });
            if (/(Vorgangsnummer|Antragsnummer|Referenznummer|Vorgangs-ID|\bTID\b)/i.test(bodyText)) break;
            if (/(VideoIdent|PostIdent|Legitimation|Identifizierung|Ausweis.*(?:prüfen|hochladen)|photoTAN)/i.test(bodyText)) break;

            const next = page.getByRole("button", {
              name: /^(Weiter|Fortfahren|Bestätigen|Antrag absenden|Konto eröffnen|Jetzt eröffnen)$/i,
            }).or(page.getByRole("link", {
              name: /^(Weiter|Fortfahren|Bestätigen|Antrag absenden|Konto eröffnen|Jetzt eröffnen)$/i,
            })).first();
            if (!await next.isVisible().catch(() => false)) break;
            await next.click({ timeout });
            await page.waitForLoadState("domcontentloaded", { timeout }).catch(() => undefined);
            await page.waitForTimeout(800);
          }
          break;
        }
        case "extract": {
          const source = selector
            ? await page.locator(selector).first().innerText({ timeout })
            : await page.locator("body").innerText({ timeout });
          const pattern = step.pattern || step.value || "(?:Vorgangsnummer|Antragsnummer|Referenznummer|TID)\\s*[:#-]?\\s*([A-Z0-9][A-Z0-9./_-]{4,})";
          const match = source.match(new RegExp(pattern, "i"));
          const caseNumber = String(match?.[1] ?? match?.[0] ?? "").trim();
          if (!caseNumber) {
            const buf = await page.screenshot({ fullPage: false });
            const path = `bot-runs/${run.id}/case-number-missing-${Date.now()}.png`;
            await db.storage.from("documents").upload(path, buf, { contentType: "image/png" });
            await db.from("bot_runs").update({
              status: "waiting_admin",
              handoff_reason: "Kontoeröffnung erreicht, aber Vorgangsnummer nicht automatisch erkannt. Bitte Screenshot und Seite prüfen.",
              handoff_url: page.url(),
              screenshot_path: path,
            }).eq("id", run.id);
            await appendLog(run.id, log, "Vorgangsnummer nicht erkannt – Übergabe an Admin");
            return "handoff" as const;
          }
          await db.from("bot_runs").update({ vorgangsnummer: caseNumber }).eq("id", run.id);
          if (run.assignment_id) {
            await db.from("task_assignments").update({
              individual_case_number: caseNumber,
              updated_at: new Date().toISOString(),
            }).eq("id", run.assignment_id);
          }
          vars.vorgangsnummer = caseNumber;
          log = await appendLog(run.id, log, `Vorgangsnummer erkannt: ${caseNumber}`);
          break;
        }
        case "handoff": {
          const buf = await page.screenshot({ fullPage: false });
          const path = `bot-runs/${run.id}/handoff-${Date.now()}.png`;
          await db.storage.from("documents").upload(path, buf, { contentType: "image/png" });
          await db.from("bot_runs").update({
            status: "waiting_admin",
            handoff_reason: step.label ?? "Manueller Schritt erforderlich",
            handoff_url: page.url(),
            screenshot_path: path,
          }).eq("id", run.id);
          await appendLog(run.id, log, `Übergabe an Admin: ${step.label ?? "manueller Schritt"}`);
          return "handoff" as const;
        }
      }
      log = await appendLog(run.id, log, `Schritt ${i + 1}/${steps.length} ok: ${step.label ?? step.action}`);
    } catch (err: any) {
      if (step.optional) {
        log = await appendLog(run.id, log, `Schritt ${i + 1} übersprungen (optional): ${err.message}`);
        continue;
      }
      throw new Error(`Schritt ${i + 1} (${step.action}) fehlgeschlagen: ${err.message}`);
    }
  }
  return "done" as const;
}

async function processOne(): Promise<boolean> {
  // Debug-Log für Polling (nur lokal/journal)
  console.log(`[${new Date().toISOString()}] Polling queue...`);
  
  const { data: claimed, error } = await db.rpc("bot_claim_next_run", { _worker: WORKER_NAME });
  if (error) { 
    console.error("Fehler beim Abrufen aus der Queue (RPC):", error.message); 
    return false; 
  }
  
  const run = (Array.isArray(claimed) ? claimed[0] : claimed) as Run | undefined;
  if (!run) return false;
  
  console.log(`[${run.id}] Lauf gestartet (Profil: ${run.profile_id})`);

  const { data: profile } = await db
    .from("bot_profiles").select("steps").eq("id", run.profile_id).single();
  const steps = (profile?.steps ?? []) as Step[];

  // Proxy laden – jeder Lauf geht über eine eigene IP.
  let proxy: { server: string; username?: string; password?: string } | undefined;
  if (run.proxy_id) {
    const { data: p } = await db
      .from("bot_proxies")
      .select("kind, host, port, username, password")
      .eq("id", run.proxy_id).maybeSingle();
    if (p) {
      const scheme = p.kind === "socks5" ? "socks5" : "http";
      proxy = { server: `${scheme}://${p.host}:${p.port}` };
      // Chromium unterstützt bei SOCKS5 keine Benutzer/Passwort-Anmeldung.
      if (scheme === "http" && p.username) {
        proxy.username = p.username;
        proxy.password = p.password ?? undefined;
      }
    }
  }
  if (REQUIRE_PROXY && !proxy) {
    await db.from("bot_runs").update({
      status: "failed",
      last_error: "Kein Proxy verfügbar – Lauf abgebrochen.",
      finished_at: new Date().toISOString(),
    }).eq("id", run.id);
    return true;
  }

  const browser = await chromium.launch({ headless: HEADLESS, ...(proxy ? { proxy } : {}) });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    locale: "de-DE",
    timezoneId: "Europe/Berlin",
  });
  const page = await context.newPage();

  try {
    const result = await runSteps(page, run, steps);
    if (result === "done") {
      await db.from("bot_runs").update({
        status: "done", finished_at: new Date().toISOString(),
      }).eq("id", run.id);
    }
  } catch (err: any) {
    await db.from("bot_runs").update({
      status: "failed",
      last_error: String(err?.message ?? err).slice(0, 1000),
      finished_at: new Date().toISOString(),
    }).eq("id", run.id);
    console.error(`[${run.id}] fehlgeschlagen:`, err?.message ?? err);
  } finally {
    await browser.close();
  }
  return true;
}

console.log(`[${new Date().toISOString()}] Bot-Runner gestartet (Poll ${POLL_MS}ms, headless=${HEADLESS}, worker=${WORKER_NAME})`);

// Hauptschleife
async function mainLoop() {
  for (;;) {
    let worked = false;
    try {
      worked = await processOne();
    } catch (err) {
      console.error("Runner-Fehler in Hauptschleife:", err);
    }
    // Wenn nichts zu tun war, kurz warten. Wenn ein Lauf verarbeitet wurde, sofort weitermachen.
    if (!worked) {
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
  }
}

mainLoop().catch(err => {
  console.error("FATAL: Bot-Runner Hauptschleife abgebrochen:", err);
  process.exit(1);
});