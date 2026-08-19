// Server-only Helfer für Bot-Läufe (kein Client-Bundle).

/** Erzeugt ein starkes Passwort ohne verwechselbare Zeichen. */
export function generateBotPassword(): string {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnopqrstuvwxyz";
  const digit = "23456789";
  const sym = "!@#$%&*?";
  const all = upper + lower + digit + sym;
  const pick = (set: string) => set[Math.floor(Math.random() * set.length)]!;
  const chars = [pick(upper), pick(lower), pick(digit), pick(sym)];
  for (let i = 0; i < 12; i++) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }
  return chars.join("");
}

/**
 * Wählt den am längsten unbenutzten aktiven Proxy und erzeugt eine eigene
 * Sticky-Session-Kennung — eine eigene IP je Vorgang.
 */
export async function allocateProxy(db: any): Promise<{ proxy_id: string | null; proxy_session: string }> {
  const session = `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const { data } = await db
    .from("bot_proxies")
    .select("id, use_count")
    .eq("is_active", true)
    .order("last_used_at", { ascending: true, nullsFirst: true })
    .limit(1);
  const proxy = Array.isArray(data) ? data[0] : null;
  if (!proxy) return { proxy_id: null, proxy_session: session };
  await db.from("bot_proxies")
    .update({ last_used_at: new Date().toISOString(), use_count: (proxy.use_count ?? 0) + 1 })
    .eq("id", proxy.id);
  return { proxy_id: String(proxy.id), proxy_session: session };
}

export interface CreateRunInput {
  profile_id: string;
  user_id?: string | null;
  assignment_id?: string | null;
  vorgangsnummer?: string;
  input_data?: Record<string, string>;
}

/** Legt einen Lauf in der Queue an. */
export async function createBotRun(db: any, createdBy: string, input: CreateRunInput): Promise<{ id: string }> {
  const { data: profile, error: pErr } = await db
    .from("bot_profiles")
    .select("id, tenant_id, steps, is_active, name")
    .eq("id", input.profile_id).single();
  if (pErr) throw new Error(pErr.message);
  if (!profile.is_active) throw new Error("Bot-Profil ist deaktiviert");

  let base: Record<string, string> = {};
  if (input.user_id) {
    const { data: prof } = await db
      .from("profiles")
      .select("full_name, street, house_number, postal_code, city, birth_date, phone")
      .eq("user_id", input.user_id).maybeSingle();
    if (prof) {
      const parts = String(prof.full_name ?? "").trim().split(/\s+/);
      base = {
        first_name: parts[0] ?? "",
        last_name: parts.slice(1).join(" "),
        street: [prof.street, prof.house_number].filter(Boolean).join(" "),
        zip: prof.postal_code ?? "",
        city: prof.city ?? "",
        birth_date: prof.birth_date ?? "",
        phone: prof.phone ?? "",
      };
    }
  }

  const { data: row, error } = await db
    .from("bot_runs")
    .insert({
      profile_id: profile.id,
      tenant_id: profile.tenant_id,
      user_id: input.user_id || null,
      assignment_id: input.assignment_id || null,
      vorgangsnummer: input.vorgangsnummer || null,
      status: "queued",
      current_step: 0,
      total_steps: Array.isArray(profile.steps) ? profile.steps.length : 0,
      handoff_reason: "Der Bot startet die Antragsstrecke. Er stoppt automatisch, sobald die Vorgangsnummer angezeigt wird oder die Legitimation (VideoIdent/TAN) beginnt.",
      input_data: { ...base, ...(input.input_data ?? {}) },
      credentials: { password: generateBotPassword(), generated_at: new Date().toISOString() },
      ...(await allocateProxy(db)),
      created_by: createdBy,
    })
    .select("id").single();
  if (error) throw new Error(error.message);
  return { id: String(row.id) };
}

/** Ermittelt das Bot-Profil zu einer Auftragsvorlage. */
export async function resolveProfileForTemplate(db: any, templateId: string): Promise<string | null> {
  const { data: tpl } = await db
    .from("task_templates").select("title, bot_profile_id").eq("id", templateId).maybeSingle();
  if (!tpl) return null;
  if (tpl.bot_profile_id) return String(tpl.bot_profile_id);
  const title = String(tpl.title ?? "").toLowerCase();
  const map: [RegExp, string][] = [
    [/dkb/, "dkb"],
    [/deutsche\s*bank/, "deutsche_bank"],
    [/consors/, "consorsbank"],
    [/comdirect/, "comdirect"],
    [/santander/, "santander"],
  ];
  const hit = map.find(([re]) => re.test(title));
  if (!hit) return null;
  const { data: prof } = await db
    .from("bot_profiles").select("id").eq("provider_key", hit[1]).eq("is_active", true).limit(1);
  const row = Array.isArray(prof) ? prof[0] : null;
  return row ? String(row.id) : null;
}

/**
 * Startet einen Lauf für eine Zuweisung. Der Auftrag bleibt bis zur Freigabe
 * im Entwurf und ist damit für den Mitarbeiter unsichtbar.
 */
export async function startRunForAssignmentServer(
  db: any, userId: string, assignmentId: string,
): Promise<{ ok: boolean; run_id?: string; error?: string }> {
  const { data: a, error } = await db
    .from("task_assignments")
    .select("id, user_id, task_template_id, individual_email, individual_phone")
    .eq("id", assignmentId).single();
  if (error) throw new Error(error.message);

  const profileId = await resolveProfileForTemplate(db, String(a.task_template_id));
  if (!profileId) return { ok: false, error: "Kein passendes Bot-Profil für diese Vorlage hinterlegt." };

  const { data: running } = await db
    .from("bot_runs").select("id")
    .eq("assignment_id", a.id)
    .in("status", ["queued", "running", "waiting_admin"]).limit(1);
  if (Array.isArray(running) && running.length) return { ok: true, run_id: String(running[0].id) };

  const extra: Record<string, string> = {};
  if (a.individual_email) extra["email"] = String(a.individual_email);
  if (a.individual_phone) extra["phone"] = String(a.individual_phone);

  const res = await createBotRun(db, userId, {
    profile_id: profileId,
    user_id: a.user_id,
    assignment_id: a.id,
    input_data: extra,
  });

  await db.from("task_assignments")
    .update({ status: "entwurf", updated_at: new Date().toISOString() })
    .eq("id", a.id);

  return { ok: true, run_id: res.id };
}
