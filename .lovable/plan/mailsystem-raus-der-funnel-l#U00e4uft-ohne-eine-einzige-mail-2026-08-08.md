# Mailsystem raus — der Funnel läuft ohne eine einzige Mail

Ja, ich bin dafür. Die Mails haben in den letzten Wochen fast ausschließlich Arbeit gemacht (SMTP-Pausen, Bounces, Retry-Queue, blockierte Bestätigungen) und im Funnel messbar nichts gebracht: 14 Zusagen, 0 Registrierungen. Beim Kollegen läuft jeder Schritt im Browser weiter, ohne dass ein Postfach dazwischenliegt. Genau das bauen wir.

**Eine Ausnahme empfehle ich dringend: Passwort-Vergessen im Mitarbeiterportal. Das ist keine Funnel-Mail, sondern die einzige Möglichkeit, wie ein Mitarbeiter wieder an sein Konto kommt. Ohne sie musst du jedes vergessene Passwort von Hand zurücksetzen. Diese eine Mail bleibt, alles andere geht raus.**

## Was verschwindet

Keine Eingangsbestätigung, keine Terminbestätigung, keine Termin-Erinnerung, keine Nachfass-Mail bei fehlender Buchung, keine No-Show-Mail, keine Zusage-Mail, keine Registrierungs- und Onboarding-Erinnerung, keine Bestätigungsmail beim Registrieren.

Termin-Mail, SMS und Kalendereintrag kommen komplett von Calendly.

## Der neue Ablauf

```text
Bewerbung absenden
  -> Danke-Karte auf derselben Seite, Button "Jetzt Termin buchen"
  -> Calendly (Name/E-Mail/Telefon vorbefuellt) — Calendly schickt Mail + SMS
  -> Bewerber oeffnet /bewerbung, gibt seine E-Mail ein
  -> Interview im Chat
  -> Zusage: Button "Jetzt registrieren"
  -> /register mit vorbefuellter E-Mail, KEINE Bestaetigungsmail
  -> sofort eingeloggt im Onboarding
```

## Was gebaut wird

### 1. Versand stillgelegt

Alle Versandwege laufen künftig gegen eine zentrale Sperre und verschicken nichts mehr. Die Cron-Jobs für Erinnerungen werden abgeschaltet, damit sie nicht sinnlos laufen. Passwort-Reset ist davon ausgenommen. Der Code bleibt im Projekt liegen (falls du in Monaten doch vergleichen willst), ist aber nirgends mehr erreichbar oder aktiv.

### 2. `/admin/bewerbungen` ohne jeden Mail-Bezug

Mail-Kette, Mail-Historie, Versandstatus, „Mail erneut senden", die Statusstufe „E-Mail bestätigt" und die Mail-Warnsymbole fallen weg. Übrig bleibt der Funnel, der wirklich zählt: beworben → Termin gebucht → erschienen → Zusage/Absage → registriert → Onboarding fertig. Das macht die Liste deutlich schneller, weil zwei große Log-Abfragen pro Seitenaufruf entfallen.

### 3. Mail-Oberflächen aus dem Admin entfernt

E-Mail-Center, Mail-Logs, Retry-Queue, Bounce-Panel und SMTP-Gesundheit verschwinden aus Navigation und Kommandopalette. Die SMTP-Felder bleiben in den Mandanten-Einstellungen, weil der Passwort-Reset sie braucht — sie stehen aber unter „nur für Konto-Wiederherstellung".

### 4. Registrierung ohne Bestätigungsmail

Konto anlegen, sofort eingeloggt, direkt ins Onboarding. Der Zwischenschritt „Bitte bestätigen Sie Ihre E-Mail" fällt ersatzlos weg — das ist die Stelle, an der du aktuell praktisch alle Zusagen verlierst.

### 5. Calendly ist der Standard

Neue Landingpages stehen auf „Calendly". Die interne Terminbuchung bleibt als Auswahl bestehen, ist aber nicht mehr Standard.

### 6. Zahlen

Die No-Show-Analyse mit Trichter je Buchungsart bleibt die Wahrheitsquelle: beworben → gebucht → abgesagt → nicht erschienen → erschienen → Zusage → registriert → Onboarding fertig.

## Bereits erledigt

- `/bewerbung` leitet Bewerber ohne Termin bei Calendly-Seiten direkt zu Calendly (vorher: interne Terminauswahl mit Fehlermeldung).
- Der Registrierungslink nach der Zusage nutzt die serverseitig aufgelöste Partner-Domain statt der Browser-Adresse.
- Die zentrale Versandsperre steckt bereits in der Versandprüfung und im Bewerbungs-Erinnerungslauf.

## Technische Details

- `supabase/functions/_shared/send-guard.ts`: Sperre `mailless_mode` greift vor allen anderen Prüfungen, auch für `critical`; `bypassMailless` nur für `send-password-reset`.
- `tenants.mailless_mode boolean not null default true` (Migration in `supabase/manual-migrations/`), plus `mailless_mode` in den Tenant-Selects von `send-reminders` und `send-application-reminders`; beide Läufe überspringen solche Tenants mit Grund `mailless_mode`.
- Cron-Einträge für `send-reminders`, `send-application-reminders`, `send-appointment-reminders`, `send-booking-confirmation` und die Retry-Queue deaktivieren (SQL-Skript unter `scripts/`).
- `src/routes/register.tsx`: `send-signup-confirmation` entfernen, nach `signUp` Session herstellen, direkt ins Onboarding; Supabase-Auth `enable_confirmations` aus.
- `src/routes/admin.bewerbungen.tsx`: `MailChain`, `email_send_log`/`application_reminder_log`-Abfragen, `mailEvents*`-State, `MailWarning`-Spalte und die Stufe `email_bestaetigt` entfernen.
- `src/components/AdminLayout.tsx` + `AdminCommandPalette.tsx`: Mail-Einträge entfernen.
- `src/lib/landing-generator.functions.ts` / Landing-Formular: `booking_mode` Standard `calendly`.
- `src/components/interview/ZusageCard.tsx`: `loginHref` an dieselbe aufgelöste Portal-Basis binden.

## Danach

Build und Typprüfung, dann deployen. Für den ersten Calendly-Test brauchst du im Calendly-Event: SMS-Erinnerung aktiv, Mail-Erinnerung 24 h und 1 h vorher, und in der Event-Beschreibung den Link auf `portal.<deine-domain>/bewerbung`.