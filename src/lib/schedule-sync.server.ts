// Spiegelt Terminplan-Daten zwischen verknüpften Landings
// (Vermittlung ⇄ Fast-Track, via landing_pages.linked_fasttrack_landing_id).
// Ziel: beide Seiten zeigen identische Termine.

type Sb = any;

export async function findPartnerLandingId(supabase: Sb, landingPageId: string | null): Promise<string | null> {
  if (!landingPageId) return null;
  const fwd = await supabase
    .from("landing_pages")
    .select("linked_fasttrack_landing_id")
    .eq("id", landingPageId)
    .maybeSingle();
  if (fwd.data?.linked_fasttrack_landing_id) return fwd.data.linked_fasttrack_landing_id as string;

  const back = await supabase
    .from("landing_pages")
    .select("id")
    .eq("linked_fasttrack_landing_id", landingPageId)
    .limit(1)
    .maybeSingle();
  return (back.data?.id as string) ?? null;
}

async function getSchedule(supabase: Sb, scheduleId: string) {
  const { data, error } = await supabase
    .from("availability_schedules")
    .select("id, tenant_id, landing_page_id, name, timezone, slot_duration_minutes, buffer_before_minutes, buffer_after_minutes, min_notice_hours, max_days_ahead, active")
    .eq("id", scheduleId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

/** Terminplan des Partner-Landings holen oder anlegen. */
async function ensurePartnerSchedule(supabase: Sb, source: any, partnerLandingId: string) {
  const existing = await supabase
    .from("availability_schedules")
    .select("id")
    .eq("landing_page_id", partnerLandingId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  const settings = {
    timezone: source.timezone,
    slot_duration_minutes: source.slot_duration_minutes,
    buffer_before_minutes: source.buffer_before_minutes,
    buffer_after_minutes: source.buffer_after_minutes,
    min_notice_hours: source.min_notice_hours,
    max_days_ahead: source.max_days_ahead,
    active: source.active,
  };

  if (existing.data?.id) {
    const { error } = await supabase
      .from("availability_schedules")
      .update(settings)
      .eq("id", existing.data.id);
    if (error) throw new Error(error.message);
    return existing.data.id as string;
  }

  const { data: ins, error } = await supabase
    .from("availability_schedules")
    .insert({
      ...settings,
      landing_page_id: partnerLandingId,
      tenant_id: source.tenant_id ?? null,
      name: `${source.name} (synchronisiert)`,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return (ins as any).id as string;
}

/**
 * Kopiert Einstellungen, Wochenregeln und Ausnahmen des Schedules auf den
 * Terminplan der verknüpften Landing. Fehler werden bewusst geschluckt bzw.
 * hochgereicht – Aufrufer entscheidet.
 */
export async function mirrorScheduleToPartner(supabase: Sb, scheduleId: string): Promise<string | null> {
  const source = await getSchedule(supabase, scheduleId);
  if (!source?.landing_page_id) return null;

  const partnerLandingId = await findPartnerLandingId(supabase, source.landing_page_id);
  if (!partnerLandingId) return null;

  const targetId = await ensurePartnerSchedule(supabase, source, partnerLandingId);
  if (targetId === scheduleId) return null;

  // Wochenregeln 1:1 übernehmen
  const rules = await supabase
    .from("availability_rules")
    .select("weekday, start_time, end_time")
    .eq("schedule_id", scheduleId);
  if (rules.error) throw new Error(rules.error.message);

  const delRules = await supabase.from("availability_rules").delete().eq("schedule_id", targetId);
  if (delRules.error) throw new Error(delRules.error.message);
  if ((rules.data ?? []).length > 0) {
    const insRules = await supabase.from("availability_rules").insert(
      (rules.data as any[]).map((r) => ({ ...r, schedule_id: targetId })),
    );
    if (insRules.error) throw new Error(insRules.error.message);
  }

  // Ausnahmen (Sperrtage / Sonderzeiten) 1:1 übernehmen
  const exc = await supabase
    .from("availability_exceptions")
    .select("exception_date, is_blocked, start_time, end_time, note")
    .eq("schedule_id", scheduleId);
  if (exc.error) throw new Error(exc.error.message);

  const delExc = await supabase.from("availability_exceptions").delete().eq("schedule_id", targetId);
  if (delExc.error) throw new Error(delExc.error.message);
  if ((exc.data ?? []).length > 0) {
    const insExc = await supabase.from("availability_exceptions").insert(
      (exc.data as any[]).map((e) => ({ ...e, schedule_id: targetId })),
    );
    if (insExc.error) throw new Error(insExc.error.message);
  }

  return targetId;
}
