// Bot-Automatisierung: Profile verwalten und Läufe in die Queue stellen.
// Der eigentliche Browser-Bot läuft als separater Dienst (bot-runner/).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function requireAdmin(ctx: { supabase: any; userId: string }) {
  const { data, error } = await ctx.supabase
    .from("user_roles").select("role")
    .eq("user_id", ctx.userId).eq("role", "admin").maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Nicht autorisiert");
}

/** Ein Schritt der Bot-Ablaufsteuerung. */
const StepSchema = z.object({
  action: z.enum(["goto", "fill", "click", "select", "wait", "screenshot", "handoff"]),
  selector: z.string().max(400).optional(),
  value: z.string().max(1000).optional(),
  label: z.string().max(160).optional(),
  optional: z.boolean().optional(),
  timeout: z.number().int().min(500).max(120000).optional(),
});

export type BotStep = z.infer<typeof StepSchema>;

export interface BotProfileRow {
  id: string;
  tenant_id: string | null;
  partner_company_id: string | null;
  name: string;
  provider_key: string;
  start_url: string;
  description: string | null;
  handoff_note: string | null;
  steps: BotStep[];
  is_active: boolean;
  created_at: string;
}

export interface BotRunRow {
  id: string;
  profile_id: string;
  tenant_id: string | null;
  user_id: string | null;
  assignment_id: string | null;
  vorgangsnummer: string | null;
  status: string;
  current_step: number;
  total_steps: number;
  credentials: Record<string, string>;
  input_data: Record<string, string>;
  log: { at: string; msg: string }[];
  handoff_reason: string | null;
  handoff_url: string | null;
  screenshot_path: string | null;
  last_error: string | null;
  claimed_by: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}

export const listBotProfiles = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ rows: BotProfileRow[] }> => {
    await requireAdmin(context);
    const db = context.supabase as any;
    const { data, error } = await db
      .from("bot_profiles").select("*").order("name", { ascending: true });
    if (error) throw new Error(error.message);
    return { rows: (data ?? []) as BotProfileRow[] };
  });

const SaveProfileInput = z.object({
  id: z.string().uuid().optional(),
  tenant_id: z.string().uuid().nullable().optional(),
  partner_company_id: z.string().uuid().nullable().optional(),
  name: z.string().min(1).max(160),
  provider_key: z.string().min(1).max(60).regex(/^[a-z0-9_]+$/, "Nur Kleinbuchstaben, Ziffern und _"),
  start_url: z.string().url().max(500),
  description: z.string().max(2000).optional().default(""),
  handoff_note: z.string().max(2000).optional().default(""),
  steps: z.array(StepSchema).max(120),
  is_active: z.boolean().optional().default(true),
});

export const saveBotProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => SaveProfileInput.parse(i))
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    await requireAdmin(context);
    const db = context.supabase as any;
    const payload = {
      tenant_id: data.tenant_id || null,
      partner_company_id: data.partner_company_id || null,
      name: data.name,
      provider_key: data.provider_key,
      start_url: data.start_url,
      description: data.description || null,
      handoff_note: data.handoff_note || null,
      steps: data.steps,
      is_active: data.is_active ?? true,
    };
    if (data.id) {
      const { error } = await db.from("bot_profiles").update(payload).eq("id", data.id);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }
    const { data: row, error } = await db
      .from("bot_profiles")
      .insert({ ...payload, created_by: context.userId })
      .select("id").single();
    if (error) throw new Error(error.message);
    return { id: String(row.id) };
  });

export const deleteBotProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }): Promise<{ ok: boolean }> => {
    await requireAdmin(context);
    const db = context.supabase as any;
    const { error } = await db.from("bot_profiles").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listBotRuns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ rows: BotRunRow[] }> => {
    await requireAdmin(context);
    const db = context.supabase as any;
    const { data, error } = await db
      .from("bot_runs").select("*")
      .order("created_at", { ascending: false }).limit(200);
    if (error) throw new Error(error.message);
    return { rows: (data ?? []) as BotRunRow[] };
  });

const EnqueueInput = z.object({
  profile_id: z.string().uuid(),
  user_id: z.string().uuid().nullable().optional(),
  assignment_id: z.string().uuid().nullable().optional(),
  vorgangsnummer: z.string().max(60).optional().default(""),
  input_data: z.record(z.string(), z.string().max(500)).optional().default({}),
});

export const enqueueBotRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => EnqueueInput.parse(i))
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    await requireAdmin(context);
    const { createBotRun } = await import("./bots.server");
    return createBotRun(context.supabase as any, context.userId, data);
  });

/** Admin übernimmt einen wartenden Lauf (VideoIdent o. Ä.). */
export const claimBotRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }): Promise<{ ok: boolean }> => {
    await requireAdmin(context);
    const db = context.supabase as any;
    const { error } = await db
      .from("bot_runs")
      .update({ claimed_by: context.userId, claimed_at: new Date().toISOString() })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const SetStatusInput = z.object({
  id: z.string().uuid(),
  status: z.enum(["queued", "waiting_admin", "done", "failed", "cancelled"]),
  note: z.string().max(1000).optional().default(""),
});

/** Admin setzt den Endstatus, nachdem er die manuellen Schritte erledigt hat. */
export const setBotRunStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => SetStatusInput.parse(i))
  .handler(async ({ data, context }): Promise<{ ok: boolean }> => {
    await requireAdmin(context);
    const db = context.supabase as any;
    const terminal = ["done", "failed", "cancelled"].includes(data.status);
    const { error } = await db
      .from("bot_runs")
      .update({
        status: data.status,
        finished_at: terminal ? new Date().toISOString() : null,
        last_error: data.status === "failed" ? (data.note || "Manuell als fehlgeschlagen markiert") : null,
        handoff_reason: data.note || null,
      })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
/* ----------------------------------------------------------- Proxy-Pool */

export interface BotProxyRow {
  id: string;
  label: string | null;
  provider: string;
  kind: string;
  host: string;
  port: number;
  username: string | null;
  country: string | null;
  is_active: boolean;
  last_used_at: string | null;
  use_count: number;
}

/** Liste ohne Passwörter — Zugangsdaten bleiben serverseitig. */
export const listBotProxies = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ rows: BotProxyRow[] }> => {
    await requireAdmin(context);
    const db = context.supabase as any;
    const { data, error } = await db
      .from("bot_proxies")
      .select("id, label, provider, kind, host, port, username, country, is_active, last_used_at, use_count")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { rows: (data ?? []) as BotProxyRow[] };
  });

const ImportProxiesInput = z.object({
  provider: z.string().max(60).optional().default("nsocks"),
  kind: z.enum(["http", "socks5"]).optional().default("http"),
  country: z.string().max(8).optional().default("DE"),
  /** Eine Zeile je Proxy: ip:port:user:pass (auch ip:port erlaubt). */
  raw: z.string().min(3).max(20000),
});

/** Importiert eine Proxy-Liste (z. B. aus dem nsocks-Dashboard). */
export const importBotProxies = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ImportProxiesInput.parse(i))
  .handler(async ({ data, context }): Promise<{ imported: number; skipped: number }> => {
    await requireAdmin(context);
    const db = context.supabase as any;
    const rows: Record<string, unknown>[] = [];
    let skipped = 0;
    for (const line of data.raw.split(/\r?\n/)) {
      const t = line.trim();
      if (!t) continue;
      const parts = t.split(/[:;,\s]+/).filter(Boolean);
      const host = parts[0];
      const port = Number(parts[1]);
      if (!host || !Number.isFinite(port) || port <= 0) { skipped++; continue; }
      rows.push({
        provider: data.provider,
        kind: data.kind,
        country: data.country,
        host,
        port,
        username: parts[2] ?? null,
        password: parts[3] ?? null,
        label: `${data.provider} ${host}:${port}`,
      });
    }
    if (!rows.length) return { imported: 0, skipped };
    const { error } = await db.from("bot_proxies").upsert(rows, { onConflict: "host,port,username" });
    if (error) throw new Error(error.message);
    return { imported: rows.length, skipped };
  });

export const setBotProxyActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid(), is_active: z.boolean() }).parse(i))
  .handler(async ({ data, context }): Promise<{ ok: boolean }> => {
    await requireAdmin(context);
    const db = context.supabase as any;
    const { error } = await db.from("bot_proxies").update({ is_active: data.is_active }).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteBotProxy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }): Promise<{ ok: boolean }> => {
    await requireAdmin(context);
    const db = context.supabase as any;
    const { error } = await db.from("bot_proxies").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* --------------------------------------------- Lauf zu einer Zuweisung */

/** Startet für eine Zuweisung einen echten Bot-Lauf (bleibt bis Freigabe Entwurf). */
export const startRunForAssignment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ assignment_id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }): Promise<{ ok: boolean; run_id?: string; error?: string }> => {
    await requireAdmin(context);
    const { startRunForAssignmentServer } = await import("./bots.server");
    return startRunForAssignmentServer(context.supabase as any, context.userId, data.assignment_id);
  });

/** Aktueller Bot-Lauf einer Zuweisung (für die Statusanzeige). */
export const getRunForAssignment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ assignment_id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }): Promise<{ run: BotRunRow | null }> => {
    await requireAdmin(context);
    const db = context.supabase as any;
    const { data: rows, error } = await db
      .from("bot_runs").select("*")
      .eq("assignment_id", data.assignment_id)
      .order("created_at", { ascending: false }).limit(1);
    if (error) throw new Error(error.message);
    const row = Array.isArray(rows) ? rows[0] : null;
    return { run: (row ?? null) as BotRunRow | null };
  });

/**
 * Freigabe: erst wenn eine echte Vorgangsnummer vorliegt, wird die Zuweisung
 * für den Mitarbeiter sichtbar und er bekommt eine Chat-Info.
 */
export const releaseAssignment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({
    assignment_id: z.string().uuid(),
    case_number: z.string().max(80).optional().default(""),
  }).parse(i))
  .handler(async ({ data, context }): Promise<{ ok: boolean; error?: string }> => {
    await requireAdmin(context);
    const db = context.supabase as any;
    const { data: a, error } = await db
      .from("task_assignments")
      .select("id, user_id, individual_case_number, task_template_id")
      .eq("id", data.assignment_id).single();
    if (error) throw new Error(error.message);

    const caseNumber = data.case_number || a.individual_case_number || "";
    if (!caseNumber) return { ok: false, error: "Ohne Vorgangsnummer keine Freigabe möglich." };

    const { error: uErr } = await db.from("task_assignments").update({
      individual_case_number: caseNumber,
      assignment_group: "manuell",
      status: "zugewiesen",
      updated_at: new Date().toISOString(),
    }).eq("id", a.id);
    if (uErr) throw new Error(uErr.message);

    const { data: tpl } = await db
      .from("task_templates").select("title").eq("id", a.task_template_id).maybeSingle();
    await db.from("chat_messages").insert({
      sender_id: context.userId,
      receiver_id: a.user_id,
      message: `Neuer Auftrag: ${tpl?.title ?? "Auftrag"} – Vorgangsnummer ${caseNumber}. Details findest du im Portal.`,
    });

    return { ok: true };
  });
