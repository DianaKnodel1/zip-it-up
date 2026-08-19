# Pre-Deploy-Prüfung: gefundene Punkte und Fixes

Typecheck ist grün, es gibt keine toten Links in der Navigation, und der Doppelbewerbungs-Schutz blockiert keine Bewerber (bei doppeltem Absenden wird die vorhandene Bewerbung wiederverwendet statt einen Fehler zu zeigen). Vier Punkte müssen vor dem Deploy noch geklärt werden.

## 1. Blocker: Datenbank-Änderung ist noch nicht eingespielt

Archivieren und der Archiv-Umschalter in /admin/bewerbungen brauchen die neuen Spalten `is_archived` / `archived_at`. Die Datei liegt vor, ist aber eine manuelle Migration. Ohne sie läuft die Liste zwar weiter (Fallback ist eingebaut), der Archivieren-Button meldet aber einen Fehler.

Ebenfalls prüfen, ob die vorherigen manuellen Migrationen (neue Reminder-Arten, Interview-Abbruch, Doppelbewerbungs-Index) auf dem Server schon durchgelaufen sind.

## 2. Conversion-Bremse, die noch offen ist: kritische Mails sterben bei fehlendem SMTP

Terminbestätigung und Interview-Link ignorieren jetzt Pause, Sendefenster und Limits. Sie scheitern aber weiterhin hart, wenn beim zuständigen Mandanten die SMTP-Daten unvollständig sind oder der Mandant der Bewerbung nicht sauber zugeordnet ist (`smtp_incomplete`, `missing_fasttrack_tenant`). Genau das sind die blockierten Bestätigungen aus dem E-Mail-Center — jede davon ist ein garantierter No-Show.

Fix: Für die zwei kritischen Mailarten einen Ersatzabsender erlauben. Reihenfolge: zuständiger Mandant → der andere Mandant derselben Bewerbung (Vermittlung ↔ Fast-Track) → erster aktiver Mandant mit vollständigem SMTP. Der Ersatzversand wird im Log klar markiert, damit die falsche Konfiguration sichtbar bleibt. Nicht-kritische Mails bleiben unverändert streng.

Zusätzlich: `tenant_inactive` blockiert aktuell auch kritische Mails. Für einen bereits gebuchten Termin ist das falsch — auch hier greift der Ersatzabsender.

## 3. Deploy-Umfang: es sind mehr Funktionen betroffen als bisher genannt

Die geänderten gemeinsamen Bausteine (Versand-Kontrolle, Doppelsende-Sperre, Absender-Auflösung) werden von zehn Mail-Funktionen benutzt. Wenn nur drei neu deployt werden, laufen die anderen mit altem Code weiter — inkonsistentes Verhalten und schwer auffindbare Fehler. Deshalb: alle zehn neu deployen.

## 4. Kleinigkeit: Archiv-Voreinstellung

Der Archivieren-Dialog steht auf 30 Tagen. Bei über 2.000 Alt-Bewerbungen ist das riskant nah am aktuellen Funnel. Voreinstellung auf 180 Tage, Vorschau (Trockenlauf mit Anzahl) vor dem Ausführen.

## Umsetzung (technisch)

- `supabase/functions/_shared/sender-resolver.ts`: Ersatzabsender-Kette für `CRITICAL_KINDS`, Rückgabe um `fallback_used`/`intended_tenant_id` erweitern; `tenant_inactive` für kritische Mails nicht mehr blockierend.
- Aufrufer der kritischen Mails (`send-booking-confirmation`, `send-appointment-reminders`, `send-invitation-email`) protokollieren den Ersatzabsender in `metadata.sender_fallback`.
- `src/routes/admin.email-center.tsx`: Hinweiszeile „mit Ersatzabsender verschickt – SMTP des Mandanten prüfen".
- `src/routes/admin.bewerbungen.tsx`: Archiv-Standard 180 Tage + Trockenlauf-Vorschau vor dem Archivieren.

## Deploy-Reihenfolge

1. Backend-Server: `git pull`, dann `bash scripts/migrate.sh`.
2. Alle Mail-Funktionen neu deployen: email-resend, process-invite-resend-queue, resend-signup-confirmation, send-application-reminders, send-appointment-reminders, send-booking-confirmation, send-chat-reminder, send-invitation-email, send-password-reset, send-signup-confirmation.
3. Portal-Server: `bash /opt/apps/portal/scripts/deploy.sh`.

## Danach testen

1. /admin/bewerbungen: Chips zählen korrekt, Mandanten-Filter greift, Archiv-Umschalter zeigt archivierte Datensätze.
2. Archivieren mit 180 Tagen: erst Vorschau, dann ausführen.
3. /admin/email-logs: Mail-System auf null setzen.
4. Testbewerbung + Terminbuchung: genau eine Bestätigung, Link funktioniert.
5. Mandant testweise pausieren und erneut buchen: Bestätigung geht trotzdem raus.
6. Bei einem Mandanten SMTP-Passwort leeren und buchen: Bestätigung geht über Ersatzabsender raus, Hinweis erscheint im E-Mail-Center.
7. /admin/mitarbeiter: bisher ausgegrauten Mitarbeiter annehmen.