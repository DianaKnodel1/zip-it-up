# Mail-System: Pausierung, Nachversand und automatische Wiederholung

## 1. Ab wann wird ein Mandant pausiert? (Ist-Zustand)

Es gibt zwei getrennte Ebenen:

**Mandanten-Pause (blockiert alle Mails eines Mandanten)**
- Der Job `smtp-health-cron` prüft alle 30 Minuten pro aktivem Mandanten nur Verbindung + Anmeldung (es wird keine Mail gesendet).
- Erfolg: Fehlerzähler zurück auf 0. Eine automatisch gesetzte Pause wird automatisch wieder aufgehoben. Manuelle Pausen bleiben bestehen.
- Fehler: Zähler +1. **Ab 3 Fehlern in Folge** (also nach ca. 1–1,5 Stunden dauerhafter Störung) wird der Mandant automatisch pausiert, Grund `auto:smtp_fail`.
- Fehlen SMTP-Daten komplett, gibt es keine Pause, sondern Status "nicht konfiguriert" – Mails werden dann mit Grund `smtp_incomplete` übersprungen.
- Beim Versand selbst blockiert nur eine echte Pause; die Alt-Markierung `auto:smtp_verify` blockiert bewusst nicht mehr.

**Empfänger-Sperre (blockiert nur eine Adresse)**
- Nach 3 aufeinanderfolgenden Fehlversuchen an dieselbe Adresse wird diese gesperrt (Tabelle der Empfänger-Fehler), zusätzlich gibt es die manuelle Sperrliste für Bounces.

## 2. Was passiert mit übersprungenen Mails? (Ist-Zustand)

Jeder Ausgang landet im Mail-Log mit Status:
- `sent` – versendet
- `skipped` – bewusst nicht gesendet (Pause, Kontingent 150/h bzw. 2.400/Tag, Sendefenster 06–22 Uhr, fehlendes SMTP)
- `failed` – SMTP-Fehler
- `pending` – nur bei erkanntem SMTP-Stundenlimit als Wiederholung vorgemerkt

Wichtig: **Es gibt aktuell keinen Job, der `failed`, `skipped` oder `pending` erneut versendet.** Alles bleibt liegen, bis ein Admin manuell "Erneut senden" klickt. Genau das ist die Lücke, die zu deiner Nacharbeit geführt hat.

## 3. Vorschlag: automatischer Nachversand (Retry-Worker)

Neue Edge Function `email-retry-cron`, alle 10 Minuten per Cron, plus manueller Auslöser im E-Mail-Center.

Wiederholt wird nur, was sicher wiederholbar ist:
- Status `pending`, `failed` oder `skipped`
- Grund ist **vorübergehend**: SMTP-Stundenlimit, Timeout, Verbindung abgelehnt, DNS, inzwischen aufgehobene Mandanten-Pause, Stunden-/Tageskontingent, ausserhalb Sendefenster
- Gespeicherter Betreff und HTML vorhanden
- Alter maximal 72 Stunden

Nicht wiederholt wird:
- Templates mit zeitlich begrenztem Link (Signup-Bestätigung, Passwort-Reset, Bestätigungs-Reminder) – der Link wäre abgelaufen; diese bleiben als Handlungsaufgabe stehen
- Adressen auf der Sperrliste oder mit dauerhaftem Fehler (Adresse ungültig, Postfach existiert nicht, Anmeldung dauerhaft abgelehnt)
- Einträge, die bereits quittiert oder manuell nachgesendet wurden
- Mandanten, die manuell pausiert sind

Ablauf pro Eintrag:
1. Mandant, SMTP und Kontingent prüfen (bestehende Prüf-Logik wird wiederverwendet, damit Limits nicht gerissen werden)
2. Senden über das SMTP des Mandanten
3. Erfolg: neue Log-Zeile `sent`, Ursprungszeile als erledigt markieren
4. Fehler: Versuchszähler +1, nächster Versuch mit wachsendem Abstand (10 min, 30 min, 2 h, 6 h). Nach 5 Versuchen Status `dlq` – bleibt sichtbar für manuelle Bearbeitung
5. Doppelversand ausgeschlossen über die bestehende Anspruchs-/Dedupe-Logik plus eine Sperre pro Log-Zeile

Nachlauf nach behobener Störung: Sobald der Health-Check wieder grün ist und die Pause fällt, arbeitet der Worker die Warteschlange automatisch ab – gedrosselt auf das Stundenkontingent, damit nicht hunderte Mails auf einmal rausgehen.

## 4. Sichtbarkeit im Admin

Im E-Mail-Center eine Ansicht "Warteschlange / Wiederholungen":
- Anzahl wartender Einträge, nächster geplanter Versuch, Versuchszähler, letzter Fehler
- Filter nach Mandant und Grund
- Aktionen: "Jetzt versuchen", "Abbrechen/Erledigt", "Alle eines Mandanten nachsenden"
- Getrennte Liste "Manuelle Nacharbeit nötig" (Token-Mails und `dlq`)

## 5. Wie das Mail-System grundsätzlich funktioniert

Zwei Absender-Seiten pro Bewerbung, strikt getrennt:

```text
Bewerber bewirbt sich auf Landingpage
        |
        v
  broker_tenant_id   ->  Vermittlungs-Mandant
     sendet: Bewerbungseingang, Termin-Einladung,
             Terminbestätigung (+ICS), Reminder ohne Termin,
             No-Show-/Neubuchungs-Reminder
        |
        v
  Wechsel Richtung Mitarbeiter
        |
        v
 fasttrack_tenant_id -> Fast-Track-/Portal-Mandant
     sendet: E-Mail-Bestätigung (Double-Opt-In), Onboarding/
             Registrierung abschliessen, Chat-Reminder,
             7-Tage-ohne-Auftrag
```

- Jede Mailart ist fest einer Seite zugeordnet. Es wird **nie** auf den anderen Mandanten zurückgefallen – fehlt der Ziel-Mandant, wird die Mail geskippt und protokolliert. Das verhindert Portal-Mails vom Vermittlungs-Absender.
- Absenderdaten, SMTP-Zugang, Logo, Farben, Signatur und alle Texte kommen aus dem jeweiligen Mandanten-Datensatz.
- Vor jedem Versand: Mandant aktiv? nicht pausiert? SMTP vollständig? Empfänger nicht gesperrt? Kontingent frei (150/h, 2.400/Tag)? Reminder zusätzlich nur 06–22 Uhr; Terminbestätigungen und Termin-Erinnerungen sind davon ausgenommen.
- Auslöser sind teils direkte Ereignisse (Bewerbung, Buchung, Registrierung), teils Cron-Jobs (Reminder-Läufe, Termin-Erinnerungen, SMTP-Health).
- Jeder Ausgang wird mit gerendertem Betreff und HTML gespeichert – daraus speist sich sowohl "Erneut senden" als auch der geplante automatische Nachversand.

## Technische Umsetzung

- Neu: `supabase/functions/email-retry-cron/index.ts` (nutzt `sender-resolver`, `send-guard`, `smtp`, `send-claim`)
- Neu: Migration mit Spalten `retry_count`, `next_retry_at`, `retry_locked_until` und passendem Index auf `email_send_log`; Cron-Registrierung analog `smtp-health-cron`
- Neu: `src/lib/email-retry-queue.functions.ts` (Admin-Server-Funktionen: Liste, jetzt versuchen, abbrechen)
- Änderung: `src/routes/admin.email-center.tsx` um die Warteschlangen-Ansicht
- Deploy: Edge Function auf dem Backend-Server, Migration via `scripts/migrate.sh`, Portal-Build wie gewohnt