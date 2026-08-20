# WhatsApp-Button im Portal + Bewerbungsgespräch sofort startbar

## 1. WhatsApp-Hilfebutton (unten links)

Ein runder WhatsApp-Button unten links mit Label „Probleme, Fragen?", der beim Klick den hinterlegten WhatsApp-Chat öffnet (neuer Tab).

- Eine **globale** Nummer/Link für alle Mandanten, plus ein Schalter zum Ein-/Ausblenden.
- Pflege in den Admin-Einstellungen: Feld „WhatsApp-Nummer/Link" + Schalter „WhatsApp-Button anzeigen".
- Sichtbar auf:
  - `/bewerbung` (Einstieg) und der Gesprächsseite `/interview/:id`
  - `/register` (Registrierung im Portal)
  - allen Seiten im eingeloggten Mitarbeiterportal
- Positionierung unten links, damit sie das bestehende Chat-Widget unten rechts nicht überdeckt; auf Mobil kompakt (nur Icon).
- Hinweistext auf der Bewerbungsseite bleibt unverändert; darunter kommt zusätzlich der Hinweis, dass man bei Problemen direkt per WhatsApp schreiben kann.

## 2. Bewerbungsgespräch sofort startbar

Heute muss auf den gebuchten Termin gewartet werden bzw. es wird zur Terminauswahl/Umbuchung geleitet. Neu:

- `/bewerbung` → E-Mail eingeben → direkt auf die Willkommensseite mit „Bewerbungsgespräch starten".
- Kein Warte-Countdown mehr: Wer die Seite öffnet, kann sofort starten — auch vor dem Termin.
- Keine Umbuchungs-/Terminauswahl-Weiterleitung mehr im Bewerbungs-Einstieg; auch ohne gebuchten Termin geht es direkt ins Gespräch.
- Der „Kein Termin gebucht"-Screen entfällt zugunsten des direkten Starts.

## Technische Details

- **Daten:** neue Spalten `whatsapp_number` und `whatsapp_enabled` in `public.system_settings` (Singleton-Tabelle, bereits für globale Einstellungen genutzt) per Migration unter `supabase/manual-migrations/`; zusätzlich eine öffentlich lesbare RPC (SECURITY DEFINER) `get_public_whatsapp_support()`, damit auch nicht eingeloggte Bewerber auf `/bewerbung` und `/register` die Nummer erhalten, ohne die restlichen System-Settings offenzulegen.
- **Komponente:** `src/components/WhatsAppSupportButton.tsx` + Hook `use-whatsapp-support.ts` (lädt Nummer/Status einmalig, cached im Modul). Rendert nur, wenn aktiv und Nummer gesetzt; Link `https://wa.me/<nur Ziffern>` bzw. übernimmt eine vollständige URL unverändert. Inline-SVG WhatsApp-Logo (kein externes Asset).
- **Einbindung:** `src/components/EmployeeLayout.tsx`, `src/routes/register.tsx`, `src/routes/bewerbung.index.tsx`, `src/routes/interview.$appId.tsx`.
- **Admin-UI:** Karte „WhatsApp-Support" in `src/routes/admin.settings.tsx` (Schalter + Nummer/Link, speichert in `system_settings`).
- **Sofortstart:** in `src/routes/interview.$appId.tsx` Warte-Screen (`scheduledAt`-Gate) und `notBooked`-Screen entfernen; in `src/routes/api/public/interview-chat.ts` die 425-Gates (`not_yet` / `not_booked`) entfernen, sodass der Chat unabhängig vom Terminzeitpunkt startet; in `src/routes/api/public/application-lookup.ts` immer auf `/bewerbung?token=…` weiterleiten statt auf Terminauswahl/Calendly.
- Migration wird nach dem Deploy mit `bash scripts/migrate.sh` eingespielt.
