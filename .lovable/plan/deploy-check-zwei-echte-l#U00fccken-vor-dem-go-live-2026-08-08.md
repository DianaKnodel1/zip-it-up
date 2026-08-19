# Deploy-Check: zwei echte Lücken vor dem Go-Live

Typprüfung läuft sauber durch, und die Protokollierung in `/admin/bewerbungen` greift (Buchung, Absage, No-Show, Interview-Start/-Ende, Zusage/Absage, Stage-Historie, Calendly-Webhook-Log). Beim Durchgehen der drei Wege — Bewerbung, Terminbuchung, Interview — sind aber zwei Stellen aufgefallen, die im Calendly-Test Bewerber verlieren würden.

## 1. `/bewerbung` schickt Calendly-Bewerber auf die falsche Buchungsseite

Wer seine E-Mail eingibt und noch **keinen** Termin hat, wird immer auf die interne Terminauswahl geleitet. Bei einer Calendly-Landingpage gibt es dort keinen Kalender — der Bewerber sieht „Buchung derzeit nicht möglich" und ist raus.

Fix: Der Lookup erkennt die Buchungsart der zugehörigen Landingpage. Ist sie „Calendly", geht die Weiterleitung auf den Calendly-Link der Seite, mit Name, E-Mail, Telefon und Bewerbungs-ID vorbefüllt — also derselbe Weg wie über die Danke-Karte. Nur bei interner Buchung bleibt es bei der eigenen Terminauswahl. Fehlt bei einer Calendly-Seite der Link, erscheint eine verständliche Meldung statt der Kalender-Fehlermeldung.

## 2. Weiterleitung zur Partnerfirma nach der Zusage

Der Hauptweg ist korrekt: Der Registrierungslink wird serverseitig über die verknüpfte Fast-Track-Seite bzw. den Fast-Track-Tenant aufgelöst, landet also auf der Partner-Domain (`portal.<partnerfirma>/register`) — und die Zusage-Karte leitet nach 8 Sekunden automatisch dorthin weiter, mit vorbefüllter E-Mail.

Der **Notfall-Fallback** ist aber falsch: Kann der Server keinen Link bilden, nimmt die Seite die aktuelle Browser-Adresse — bei Vermittlungs-Bewerbungen also die Vermittlungs-Domain statt der Partnerfirma. Der Bewerber würde sich beim falschen Unternehmen registrieren.

Fix: Das Interview liefert die aufgelöste Portal-Basis der Partnerfirma mit aus (dieselbe Kette, die auch die Zusage-Mail nutzt). Die Zusage-Karte nutzt diese Basis; fehlt sie wirklich, wird statt eines Links der Hinweis auf die E-Mail gezeigt — lieber kein Link als der falsche.

## Calendly: Mailversand

Bleibt wie gebaut und geprüft: Bei Buchungsart „Calendly" verschickt das Portal keine Eingangsbestätigung, keine Terminbestätigung, keine Termin- oder Nachfass-Erinnerungen (Protokoll-Vermerk `calendly_handles_mail`). Mail, SMS und Kalendereintrag kommen ausschließlich von Calendly. Beim internen Buchungssystem läuft die volle Mailkette weiter, damit der A/B-Vergleich sauber bleibt.

Nicht betroffen sind Zusage-/Registrierungsmails nach dem Interview — die gehören nicht zur Terminlogik und gehen weiter raus (der Bewerber kommt aber ohnehin per Auto-Weiterleitung direkt zur Registrierung).

## Technische Details

- `src/routes/api/public/application-lookup.ts`: `booking_mode` der aufgelösten Landing mitladen; bei `calendly` `redirect_url` auf `calendly_url` + Prefill-Query (`name`, `email`, Telefon, `utm_content=<appId>`) setzen; ohne Link `reason: "calendly_missing"` zurückgeben.
- `src/routes/bewerbung.index.tsx`: externe Redirect-URLs per `window.location.href` öffnen, Meldung „Sie werden zur Terminbuchung weitergeleitet".
- `src/routes/api/public/interview-chat.ts`: `resolveFasttrackPortalBase(applicationId)` aufrufen und als `portal_base` in den Antworten (`init`, `message`, `end`) mitgeben.
- `src/routes/interview.$appId.tsx`: `portalBase` aus der Serverantwort bevorzugen; `window.location.origin` als Quelle für den Registrierungslink entfernen; ohne Basis `registrationLink = null`.

## Danach

Build und Typprüfung laufen lassen; dann ist der Stand aus meiner Sicht deploy-fähig.