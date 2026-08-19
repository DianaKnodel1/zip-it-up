# Calendly-Ablauf wie beim Kollegen — sauberer A/B-Test gegen die interne Buchung

## Kurze Antwort vorweg: welche Methode ist besser?

Der Ablauf des Kollegen ist strukturell im Vorteil — nicht weil Calendly "besser" ist, sondern weil dabei drei Dinge zusammenkommen, die bei uns fehlen:

1. **Kein Bruch nach dem Formular.** Der Bewerber landet sofort auf einer Danke-Karte mit genau einem Button und bucht im selben Moment. Bei uns geht eine Mail raus und der Bewerber muss sie erst finden.
2. **Calendly erinnert per Mail *und SMS* und legt einen Kalendereintrag an.** Das ist der eigentliche Hebel gegen No-Shows — unsere eigenen Mails haben weder SMS noch Kalendereintrag.
3. **Ein Zugang ohne Ablaufdatum** (`/bewerbung` + E-Mail) statt Token-Links, die nach Storno/Neubuchung ins Leere laufen.

Deshalb bauen wir den Kollegen-Ablauf nach — behalten aber die interne Buchung unverändert, damit du mit zwei parallelen Kampagnen echte Zahlen vergleichen kannst.

## Was gebaut wird

### 1. Calendly-Seiten: null eigene Mails
- Bei Buchungsart "Calendly" verschickt das System **keine** Eingangsbestätigung mehr und legt auch keine Erinnerungen an (kein 24h/72h-Nachfassen, keine eigene Terminbestätigung) — Calendly übernimmt Mail, SMS und Kalendereintrag allein.
- Bei interner Buchung bleibt alles exakt wie heute. Damit ist der Vergleich sauber.
- Im Mail-Protokoll erscheint das als bewusster Verzicht ("Calendly übernimmt Versand"), nicht als Fehler.

### 2. Danke-Karte direkt auf der Landingpage
- Nach dem Absenden erscheint auf derselben Seite die Erfolgs-Karte: Häkchen, "Wir haben Ihre Bewerbung erhalten", "Wir verbinden Sie mit [Firma]", darunter ein Button "Jetzt Termin buchen".
- Der Button öffnet Calendly in einem neuen Tab, mit Name, E-Mail und Telefonnummer vorbefüllt und der Bewerbungs-ID zur Zuordnung.
- Die automatische Weiterleitung über die Zwischenseite entfällt in diesem Modus (Weiterleitungen werden häufig von Browsern/Blockern geschluckt).

### 3. Interview-Einstieg über `/bewerbung`
- `/bewerbung` wird der offizielle Einstieg: E-Mail eingeben → System erkennt den Stand und zeigt direkt den Chat (oder weist auf den noch offenen Termin hin). Keine Token-Links mehr, die kaputtgehen.
- Diese URL gehört in die Calendly-Event-Beschreibung, damit sie im Kalendereintrag und in Calendlys Erinnerungen steht.
- Die Seite bekommt denselben klaren Aufbau wie beim Kollegen: Begrüßung mit Namen, "So läuft es ab" in drei Schritten, Hinweise, Chat rechts.

### 4. Nach der Zusage sofort registrieren
- Der Zusage-Button führt direkt auf die Registrierungsseite der Firmendomain mit **vorbefüllter E-Mail** — kein Warten auf eine Mail, kein Token.
- Automatische Weiterleitung nach wenigen Sekunden bleibt, sichtbarer Button als Rückfallebene.
- Nach der Registrierung: kurze Bestätigung und direkter Übergang ins Onboarding.

### 5. Zahlen zum Vergleichen
- In der Bewerber-Übersicht kommt ein Filter "Buchungsart" (Calendly vs. intern) dazu.
- Die No-Show-Auswertung wird nach Buchungsart getrennt: Bewerbung → Termin gebucht → erschienen → Zusage → registriert → Onboarding fertig.

## Technische Details

- `src/routes/api/public/applications.ts`: Versandentscheidung an `booking_mode` koppeln; im Calendly-Modus `application_received` überspringen (Log-Status `skipped`, Grund `calendly_handles_mail`) und statt `redirect_url` ein Block-Objekt für die Inline-Danke-Karte zurückgeben.
- `supabase/functions/send-application-reminders` und `send-appointment-reminders`: Bewerbungen im Calendly-Modus überspringen.
- Landing-Themes (`src/landing-themes/*`, `landing-server`): gemeinsame Erfolgs-Karte, die dieses Objekt rendert; ersetzt die Auto-Weiterleitung.
- `src/routes/bewerbung.index.tsx`: Layout nach Vorbild des Kollegen; Lookup führt bei gebuchtem Termin direkt in den Chat.
- `src/components/interview/ZusageCard.tsx` + `src/routes/interview.$appId.tsx`: Registrierungslink immer auf `<portal>/register?email=...`, Token-Link nur noch ergänzend.
- `src/routes/register.tsx`: E-Mail aus der URL vorbefüllen.
- `src/lib/no-show-analysis.functions.ts`, `admin.no-show-analyse.tsx`, `admin.bewerbungen.tsx`: Kennzahlen nach Buchungsart aufschlüsseln.

## Voraussetzung auf deiner Seite

Im Calendly-Event müssen gesetzt sein: SMS-Erinnerung aktiv, Mail-Erinnerung 24h und 1h vorher, und in der Event-Beschreibung der Link auf `portal.<deine-domain>/bewerbung`.

## Nicht Teil dieses Plans

Bestehende interne Buchungsseiten werden inhaltlich nicht verändert — sie bleiben als Vergleichsgruppe unangetastet.