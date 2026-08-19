// Serverseitiger Neuaufbau + Versand der Eingangsbestätigung.
// Wird ausschließlich aus application-received-resend.functions.ts geladen.

type Result = { ok: boolean; reason?: string; to?: string };

function portalBaseFromDomain(domain: unknown): string | null {
  const clean = String(domain ?? "").trim()
    .replace(/^https?:\/\//, "").replace(/\/+$/, "").replace(/^portal\./, "");
  return clean ? `https://portal.${clean}` : null;
}

const isOpaqueKey = (k: string) => k.startsWith("sb_publishable_") || k.startsWith("sb_secret_");

export async function resendApplicationReceivedMail(applicationId: string): Promise<Result> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: app, error } = await supabaseAdmin
    .from("applications")
    .select("id, full_name, first_name, last_name, email, tenant_id, source_landing_id, target_landing_id, magic_token, magic_token_expires_at")
    .eq("id", applicationId)
    .maybeSingle();
  if (error || !app) return { ok: false, reason: error?.message ?? "Bewerbung nicht gefunden" };
  const a = app as any;
  if (!a.email) return { ok: false, reason: "Keine E-Mail-Adresse hinterlegt" };
  if (!a.tenant_id) return { ok: false, reason: "Kein Mandant an der Bewerbung hinterlegt" };

  // ---- Portal-Basis ermitteln (immer Fast-Track-Portal, nie Vermittlung) ----
  let portalBase: string | null = null;
  let sourceIsBroker = false;
  // 1) Aktuelle Verknüpfung der Vermittlungs-Landing hat Vorrang (Admins können sie ändern).
  if (a.source_landing_id) {
    const { data: src } = await supabaseAdmin
      .from("landing_pages").select("flow_type, linked_fasttrack_landing_id")
      .eq("id", a.source_landing_id).maybeSingle();
    sourceIsBroker = (src as any)?.flow_type === "broker";
    const linkedId = (src as any)?.linked_fasttrack_landing_id;
    if (linkedId) {
      const { data: ft } = await supabaseAdmin
        .from("landing_pages").select("domain, flow_type").eq("id", linkedId).maybeSingle();
      if ((ft as any)?.flow_type !== "broker") portalBase = portalBaseFromDomain((ft as any)?.domain);
    }
  }
  // 2) Gespeicherte Ziel-Landing.
  if (!portalBase && a.target_landing_id) {
    const { data: lp } = await supabaseAdmin
      .from("landing_pages").select("domain, flow_type").eq("id", a.target_landing_id).maybeSingle();
    if ((lp as any)?.flow_type !== "broker") portalBase = portalBaseFromDomain((lp as any)?.domain);
  }
  // 3) Tenant-Domain nur, wenn die Bewerbung NICHT über eine Vermittlungsseite kam —
  //    sonst würde der Link auf die Vermittlungs-Domain ohne Portal zeigen.
  if (!portalBase && !sourceIsBroker) {
    const { data: t } = await supabaseAdmin
      .from("tenants").select("primary_domain, domain").eq("id", a.tenant_id).maybeSingle();
    portalBase = portalBaseFromDomain((t as any)?.primary_domain ?? (t as any)?.domain);
  }
  if (!portalBase) {
    return {
      ok: false,
      reason: sourceIsBroker
        ? "Keine Fast-Track-Seite mit der Vermittlungsseite verknüpft — bitte Verknüpfung setzen"
        : "Keine Portal-Domain für diesen Mandanten hinterlegt",
    };
  }

  // ---- Buchungslink neu aufbauen, wenn ein interner Kalender aktiv ist ----
  let bookingLink: string | null = null;
  const candidates = [a.target_landing_id, a.source_landing_id].filter(Boolean) as string[];
  if (candidates.length) {
    const { data: schedules } = await supabaseAdmin
      .from("availability_schedules")
      .select("id, landing_page_id, landing_pages!inner(booking_mode)")
      .in("landing_page_id", candidates)
      .eq("active", true)
      .eq("landing_pages.booking_mode", "internal");
    const hasSchedule = candidates.some((id) => (schedules as any[] | null)?.some((s) => s.landing_page_id === id));
    if (hasSchedule) {
      const valid = a.magic_token
        && (!a.magic_token_expires_at || new Date(a.magic_token_expires_at) > new Date());
      let token: string = valid ? a.magic_token : crypto.randomUUID().replace(/-/g, "");
      if (!valid) {
        await supabaseAdmin.from("applications").update({
          magic_token: token, magic_token_expires_at: null, booking_status: "pending",
        } as any).eq("id", a.id);
      }
      bookingLink = `${portalBase}/termin/buchen/${token}`;
    }
  }

  const actionLink = bookingLink || portalBase;
  const parts = String(a.full_name ?? "").trim().split(/\s+/);
  const firstName = a.first_name || parts[0] || "";
  const lastName = a.last_name || parts.slice(1).join(" ");

  const supabaseUrl = (process.env['SUPABASE_URL'] ?? process.env['API_EXTERNAL_URL'] ?? "").replace(/\/+$/, "");
  const serviceKey = process.env['SUPABASE_SERVICE_ROLE_KEY'] ?? process.env['SERVICE_ROLE_KEY'] ?? "";
  if (!supabaseUrl || !serviceKey) return { ok: false, reason: "Mail-Dienst ist nicht konfiguriert" };

  const headers: Record<string, string> = { "Content-Type": "application/json", apikey: serviceKey };
  if (!isOpaqueKey(serviceKey)) headers.Authorization = `Bearer ${serviceKey}`;

  const body = {
    to: a.email,
    fullName: a.full_name,
    firstName,
    lastName,
    registrationLink: actionLink,
    tenantId: a.tenant_id,
    templateName: "application_received",
    applicationId: a.id,
    requestId: `manual-resend-${Date.now().toString(36)}`,
    placeholders: { calendly_link: bookingLink ?? "", booking_link: bookingLink ?? "" },
  };

  // Gateway-Aussetzer sind keine Mailfehler → kurz erneut versuchen.
  const GATEWAY = new Set([502, 503, 504, 520, 521, 522, 524]);
  const delays = [1500, 4000];
  let last: Result = { ok: false, reason: "Mail-Dienst nicht erreichbar" };
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/send-invitation-email`, {
        method: "POST", headers, body: JSON.stringify(body),
      });
      const text = await res.text();
      let parsed: any = null;
      try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
      if (res.ok && !parsed?.error) return { ok: true, to: a.email };
      const reason = parsed?.error
        ? String(parsed.error)
        : `Mail-Dienst antwortete mit ${res.status} – bitte in ein paar Minuten erneut versuchen`;
      last = { ok: false, reason: reason.slice(0, 300) };
      if (GATEWAY.has(res.status) && attempt < delays.length) {
        await new Promise((r) => setTimeout(r, delays[attempt]));
        continue;
      }
      return last;
    } catch (e: any) {
      last = { ok: false, reason: String(e?.message ?? e).slice(0, 300) };
      if (attempt < delays.length) {
        await new Promise((r) => setTimeout(r, delays[attempt]));
        continue;
      }
    }
  }
  return last;
}
