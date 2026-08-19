# Seriösere Termin-Texte + Systemprüfung + Deploy

## 1. Formulierung überarbeiten

Die aktuelle Sprache ("Es ruft Sie niemand an", "Start per Button") klingt salopp. Sie wird durch eine sachliche, professionelle Variante ersetzt – die Kernaussage (Videogespräch, Teilnahme über den persönlichen Link, kein Telefonanruf) bleibt vollständig erhalten, weil genau diese Unklarheit die No-Shows verursacht.

Neue Standardformulierung:

> **Ihr Gespräch findet online als Videogespräch statt.**
> Die Teilnahme erfolgt über Ihren persönlichen Zugangslink – ein Telefonanruf erfolgt nicht.
> Bitte öffnen Sie den Link zur vereinbarten Uhrzeit; ein Download ist nicht erforderlich.

Betroffene Stellen:

| Ort | Änderung |
| --- | --- |
| Bestätigungsmail (Hinweisblock oben) | "WICHTIG: …" wird durch den sachlichen Hinweis ersetzt; Button-Text wird zu "Zum Videogespräch" |
| Kalendereintrag (.ics-Beschreibung) | "Online-Bewerbungsgespräch mit … Teilnahme über Ihren persönlichen Zugangslink: …" |
| Buchungsseite, Schritt 2 der Ablauf-Box | "Zur vereinbarten Uhrzeit teilnehmen. Das Gespräch findet online als Videogespräch statt; die Teilnahme erfolgt über Ihren persönlichen Zugangslink aus der Bestätigungsmail (kein Telefonanruf). Dauer: ca. X Minuten." |
| Buchungsseite, Bestätigungsansicht nach der Buchung | analoger sachlicher Satz statt "es ruft Sie niemand an" |

Gleicher Duktus in allen vier Texten, keine Ausrufezeichen, keine Umgangssprache.

## 2. Systemprüfung vor dem Deploy

- Produktions-Build und Typprüfung des Portals laufen lassen.
- Zusage-Kette prüfen: der neue Fast-Track-Resolver liefert die korrekte Portal-Basis (Diagnoseskript `check-registration-links.sh` auf dem Backend-Server, nur lesend).
- Mail-Gesundheit prüfen: `check-mail-health.sh` (pausierte Mandanten, fehlgeschlagene Sendungen, Retry-Queue).
- Sichtprüfung der Buchungsseite in der Vorschau (Ablauf-Box, Bestätigungsansicht).

## 3. Deploy

- **Portal / Frontend** (Server 2): `bash /opt/apps/portal/scripts/deploy.sh`
- **Backend / Edge Function** (Server 1): Repo aktualisieren und `send-booking-confirmation` neu deployen, da der Mailtext dort liegt.
- Nach dem Deploy: eine Testbuchung auslösen und die Bestätigungsmail gegenlesen.

Die genauen Befehle für PuTTY gebe ich nach der Umsetzung im Chat aus.

## Technische Details

- `supabase/functions/send-booking-confirmation/index.ts`: Zeile 42 (Hinweistext), Zeile 373 (ICS-Beschreibung), Button-Beschriftung.
- `src/routes/termin.buchen.$token.tsx`: Zeilen 199–203 (Ablauf-Schritt 2) und Zeile 352 (Bestätigungsansicht).
- Keine Datenbank- oder Logikänderungen; reine Textanpassung plus Prüf- und Deployschritte.