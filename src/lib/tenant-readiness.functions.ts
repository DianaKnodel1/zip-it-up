import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdmin(ctx: { supabase: any; userId: string }) {
  const { data, error } = await ctx.supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", ctx.userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Nicht autorisiert");
}

async function getSupabaseAdmin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}

export type ReadinessSeverity = "ok" | "warn" | "block";

export type ReadinessCheck = {
  key: string;
  group: "Versand" | "Auftritt" | "Termine" | "Interview" | "Mails" | "Onboarding";
  label: string;
  /** Klartext, was fehlt bzw. warum es passt. */
  detail: string;
  severity: ReadinessSeverity;
  /** Ziel im Admin, wo der Punkt behoben wird. */
  href?: string;
};

export type TenantReadiness = {
  tenant_id: string;
  tenant_name: string;
  passed: number;
  total: number;
  blocking: number;
  warnings: number;
  status: "green" | "yellow" | "red";
  checks: ReadinessCheck[];
};

const CORE_MAIL_FIELDS: Array<[string, string]> = [
  ["application_received_subject", "Bewerbung eingegangen"],
  ["booking_confirmation_subject", "Terminbestätigung"],
  ["reminder_appointment_subject", "Terminerinnerung"],
  ["reminder_app_no_booking_subject", "Kein Termin gebucht"],
  ["reminder_app_no_show_subject", "No-Show"],
  ["welcome_email_subject", "Zusage / Einladung ins Portal"],
  ["reminder_app_registration_subject", "Registrierung unvollständig"],
];

function ok(check: Omit<ReadinessCheck, "severity">): ReadinessCheck {
  return { ...check, severity: "ok" };
}

/**
 * Go-Live-Checkliste je Mandant: prüft ausschließlich echte Daten, keine
 * manuellen Häkchen. „block" = mit diesem Punkt läuft die Bewerberkette nicht,
 * „warn" = funktioniert, sieht aber unfertig aus.
 */
export const getTenantReadiness = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<TenantReadiness[]> => {
    await assertAdmin(context);
    const sb = await getSupabaseAdmin();

    const [{ data: tenants }, { data: landings }, { data: schedules }, { data: templates }, { data: defaultTasks }] =
      await Promise.all([
        sb.from("tenants").select("*").order("name"),
        sb
          .from("landing_pages")
          .select(
            "id,tenant_id,slug,domain,flow_type,is_published,interview_mode,interview_system_prompt,interview_decision_prompt,booking_mode,calendly_url,linked_fasttrack_landing_id",
          ),
        sb.from("availability_schedules").select("id,tenant_id,landing_page_id,timezone,active,min_notice_hours"),
        sb.from("contract_templates").select("tenant_id,employment_type,is_active"),
        sb.from("tenant_default_tasks").select("tenant_id"),
      ]);

    const scheduleIds = (schedules ?? []).map((s: any) => s.id);
    let rulesBySchedule: Record<string, number> = {};
    if (scheduleIds.length) {
      const { data: rules } = await sb.from("availability_rules").select("schedule_id").in("schedule_id", scheduleIds);
      for (const r of rules ?? []) {
        const k = String((r as any).schedule_id);
        rulesBySchedule[k] = (rulesBySchedule[k] ?? 0) + 1;
      }
    }

    const result: TenantReadiness[] = [];

    for (const t of (tenants ?? []) as any[]) {
      const checks: ReadinessCheck[] = [];
      const myLandings = (landings ?? []).filter((l: any) => l.tenant_id === t.id);
      const mySchedules = (schedules ?? []).filter(
        (s: any) => s.tenant_id === t.id || myLandings.some((l: any) => l.id === s.landing_page_id),
      );
      const myTemplates = (templates ?? []).filter((c: any) => c.tenant_id === t.id && c.is_active !== false);
      const allowed: string[] = Array.isArray(t.allowed_employment_types) && t.allowed_employment_types.length
        ? t.allowed_employment_types
        : ["minijob", "teilzeit", "vollzeit"];


      // ---------- Auftritt ----------
      const published = myLandings.filter((l: any) => l.is_published);
      checks.push(
        published.length
          ? ok({ key: "landing", group: "Auftritt", label: "Landingpage veröffentlicht", detail: `${published.length} veröffentlicht (${published.map((l: any) => l.domain || l.slug).join(", ")})`, href: "/admin/landing-generator" })
          : {
              key: "landing",
              group: "Auftritt",
              label: "Landingpage veröffentlicht",
              detail: myLandings.length ? "Seite(n) vorhanden, aber keine davon ist veröffentlicht." : "Für diese Domain existiert keine Landingpage.",
              severity: "block",
              href: "/admin/landing-generator",
            },
      );
      checks.push(
        t.logo_url && t.primary_color
          ? ok({ key: "branding", group: "Auftritt", label: "Logo & Farbe gesetzt", detail: "Branding vollständig.", href: "/admin/tenants" })
          : {
              key: "branding",
              group: "Auftritt",
              label: "Logo & Farbe gesetzt",
              detail: !t.logo_url ? "Kein Logo hinterlegt — Mails und Portal wirken unfertig." : "Keine Primärfarbe gesetzt.",
              severity: "warn",
              href: "/admin/tenants",
            },
      );
      const brokerLandings = myLandings.filter((l: any) => l.flow_type === "broker");
      if (brokerLandings.length) {
        const linked = brokerLandings.filter((l: any) => l.linked_fasttrack_landing_id);
        checks.push(
          linked.length === brokerLandings.length
            ? ok({ key: "broker_link", group: "Auftritt", label: "Vermittlung verknüpft", detail: "Jede Vermittlungsseite zeigt auf eine Fast-Track-Seite.", href: "/admin/landing-generator" })
            : {
                key: "broker_link",
                group: "Auftritt",
                label: "Vermittlung verknüpft",
                detail: `${brokerLandings.length - linked.length} Vermittlungsseite(n) ohne verknüpfte Fast-Track-Seite — Bewerber landen im Nichts.`,
                severity: "block",
                href: "/admin/landing-generator",
              },
        );
      }

      // ---------- Termine ----------
      const activeSchedules = mySchedules.filter((s: any) => s.active !== false);
      const withRules = activeSchedules.filter((s: any) => (rulesBySchedule[String(s.id)] ?? 0) > 0);
      const needsInternalBooking = myLandings.some((l: any) => l.booking_mode !== "calendly");
      if (needsInternalBooking || activeSchedules.length) {
        checks.push(
          withRules.length
            ? ok({ key: "schedule", group: "Termine", label: "Terminkalender aktiv", detail: `${withRules.length} Kalender mit Verfügbarkeiten.`, href: "/admin/verfuegbarkeit" })
            : {
                key: "schedule",
                group: "Termine",
                label: "Terminkalender aktiv",
                detail: activeSchedules.length
                  ? "Kalender vorhanden, aber ohne Verfügbarkeitsregeln — Bewerber sehen keine Termine."
                  : "Kein aktiver Terminkalender angelegt.",
                severity: "block",
                href: "/admin/verfuegbarkeit",
              },
        );
        const badTz = activeSchedules.filter((s: any) => s.timezone !== "Europe/Berlin");
        checks.push(
          badTz.length === 0
            ? ok({ key: "schedule_tz", group: "Termine", label: "Zeitzone Europe/Berlin", detail: "Alle Kalender laufen in deutscher Zeit.", href: "/admin/verfuegbarkeit" })
            : {
                key: "schedule_tz",
                group: "Termine",
                label: "Zeitzone Europe/Berlin",
                detail: `${badTz.length} Kalender mit abweichender Zeitzone (${badTz.map((s: any) => s.timezone).join(", ")}) — Uhrzeiten in Mails weichen ab.`,
                severity: "warn",
                href: "/admin/verfuegbarkeit",
              },
        );
      }
      const calendlyMissing = myLandings.filter((l: any) => l.booking_mode === "calendly" && !l.calendly_url);
      if (calendlyMissing.length) {
        checks.push({
          key: "calendly",
          group: "Termine",
          label: "Calendly-Link hinterlegt",
          detail: `${calendlyMissing.length} Seite(n) nutzen Calendly, haben aber keinen Link.`,
          severity: "block",
          href: "/admin/calendly",
        });
      }

      // ---------- Interview ----------
      const promptSources = myLandings
        .map((l: any) => l.interview_system_prompt)
        .concat([t.ai_system_prompt])
        .filter(Boolean) as string[];
      const hasPrompt = promptSources.length > 0;
      checks.push(
        hasPrompt
          ? ok({ key: "interview_prompt", group: "Interview", label: "Interview-Prompt gesetzt", detail: "Eigener Gesprächs-Prompt hinterlegt (sonst greift der Standard).", href: "/admin/ai-settings" })
          : {
              key: "interview_prompt",
              group: "Interview",
              label: "Interview-Prompt gesetzt",
              detail: "Kein eigener Prompt — es greift der Standard-Prompt. Für die meisten Fälle in Ordnung.",
              severity: "warn",
              href: "/admin/ai-settings",
            },
      );
      const stale = promptSources.filter((p) => /48\s*Stunden|48h/i.test(p));
      if (stale.length) {
        checks.push({
          key: "interview_48h",
          group: "Interview",
          label: "Kein „48-Stunden“-Versprechen",
          detail: "Im Prompt steht noch eine Rückmeldefrist von 48 Stunden — die Zusage kommt aber sofort. Bitte Satz entfernen.",
          severity: "warn",
          href: "/admin/ai-settings",
        });
      }

      // ---------- Mails ----------
      const missingMails = CORE_MAIL_FIELDS.filter(([field]) => !t[field]).map(([, label]) => label);
      checks.push(
        missingMails.length === 0
          ? ok({ key: "mail_templates", group: "Mails", label: "Alle Kernvorlagen befüllt", detail: `${CORE_MAIL_FIELDS.length} Vorlagen vorhanden.`, href: "/admin/email-templates" })
          : {
              key: "mail_templates",
              group: "Mails",
              label: "Alle Kernvorlagen befüllt",
              detail: `Fehlt: ${missingMails.join(", ")} — hier greift der Standardtext ohne eigenes Branding.`,
              severity: "warn",
              href: "/admin/email-templates",
            },
      );

      // ---------- Onboarding ----------
      checks.push(
        t.team_leader_name && t.team_leader_name !== "Teamleiter"
          ? ok({ key: "leader", group: "Onboarding", label: "Ansprechpartner gesetzt", detail: t.team_leader_name, href: "/admin/tenants" })
          : {
              key: "leader",
              group: "Onboarding",
              label: "Ansprechpartner gesetzt",
              detail: "Es steht noch der Platzhalter „Teamleiter“ — Bewerber sehen keinen echten Namen.",
              severity: "warn",
              href: "/admin/tenants",
            },
      );
      const hasTasks = (defaultTasks ?? []).some((d: any) => d.tenant_id === t.id) || Boolean(t.default_task_template_id);
      checks.push(
        hasTasks
          ? ok({ key: "tasks", group: "Onboarding", label: "Standard-Aufgaben gesetzt", detail: "Neue Mitarbeiter bekommen automatisch Aufgaben.", href: "/admin/tasks" })
          : {
              key: "tasks",
              group: "Onboarding",
              label: "Standard-Aufgaben gesetzt",
              detail: "Kein Standard-Aufgabenpaket — neue Mitarbeiter sehen nach der Registrierung ein leeres Portal.",
              severity: "warn",
              href: "/admin/tasks",
            },
      );
      const missingContracts = allowed.filter((a) => !myTemplates.some((c: any) => c.employment_type === a));
      checks.push(
        missingContracts.length === 0
          ? ok({ key: "contracts", group: "Onboarding", label: "Vertragsvorlagen komplett", detail: `Vorlagen für: ${allowed.join(", ")}`, href: "/admin/contracts" })
          : {
              key: "contracts",
              group: "Onboarding",
              label: "Vertragsvorlagen komplett",
              detail: `Keine Vorlage für: ${missingContracts.join(", ")} — Bewerber mit dieser Vertragsart können nicht unterschreiben.`,
              severity: "block",
              href: "/admin/contracts",
            },
      );
      const missingCompany = [
        !t.company_address && "Firmenadresse",
        !t.company_city && "Ort",
        !t.company_ceo_name && "Geschäftsführer",
        !t.company_signature_url && "Firmen-Unterschrift",
      ].filter(Boolean) as string[];
      checks.push(
        missingCompany.length === 0
          ? ok({ key: "company_data", group: "Onboarding", label: "Firmendaten für Vertrag", detail: "Adresse, Ort, Geschäftsführer und Unterschrift hinterlegt.", href: "/admin/tenants" })
          : {
              key: "company_data",
              group: "Onboarding",
              label: "Firmendaten für Vertrag",
              detail: `Fehlt: ${missingCompany.join(", ")} — der erzeugte Vertrag ist unvollständig.`,
              severity: "block",
              href: "/admin/tenants",
            },
      );

      const blocking = checks.filter((c) => c.severity === "block").length;
      const warnings = checks.filter((c) => c.severity === "warn").length;
      result.push({
        tenant_id: t.id,
        tenant_name: t.name,
        passed: checks.filter((c) => c.severity === "ok").length,
        total: checks.length,
        blocking,
        warnings,
        status: blocking > 0 ? "red" : warnings > 0 ? "yellow" : "green",
        checks,
      });
    }

    return result;
  });