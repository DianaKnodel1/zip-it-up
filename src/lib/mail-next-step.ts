// Was passiert als NÄCHSTES im Mail-Versand für diesen Bewerber?
//
// Spiegelt bewusst die Regeln aus supabase/functions/send-application-reminders
// (24h/72h-Raster) wider, damit in der Oberfläche exakt dasselbe steht, was der
// Cron später tatsächlich tut. Ein grauer Kettenpunkt ist damit nie mehr
// unerklärt: hier steht schwarz auf weiß, warum keine Mail vorgesehen ist.

const H = 60 * 60 * 1000;

export type NextStep = {
  /** Kurztext für die Liste, z.B. "Erinnerung · Kein Termin am 30.07., 12:06" */
  text: string;
  /** Ausführliche Erklärung (Tooltip / Dialog) */
  detail: string;
  /** Zeitpunkt, falls planbar */
  at: Date | null;
  /** true = es ist bewusst keine weitere Mail vorgesehen */
  done: boolean;
  /** Sofort ausführbare Aktion — aktuell nur die manuelle Zusage-Mail. */
  action?: "send_invite" | "send_reminder";
  /** Technische Reminder-Art für den manuellen Sofort-Versand. */
  kind?: string;
};

export type NextStepInput = {
  createdAt: string | null;
  scheduledAt: Date | null;
  bookingStatus: string | null;
  interviewCompletedAt: string | null;
  recommendation: string | null;
  /** Zeitpunkt der Zusage-/Einladungsmail */
  inviteSentAt: string | null;
  /** Bewerber hat sich bereits im Portal registriert */
  registered: boolean;
  /** Termin wurde storniert (Zeitpunkt) */
  cancelledAt: string | null;
  /** Ergebnis des letzten Einladungs-Versuchs (an der Bewerbung gespeichert) */
  inviteMailStatus?: string | null;
  inviteMailError?: string | null;
  inviteMailAt?: string | null;
};

const fmt = (d: Date) =>
  d.toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

function step(text: string, detail: string, at: Date | null, kind?: string): NextStep {
  return {
    text: at ? `${text} am ${fmt(at)} Uhr` : text,
    detail, at, done: false,
    ...(kind ? { action: "send_reminder" as const, kind } : {}),
  };
}

/**
 * Ermittelt den nächsten geplanten Mail-Schritt. Reihenfolge = Reihenfolge,
 * in der der Cron die Fälle prüft.
 */
export function computeNextStep(i: NextStepInput, now: Date = new Date()): NextStep {
  const t = now.getTime();

  if (i.registered) {
    return {
      text: "Keine weitere Mail vorgesehen",
      detail: "Der Bewerber ist im Portal registriert. Ab hier übernimmt das Onboarding (Dokumente/Vertrag) den Mailversand.",
      at: null,
      done: true,
    };
  }

  if (i.recommendation === "reject") {
    return {
      text: "Keine weitere Mail vorgesehen",
      detail: "Die Bewerbung wurde abgelehnt. Es werden keine Erinnerungen mehr versendet.",
      at: null,
      done: true,
    };
  }

  // Zusage erteilt, aber noch nicht registriert → Registrierungs-Nachfass 24h/72h
  if (i.recommendation === "invite" && i.inviteSentAt) {
    const base = new Date(i.inviteSentAt).getTime();
    if (t < base + 24 * H) return step("Erinnerung · Registrierung offen (24 h)", "Der Bewerber hat die Zusage erhalten, sich aber noch nicht registriert. 24 Stunden nach der Zusage geht die erste Erinnerung raus.", new Date(base + 24 * H), "registration_pending_24h");
    if (t < base + 72 * H) return step("Erinnerung · Registrierung offen (72 h)", "Zweiter und letzter Nachfass zur offenen Registrierung, 72 Stunden nach der Zusage.", new Date(base + 72 * H), "registration_pending_72h");
    return { text: "Keine weitere Mail vorgesehen", detail: "Beide Registrierungs-Erinnerungen (24 h und 72 h) wurden bereits versendet. Danach folgt automatisch nichts mehr.", at: null, done: true };
  }

  if (i.recommendation === "invite") {
    const when = i.inviteMailAt ? ` (${fmt(new Date(i.inviteMailAt))} Uhr)` : "";
    if (i.inviteMailStatus === "failed") {
      return {
        text: "Zusage-Mail fehlgeschlagen",
        detail: `Der Versand der Registrierungseinladung ist gescheitert${when}: ${i.inviteMailError || "Grund unbekannt"}. Mit „Jetzt senden“ wird ein frischer Link erzeugt und erneut versendet.`,
        at: null, done: false, action: "send_invite",
      };
    }
    if (i.inviteMailStatus === "skipped") {
      return {
        text: "Zusage-Mail übersprungen",
        detail: `Der Versand wurde bewusst übersprungen${when}: ${i.inviteMailError || "Grund unbekannt"}. Falls der Bewerber die Mail nie erhalten hat, kann sie mit „Jetzt senden“ neu ausgelöst werden.`,
        at: null, done: false, action: "send_invite",
      };
    }
    return {
      text: "Zusage-Mail wurde nie ausgelöst",
      detail: "Die Zusage ist erteilt, aber es existiert kein Versandversuch für die Registrierungseinladung — weder gesendet, noch fehlgeschlagen oder übersprungen. Mit „Jetzt senden“ wird ein frischer Registrierungslink erzeugt und verschickt.",
      at: null, done: false, action: "send_invite",
    };
  }

  // Termin storniert → Rebook-Erinnerungen 24h/72h
  if (i.bookingStatus === "cancelled" && i.cancelledAt) {
    const base = new Date(i.cancelledAt).getTime();
    if (t < base + 24 * H) return step("Erinnerung · Neuen Termin buchen (24 h)", "Der Termin wurde abgesagt. 24 Stunden danach erinnert das System an eine Neubuchung.", new Date(base + 24 * H), "rebook_after_cancel_24h");
    if (t < base + 72 * H) return step("Erinnerung · Neuen Termin buchen (72 h)", "Zweiter Nachfass zur Neubuchung, 72 Stunden nach der Absage.", new Date(base + 72 * H), "rebook_after_cancel_72h");
    return { text: "Keine weitere Mail vorgesehen", detail: "Beide Neubuchungs-Erinnerungen wurden versendet.", at: null, done: true };
  }

  // Termin gebucht
  if (i.scheduledAt && !i.interviewCompletedAt) {
    const s = i.scheduledAt.getTime();
    if (t < s - 30 * 60_000) return step("Erinnerung · Interview in 30 Minuten", "30 Minuten vor dem gebuchten Termin geht die Interview-Erinnerung raus — unabhängig von der Uhrzeit.", new Date(s - 30 * 60_000), "interview_invite_30min");
    if (t < s + 24 * H) return step("Erinnerung · Nicht erschienen", "Wenn der Termin ungenutzt verstreicht, erinnert das System 24 Stunden nach dem Termin einmalig.", new Date(s + 24 * H), "no_show_24h");
    return { text: "Keine weitere Mail vorgesehen", detail: "Der Termin liegt mehr als 24 Stunden zurück und die Nicht-erschienen-Erinnerung wurde bereits ausgelöst.", at: null, done: true };
  }

  if (i.interviewCompletedAt) {
    return { text: "Auswertung läuft", detail: "Das Interview ist beendet. Sobald die Entscheidung vorliegt, geht automatisch Zusage oder Absage raus.", at: null, done: false };
  }

  // Kein Termin gebucht → 24h/72h nach Bewerbungseingang
  if (i.createdAt) {
    const base = new Date(i.createdAt).getTime();
    if (t < base + 24 * H) return step("Erinnerung · Kein Termin (24 h)", "Der Bewerber hat noch keinen Termin gebucht. 24 Stunden nach Eingang der Bewerbung geht die erste Erinnerung raus.", new Date(base + 24 * H), "no_booking_24h");
    if (t < base + 72 * H) return step("Erinnerung · Kein Termin (72 h)", "Zweite und letzte Erinnerung zur Terminbuchung, 72 Stunden nach Eingang der Bewerbung.", new Date(base + 72 * H), "no_booking_72h");
    return { text: "Keine weitere Mail vorgesehen", detail: "Beide Termin-Erinnerungen (24 h und 72 h) wurden versendet. Danach ruht der Vorgang.", at: null, done: true };
  }

  return { text: "Kein Schritt geplant", detail: "Für diesen Bewerber liegen keine Daten vor, aus denen sich ein nächster Mail-Schritt ableiten lässt.", at: null, done: true };
}
