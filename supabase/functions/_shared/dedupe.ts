// Zentrale Doppelsende-Sperre für ALLE Mail-Funktionen.
//
// Hintergrund: Jede Funktion hatte ihre eigene "habe ich das schon geschickt?"-
// Prüfung, die Protokollzeilen LUD und im Speicher zählte. PostgREST liefert
// dabei aber nur die ersten 1.000 Zeilen — wächst das Protokoll darüber hinaus,
// fällt der betroffene Vorgang aus dem Ergebnis und dieselbe Mail geht bei
// jedem Cron-Lauf erneut raus (real passiert: 111 Mails an einen Bewerber).
//
// Deshalb hier NUR noch serverseitige Zählungen (count/head) mit engen Filtern.
// Diese Prüfung gehört unmittelbar VOR den Versand — unabhängig davon, ob
// vorgelagerte Prüfungen etwas übersehen haben.

// Vereinfacht (2026-08): Die pauschale 20-Stunden-Sperre "gleiche Vorlage +
// gleiche Adresse" hat gewollte Mails blockiert (Storno + Neubuchung, zweiter
// Termin am selben Tag, erneut angeforderter Link). Doppelversand wird jetzt
// durch den eindeutigen event_key in email_send_log (send-claim.ts) und den
// vorgangsbezogenen application_reminder_log verhindert.
// Ein Zeitfenster gilt nur noch, wenn die aufrufende Funktion es explizit setzt.
export const DEFAULT_WINDOW_HOURS = 0;

export type DedupeInput = {
  /** Bewerbung (falls vorhanden) — paart mit application_reminder_log. */
  applicationId?: string | null;
  /** reminder_kind im application_reminder_log. */
  kind?: string | null;
  /** Empfängeradresse — Pflicht für die Zeitsperre. */
  recipient: string;
  /** template_name im email_send_log. */
  templateName: string;
  /** Zeitfenster der Wiederholungssperre in Stunden (Standard 20). */
  windowHours?: number;
  /** Zusätzliche Eingrenzung über metadata->>key = value (z. B. appointment_id). */
  metadataKey?: string;
  metadataValue?: string | null;
};

export type DedupeResult = {
  /** true = NICHT senden. */
  duplicate: boolean;
  /** Maschinenlesbarer Grund für Log/Antwort. */
  reason?: "already_sent" | "duplicate_within_window";
};

async function countRows(query: any): Promise<number> {
  const { count, error } = await query;
  // Fail-open: eine kaputte Zählung darf transaktionale Mails nicht blockieren.
  if (error) {
    console.warn("[dedupe] count failed, treating as 0:", error.message);
    return 0;
  }
  return count ?? 0;
}

/**
 * Prüft, ob dieselbe Mail bereits raus ist.
 * Nutzt ausschließlich serverseitige Zählung — keine 1.000-Zeilen-Falle.
 */
export async function isDuplicateSend(admin: any, input: DedupeInput): Promise<DedupeResult> {
  const windowHours = input.windowHours ?? DEFAULT_WINDOW_HOURS;

  // 1) Vorgangsbezogen: dieser Schritt ist für diese Bewerbung schon erledigt.
  if (input.applicationId && input.kind) {
    const n = await countRows(
      admin
        .from("application_reminder_log")
        .select("application_id", { count: "exact", head: true })
        .eq("application_id", input.applicationId)
        .eq("reminder_kind", input.kind)
        .eq("status", "sent"),
    );
    if (n > 0) return { duplicate: true, reason: "already_sent" };
  }

  // 2) Feingranular über die Metadaten (z. B. genau dieser Termin).
  if (input.metadataKey && input.metadataValue) {
    const n = await countRows(
      admin
        .from("email_send_log")
        .select("id", { count: "exact", head: true })
        .eq("template_name", input.templateName)
        .eq("status", "sent")
        .eq(`metadata->>${input.metadataKey}`, input.metadataValue),
    );
    if (n > 0) return { duplicate: true, reason: "already_sent" };
  }

  // 3) Harte Zeitsperre: gleiche Vorlage + gleiche Adresse im Zeitfenster.
  if (input.recipient && windowHours > 0) {
    const since = new Date(Date.now() - windowHours * 3600_000).toISOString();
    const n = await countRows(
      admin
        .from("email_send_log")
        .select("id", { count: "exact", head: true })
        .eq("recipient_email", input.recipient)
        .eq("template_name", input.templateName)
        .eq("status", "sent")
        .gte("created_at", since),
    );
    if (n > 0) return { duplicate: true, reason: "duplicate_within_window" };
  }

  return { duplicate: false };
}

/**
 * Zählt Fehlversuche eines Vorgangs (Retry-Cap) — ebenfalls serverseitig,
 * eingegrenzt auf genau diesen Vorgang statt "alle Fehler laden".
 */
export async function failedAttempts(
  admin: any,
  templateName: string,
  metadataKey: string,
  metadataValue: string,
): Promise<number> {
  return await countRows(
    admin
      .from("email_send_log")
      .select("id", { count: "exact", head: true })
      .eq("template_name", templateName)
      .eq("status", "failed")
      .eq(`metadata->>${metadataKey}`, metadataValue),
  );
}
