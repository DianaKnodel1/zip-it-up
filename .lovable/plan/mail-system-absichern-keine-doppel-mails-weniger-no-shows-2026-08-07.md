# Mail-System absichern: keine Doppel-Mails, weniger No-Shows

## Ergebnis der Prüfung

Das System funktioniert grundsätzlich: Absender-Routing (Vermittlung/Fast-Track), Kontingente (150/h, 2.400/Tag), Sendefenster 06–22 Uhr, zentrales `email_send_log` und die Reminder-Crons greifen sauber ineinander. **Calendly ist vollständig erhalten** – eine Vermittlungs-Landingpage kann per Buchungsmodus „Calendly (extern)" auf einen Calendly-Link zeigen, alternativ auf eine Fast-Track-Firma oder das eigene Buchungssystem.

Für die Doppel-/Spam-Mails gibt es vier konkrete Ursachen im Code.

## Was gebaut wird

### 1. Automatischer Nachversand entschärfen (Hauptursache)
Der Retry-Worker vergibt bei jedem Versuch eine neue `resend_nonce` und hebelt damit genau den Datenbank-Schutz aus, der doppelte Sendungen verhindern soll. Zusätzlich behandelt er jeden `pending`-Eintrag als „nie gesendet" – auch wenn die Mail in Wahrheit schon draußen war und nur die Erfolgsmeldung fehlte.

- Retry benutzt eine stabile Kennung statt eines Zeitstempels, damit die Datenbank einen zweiten Versand desselben Inhalts am selben Tag hart ablehnt.
- `pending`-Einträge werden erst nach einer Karenzzeit (30 Min) und nur dann wiederholt, wenn kein späterer `sent`-Eintrag für denselben Empfänger und dieselbe Vorlage existiert.
- Ein durch die Datenbank abgelehnter Retry gilt als „bereits zugestellt", nicht als Fehler.

### 2. Chat-Reminder gegen Doppelklick sichern
Diese Funktion prüft nur per Abfrage, ob in 24 h schon eine Mail raus ist – zwei schnelle Klicks lösen zwei echte Mails aus. Sie bekommt denselben atomaren Vorab-Anspruch (Claim), den alle anderen Funktionen schon nutzen.

### 3. Doppelte Bewerbungen = doppelte Eingangsmail
Beim öffentlichen Bewerbungsformular entscheidet eine Abfrage vor dem Anlegen, ob es die Bewerbung schon gibt. Zwei gleichzeitige Absendungen erzeugen zwei Bewerbungen und zwei Bestätigungsmails.

- Eindeutiger Datenbank-Index auf Mandant + E-Mail-Adresse (innerhalb des Dedupe-Zeitraums), damit die zweite Anlage sicher scheitert und in die bestehende Bewerbung läuft.
- Der Schlüssel der Bestätigungsmail wird an die Bewerbung gebunden statt an die zufällige Request-ID.

### 4. Schutzindizes prüfbar machen
Alle Eindeutigkeits-Indizes liegen nur in `supabase/manual-migrations/`. Ein Prüfskript (`scripts/check-mail-health.sh` erweitern) meldet, ob sie in der laufenden Datenbank wirklich existieren – fehlen sie, ist jeder Schutz nur noch „weich".

### 5. No-Shows reduzieren
Aktuell gibt es vor dem Termin nur die Erinnerung 30 Minuten vorher.

- Zusätzliche Erinnerung **am Vortag** (bzw. 24 h vorher, nur wenn der Termin mehr als 24 h in der Zukunft liegt), mit Absage-/Verschiebe-Link.
- Beide Erinnerungen sind über `application_reminder_log` je Bewerbung und Art eindeutig, können also nicht doppelt rausgehen.

## Technische Details

- `supabase/functions/_shared/retry-queue.ts`: stabile `resend_nonce`, Karenzzeit + Delivery-Check für `pending`, Unique-Violation als Erfolg werten
- `supabase/functions/send-chat-reminder/index.ts`: `claimEmailEvent`/`finishEmailClaim` einbauen
- `src/routes/api/public/applications.ts`: `event_key` an `application_id` binden; neue Migration mit partiellem Unique-Index auf `(tenant_id, lower(email))`
- Neue Migration in `supabase/manual-migrations/`: Unique-Index Bewerbungen + Reminder-Art `interview_reminder_24h`
- `supabase/functions/send-appointment-reminders/index.ts`: zweites Zeitfenster (24 h vorher) plus Vorlage `interview_reminder_24h` in `email-preview`
- `scripts/check-mail-health.sh`: Kontrolle der drei Unique-Indizes

## Deploy nach Umsetzung

Backend: `scripts/migrate.sh`, dann `deploy-edge-function.sh` für `email-resend`, `send-chat-reminder`, `send-appointment-reminders`, `email-preview`. Portal: `scripts/deploy.sh`.