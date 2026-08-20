# Prüfbericht: WhatsApp-Button + Sofortstart

## Was bereits fertig ist (geprüft)

- WhatsApp-Button ist eingebunden auf `/bewerbung`, `/register`, `/interview/:id` und im gesamten Mitarbeiterportal; er wird nur angezeigt, wenn er aktiviert ist und eine gültige Nummer/URL hinterlegt ist.
- Admin-Karte „WhatsApp-Support" liegt in Einstellungen → Tab „Bewerbung" (Schalter + Nummer/Link + Link-Vorschau).
- Sofortstart: Server-Gates („noch zu früh" / „kein Termin") im Interview-Chat sind entfernt; E-Mail-Eingabe auf `/bewerbung` leitet immer direkt ins Gespräch, keine Terminbuchung/Umbuchung mehr.
- Hinweistext „Bei technischen Problemen teilen Sie uns dies bitte mit." ist auf der Gesprächsseite vorhanden.
- Typecheck läuft fehlerfrei durch.

## Offene Punkte

1. **Migration noch nicht eingespielt** — solange `whatsapp_number` / `whatsapp_enabled` und die Funktion `get_public_whatsapp_support()` in der Datenbank fehlen, bleibt der Button unsichtbar und das Speichern in der Admin-Karte schlägt fehl. Nach dem Deploy einmal `bash scripts/migrate.sh` ausführen.

2. **Toter Code auf der Gesprächsseite** — Warte-Screen mit Countdown, der „kein Termin"-Zustand und die 5-Sekunden-Auto-Retry-Schleife sind noch im Code, werden aber nie mehr angezeigt (Server liefert diesen Zustand nicht mehr). Aufräumen, damit niemand versehentlich wieder eine Wartesperre aktiviert.

3. **Kein Feedback, wenn WhatsApp aktiviert, aber nicht erreichbar** — aktuell verschwindet der Button einfach stillschweigend, wenn die Datenbankabfrage scheitert. Kleine Absicherung: Fehler in der Konsole protokollieren, damit man das im Zweifel diagnostizieren kann.

## Umsetzung (technisch)

- `src/routes/interview.$appId.tsx`: `WaitingScreen`-Komponente, States `scheduledAt` / `notBooked`, der `__notYet`-Zweig in `init()` und der Auto-Retry-`useEffect` werden entfernt; die Hilfsprüfung in `postInterview` (Status 425 / `not_yet` / `not_booked`) fällt weg, Fehler werden normal behandelt.
- `src/hooks/use-whatsapp-support.ts`: RPC-Fehler zusätzlich per `console.warn` ausgeben, Verhalten sonst unverändert (Cache, `buildWhatsAppHref`).
- Keine Datenbank-Änderungen über die bestehende Migration `supabase/manual-migrations/20260829000000_whatsapp_support.sql` hinaus.

## Danach

Deploy wie gewohnt (`bash scripts/deploy.sh`), anschließend `bash scripts/migrate.sh`, dann in den Admin-Einstellungen die WhatsApp-Nummer eintragen und den Schalter aktivieren.
