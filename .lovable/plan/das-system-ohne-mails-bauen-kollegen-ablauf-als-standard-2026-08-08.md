# Das System ohne Mails bauen — Kollegen-Ablauf als Standard

## Meine Meinung vorweg

Ja — für den Bewerber-Funnel klar dafür. Aber nicht „Mailsystem löschen", sondern **Mailversand hart abschalten und die Mail-Oberflächen aus dem Weg räumen**. Grund: Der Unterschied zwischen dir und deinem Kollegen entsteht nicht dadurch, dass er bessere Mails schreibt — er hat schlicht **keinen einzigen Schritt, der über ein Postfach läuft**. Jeder Mail-Schritt ist ein Absprungpunkt (Spam, Tippfehler in der Adresse, „mache ich später"). Bei dir liegen davon vier hintereinander im Funnel.

Der wichtigste Einzelpunkt in deinen Zahlen: **14 Zusagen, 0 Registrierungen.** Das ist kein Motivationsproblem, das ist ein kaputter Übergang. Beim Kollegen ist die Zusage ein Klick, dann Konto anlegen, dann sofort drin. Bei dir kommt dazwischen eine Mail plus eine **E-Mail-Bestätigung beim Registrieren** — genau die hat er nicht.

Der Code bleibt erhalten (SMTP, Vorlagen, Logs), damit du beim internen Buchungssystem weiter vergleichen kannst. Er wird nur nicht mehr benutzt.

## Was gebaut wird

### 1. Ein Hauptschalter „Mailversand" pro Mandant — Standard: aus
Alle Mails laufen bereits durch eine gemeinsame Versandprüfung. Dort kommt ein Schalter davor: steht er auf „aus", wird nichts verschickt, sondern nur mit dem Grund „mailless_mode" protokolliert. Das gilt für alles: Eingangsbestätigung, Terminbestätigung, Erinnerungen, Zusage, Registrierungs-Erinnerungen, Onboarding-Nachfassen. Ein Schalter zurück, und alles läuft wieder wie heute.

### 2. Registrierung ohne E-Mail-Bestätigung
Heute schickt die Registrierung eine Bestätigungsmail und der Bewerber muss sie anklicken. Das fällt weg: Konto anlegen, sofort eingeloggt, direkt weiter ins Onboarding. Das ist die Stelle, an der du aktuell 14 von 14 verlierst.

### 3. Calendly als Standard-Buchungsart
Neue Landingpages stehen künftig auf „Calendly". Terminmail, SMS und Kalendereintrag kommen von Calendly — dafür braucht es nichts von uns. Die interne Terminbuchung bleibt vorhanden, damit du sie bewusst als Vergleichsgruppe schalten kannst.

### 4. Der Weg ohne Postfach
- Bewerbung abschicken → Danke-Karte direkt auf der Seite mit „Jetzt Termin buchen" (Calendly, vorbefüllt).
- Interview-Zugang über `/bewerbung` + E-Mail-Adresse. Diese URL gehört in die Calendly-Event-Beschreibung, damit sie im Kalendereintrag und in Calendlys Erinnerungen steht.
- Zusage → Button „Jetzt registrieren" → Registrierung mit vorbefüllter E-Mail auf der Partner-Domain → sofort Onboarding.

### 5. Mail-Oberflächen wegräumen
Mail-Center, Mail-Logs, Retry-Queue, Bounce-Panel und SMTP-Gesundheit verschwinden aus der Navigation und aus der Bewerber-Detailansicht (die Mail-Kette dort ebenfalls). Die Seiten bleiben unter ihrer Adresse erreichbar, damit du beim internen A/B-Zweig noch nachsehen kannst — sie stehen nur niemandem mehr im Weg. Die Cronjobs für Erinnerungen laufen weiter, verschicken im Mail-los-Modus aber nichts und beenden sich sauber.

### 6. Statistik bleibt vollständig
Die No-Show-Analyse mit Trichter je Buchungsart bleibt wie gebaut: beworben → gebucht → erschienen → Zusage → registriert → Onboarding fertig. Das ist ab jetzt deine einzige Wahrheitsquelle, weil es keine Mail-Statusmeldungen mehr gibt.

## Noch offen aus dem letzten Schritt

Zwei Korrekturen waren bereits begonnen und gehören mit in diesen Stand:
- `/bewerbung` leitet Bewerber ohne Termin bei Calendly-Seiten jetzt zu Calendly statt zur internen Terminauswahl (fertig).
- Der Registrierungslink im Interview nutzt jetzt die serverseitig aufgelöste Partner-Domain statt der Browser-Adresse; die Login-Verlinkung in der Zusage-Karte muss noch auf denselben Wert umgestellt werden, sonst zeigt sie bei fehlender Basis ins Leere.

## Technische Details

- `supabase/functions/_shared/send-guard.ts`: neue Sperre `mailless_mode` vor allen anderen Prüfungen; greift auch für als kritisch markierte Mails.
- `tenants`: Spalte `mailless_mode boolean not null default true` (Migration in `supabase/manual-migrations/`), plus Umschalter in `admin.tenants.tsx`.
- `src/routes/register.tsx`: Aufruf von `send-signup-confirmation` entfernen, nach `signUp` direkt Session herstellen und ins Onboarding leiten; Hinweistext „Bitte bestätigen Sie Ihre E-Mail" entfernen.
- Supabase-Auth: `enable_confirmations` für Signups aus, damit Konten sofort nutzbar sind.
- `src/lib/landing-generator.functions.ts` / Landing-Formular: Standardwert `booking_mode = 'calendly'`.
- `src/components/AdminLayout.tsx` + `AdminCommandPalette.tsx`: Mail-Einträge ausblenden; `admin.bewerbungen.tsx`: `MailChain` und Mail-Aktionen aus der Detailansicht nehmen.
- `src/components/interview/ZusageCard.tsx` / `interview.$appId.tsx`: `loginHref` an dieselbe aufgelöste Portal-Basis binden.

## Was ich nicht empfehle

Das Mailsystem tatsächlich zu löschen. Sobald du beim internen Buchungszweig Zahlen vergleichen willst, brauchst du es wieder — und ein Hauptschalter kostet dich nichts, während ein Rückbau Tage kostet.