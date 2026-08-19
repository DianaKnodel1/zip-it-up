# Systemprüfung: gefundene Fehler & Fixplan

Ich habe Buchung, Interview-Zugang, Mailketten, Reminder-Fenster und die öffentlichen Endpunkte durchgesehen. Build und Typprüfung sind sauber — die Probleme liegen in der Ablauf-Logik, und genau die kosten aktuell Termine und Zusagen.

## Was ich gefunden habe

### 1. Interview-Einladung (30 Min vorher) kann komplett ausfallen
Der Versand greift nur, wenn der Termin genau 25–40 Minuten in der Zukunft liegt. Fällt ein Cron-Lauf aus, ist der Mandant pausiert oder greift ein Rate-Limit, ist das Fenster vorbei — der Bewerber bekommt seinen Zugangslink nie und erscheint zwangsläufig nicht. Das erklärt die 74 übersprungenen Einladungen aus dem letzten Health-Check.

### 2. „Interview geöffnet, aber nicht beendet" fällt durch jedes Netz
Die No-Show-Erkennung setzt voraus, dass das Gespräch nie gestartet wurde. Wer den Link öffnet und mittendrin abbricht, bekommt keine Recovery-Mail, keinen Rebook-Link und keine Zusage — und taucht in keiner Nachfass-Kette auf.

### 3. Terminbestätigung bleibt bei Konfigurationsfehlern dauerhaft hängen
Wenn die Fast-Track-Portal-Domain fehlt oder die Absender-Zuordnung scheitert, wird der Datensatz jede Minute erneut probiert, aber nie versendet und nirgends sichtbar gemeldet. Ergebnis: Termin gebucht, Bewerber hat keine Bestätigung und keinen Link — praktisch 100 % No-Show.

### 4. Pausierte Mandanten verlieren Mails endgültig
Während einer SMTP-Pause laufen die Zeitfenster (30 Min / 24 h / 72 h) einfach ab. Nach dem Entpausieren wird nichts nachgeholt.

### 5. Bewusst offen gelassen (keine Umsetzung)
- **Doppelbewerbungs-Index:** verhindert nur Doppelklick-Duplikate (zwei Eingangsmails, doppelte Zeile in der Liste). Datenhygiene, kein Conversion-Effekt — bleibt liegen.
- **E-Mail-Lookup ohne Bremse:** der offene Zugang per E-Mail ist genau die Bequemlichkeit, die abgelaufene Links ersetzt. Ein IP-Limit würde den gezielten Missbrauch ohnehin nicht verhindern — bleibt wie es ist.

## Was ich umsetzen würde

**Stufe 1 — Ausfälle stoppen (höchste Priorität)**
- Nachhol-Logik für die Interview-Einladung: Fenster bis zum Terminstart erweitern, verpasste Einladungen im nächsten Lauf sofort nachsenden.
- Neue Stufe „Gespräch fortsetzen": 60 Min nach Start ohne Abschluss eine Mail mit direktem Wiederaufnahme-Link.
- Terminbestätigungen, die dauerhaft nicht versendbar sind, im Admin-E-Mail-Center als eigene Warnliste sichtbar machen (inkl. Grund und Ein-Klick-Nachversand) statt still im Cron zu hängen.
- Nachhol-Lauf nach Mandanten-Pause: Beim Entpausieren werden abgelaufene, nie versendete Stufen einmalig nachgeholt.

**Stufe 2 — Conversion-Feinschliff**
- Zu-spät-Fall im Interview sauber abfangen: Wer 20 Min nach Terminstart kommt, sieht „Sie können jetzt noch starten" statt einer Fehlermeldung.
- Abgesagter Termin im Interview-Link klar erklären, mit direktem Neubuchen-Button.
- Durchgehende Fortschrittsanzeige „Schritt X von 4" von Bewerbung bis Registrierung, einheitliches Vokabular („Interview", „Zusage", „Registrierung") in allen Mails und Screens.

**Stufe 3 — Nachweis**
- Trockenlauf über die komplette Mailkette (`dry-run-all.sh`, `verify-mail-matrix.sh`, `audit-chain-coverage.sh`) und danach ein echter End-to-End-Testlauf mit einer Testadresse durch alle Stufen.

## Technische Details
- `supabase/functions/send-appointment-reminders/index.ts`: Fenster `WINDOW_LOW_MIN`/`WINDOW_HIGH_MIN` (25/40) → Catch-up bis `scheduled_at > now`; Skips zusätzlich in `application_reminder_log` protokollieren.
- `supabase/functions/send-application-reminders/index.ts`: neue Stufe `interview_abandoned` (Bedingung: `interview_started_at` gesetzt, `interview_completed_at` leer, Start älter als 60 Min); Nachhol-Pfad, der abgelaufene Fenster einmalig zulässt, wenn nie eine `sent`-Zeile existiert.
- `supabase/functions/send-booking-confirmation/index.ts`: dauerhafte Skips (`missing_fasttrack_portal_domain`, `routing_failed`) als eigener Status in `email_send_log`, plus Panel in `src/routes/admin.email-center.tsx`.
- Migration analog `20260818000000_reminder_kinds_full.sql` um `interview_abandoned` erweitern.