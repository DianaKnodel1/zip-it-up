# Mitarbeiter-Termine aufräumen + "Zuweisen" funktionsfähig machen

## Problem (geprüft)
- Die Terminliste zeigt pro Buchung eine große Karte mit Telefonnummer und "Keine E-Mail". Grund: `bookings` enthält keine Kontaktdaten (nur `user_id`, Datum, Zeit, Status), die Seite fällt deshalb auf Profil-Telefon zurück und zeigt bei fehlender E-Mail den Platzhalter.
- "Zuweisen" navigiert nur nach `/admin/mitarbeiter` — es passiert nichts. Im gesamten Projekt gibt es **keine** Stelle, die eine Zuweisung anlegt (`task_assignments` wird nur gelesen/aktualisiert). Das gleiche gilt für den "Zuweisen"-Button in der Auftrags-Übersicht.

## Was gebaut wird

### 1. Aufgeräumte Terminliste
- Kompakte Zeilen statt großer Karten, gruppiert nach Tag ("Heute", "Morgen", Datum) mit Sortierung: kommende Termine zuerst, vergangene ausgegraut ans Ende.
- Pro Zeile: Uhrzeit, Mitarbeitername, Status-Badge und ein Badge "Auftrag zugewiesen" / "Offen".
- Telefonnummer und E-Mail nicht mehr prominent — Telefon nur als kleines, dezentes Detail, "Keine E-Mail" entfällt komplett (Mailless-Modus).
- Filter oben: Suche nach Name, Umschalter "Nur offene Termine" und "Vergangene ausblenden".

### 2. "Zuweisen" wird echt
Klick öffnet einen Dialog, der eine Zuweisung tatsächlich anlegt:
- Auswahl der Auftragsvorlage (aktive Vorlagen aus `task_templates`).
- Freigabezeitpunkt: standardmäßig auf Datum/Uhrzeit des Termins vorbelegt (`release_at`), manuell änderbar.
- Optionales Feld "Individueller Hinweis".
- Beim Speichern: Eintrag in `task_assignments` (Mitarbeiter aus der Buchung, Vorlage, `release_at`, Status offen) und Verknüpfung der Buchung über `bookings.assignment_id`, damit Termin und Auftrag zusammenhängen.
- Dubletten-Schutz: Hat der Termin bereits eine Zuweisung, zeigt die Zeile stattdessen "Auftrag öffnen" und führt zur Zuweisungs-Detailseite.
- Erfolgsmeldung als Toast, Liste lädt danach neu.

### 3. Konsistenz
- Der "Zuweisen"-Button in der Auftrags-Übersicht bekommt denselben Dialog (Vorlage vorbelegt, Mitarbeiter wählbar), statt nur zur Mitarbeiterliste zu springen.

## Technisch
- Neue Komponente `src/components/admin/AssignTaskDialog.tsx` mit Insert in `task_assignments` + optionalem Update von `bookings.assignment_id`; genutzt von `src/routes/admin.appointments.tsx` und `src/routes/admin.tasks.index.tsx`.
- `admin.appointments.tsx` wird auf kompakte, gruppierte Liste umgebaut; Zuweisungsstatus über die bereits geladenen `assignments` aus `AdminDataContext`.
- Keine Schemaänderung nötig — alle Spalten (`release_at`, `individual_hint`, `bookings.assignment_id`) existieren bereits.
