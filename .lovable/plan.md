# Statistik, Dublettenschutz, Auftrag ändern – plus Bot-Erklärung

## 1. „Nicht erschienen" zeigt 0 (Screenshot 1)

Geprüft: Die Chips lesen nur `applications.booking_status`. Der No-Show-Status wird aber an einer anderen Stelle gesetzt: die Datenbank-Funktion aus `20260717000000_booking_confirmation_and_autocomplete.sql` setzt bei verstrichenen Terminen `bookings.status = 'no_show'`. `applications.booking_status = 'no_show'` wird nur gesetzt, wenn Calendly ausdrücklich ein No-Show-Event schickt — deshalb steht der Zähler auf 0.

Zweiter Punkt: Die Reihenfolge der Prüfungen in `computePhase` stellt Entscheidung (Zusage/Absage) über den Termin-Zustand. Wer nicht erschienen ist und trotzdem eine Empfehlung bekommen hat, landet in „Zusage erteilt" statt in „Nicht erschienen".

Fix:
- Die Buchungs-Zuordnung liefert künftig nicht nur den Termin-Zeitpunkt, sondern auch den Buchungs-Status.
- `computePhase` wertet `bookings.status = 'no_show'` gleichwertig zu `applications.booking_status = 'no_show'` aus, und zwar **vor** Zusage/Absage-Bewertung (ausgenommen echte Ablehnung durch dich).
- Gleiches für `cancelled`, damit „Abgesagt" konsistent zählt.
- Ergebnis: Nicht erschienene Bewerber tauchen im Chip „Nicht erschienen" und in der Liste auf.

## 2. Kann ein Mitarbeiter denselben Auftrag doppelt bekommen?

Aktueller Stand (geprüft):
- Die **Automatik** ist sicher: `planAutoAssignments` und der DB-Trigger prüfen beide vorher alle vorhandenen Zuweisungen. Dort kann keine Dublette entstehen.
- **Manuell ist es möglich.** Der Zuweisen-Dialog direkt auf der Terminseite (`admin.appointments.tsx`) filtert nichts und warnt nicht — er legt die Zuweisung stumm ein zweites Mal an. Nur der separate `AssignTaskDialog` filtert.
- In der Datenbank gibt es **keine** eindeutige Regel auf `(user_id, task_template_id)`, nur einen Index.

Fix (dreifach abgesichert):
1. **Datenbank:** neue Migration mit `UNIQUE (user_id, task_template_id)` auf `task_assignments`. Damit ist eine Dublette technisch unmöglich — egal über welchen Weg.
2. **Terminseite:** der Zuweisen-Dialog blendet bereits vergebene Vorlagen aus bzw. zeigt sie ausgegraut mit dem Hinweis „bereits zugewiesen" und Status („in Bearbeitung" / „erledigt"). Der Zuweisen-Button bleibt in dem Fall deaktiviert.
3. **Klartext-Meldung:** Läuft trotzdem ein Insert auf die Unique-Regel, erscheint statt einer technischen Fehlermeldung: „Dieser Mitarbeiter hat den Auftrag bereits — Status: <Status>." (gleiche Meldung in beiden Dialogen).

Falls in der Datenbank schon Dubletten liegen, kann die Unique-Regel nicht greifen. Die Migration räumt deshalb vorher auf: pro (Mitarbeiter, Vorlage) bleibt die Zuweisung mit dem weitesten Fortschritt bzw. die älteste erhalten, verwaiste Kopien werden entfernt und `bookings.assignment_id` auf die verbleibende Zuweisung umgehängt.

## 3. Zugewiesenen Auftrag nachträglich ändern (Screenshot 2)

Heute ist der Vorlagen-Name in der Termin-Zeile nur Text; änderbar ist nichts.

Fix: Der Name wird klickbar und öffnet den Dialog „Auftrag ändern":
- Anzeige des aktuellen Auftrags samt Status.
- Auswahl einer anderen aktiven Vorlage — bereits zugewiesene Vorlagen sind gesperrt (siehe Punkt 2).
- Zwei Aktionen: **Auftrag ersetzen** (Vorlage der bestehenden Zuweisung wird umgestellt, solange der Mitarbeiter noch nicht begonnen hat) und **Zuweisung entfernen** (Verknüpfung zum Termin lösen, Zeile geht zurück auf „Zuweisen").
- Hat der Mitarbeiter den Auftrag bereits bearbeitet/abgeschlossen, wird das Ersetzen mit Hinweis blockiert — dann nur „Entfernen und neu zuweisen" nach Rückfrage.
- Umschalter „Auto/Manuell zugewiesen" bleibt sichtbar; nach manueller Änderung wird die Zuweisung als „manuell" markiert, damit die Automatik nicht dagegenarbeitet.

## 4. Wie der Bot funktioniert (Screenshot 3) — Erklärung, kein Code

Ablauf in einfachen Worten:

```text
Du startest einen Lauf  →  Eintrag in der Warteschlange (Status "In Warteschlange")
        ↓
Bot-Runner (eigener Dienst auf dem Server) holt den nächsten Lauf ab
        ↓
Öffnet einen echten Browser, arbeitet die Schritte des Profils ab
(Seite öffnen, Felder füllen, klicken, warten, Screenshot)
        ↓
Kommt eine Stelle, die kein Bot darf (VideoIdent, TAN, Captcha):
Status "Wartet auf Admin"  →  du übernimmst manuell
        ↓
Sonst: Status "Fertig" bzw. "Fehlgeschlagen" mit Log
```

Warum bei dir dauerhaft „In Warteschlange" steht: Der Lauf liegt korrekt in der Queue, aber **es holt ihn niemand ab**. Der Bot-Runner ist ein separater Prozess (`bot-runner/`, Bun + Playwright) auf dem Server — er läuft nicht im Portal mit. Steht der Dienst nicht (oder fehlt ein freier Proxy, denn ohne Proxy startet er standardmäßig nicht), bleibt der Lauf ewig auf „In Warteschlange".

Konkret zu tun auf dem Server:
- `systemctl status bot-runner` prüfen, ggf. `systemctl enable --now bot-runner`.
- Logs: `journalctl -u bot-runner -f`.
- Sicherstellen, dass unter „Proxys" mindestens ein aktiver Eintrag existiert (oder `REQUIRE_PROXY=false` zum Testen).

Zusätzlich in der Oberfläche (`/admin/bots`), damit das sichtbar wird:
- Eine Statuszeile „Bot-Runner: aktiv / seit X Minuten kein Lebenszeichen" — abgeleitet daraus, wann zuletzt ein Lauf gestartet/aktualisiert wurde.
- Beim Status „In Warteschlange" ein Hinweistext: „Wartet auf den Bot-Runner. Läuft der Dienst auf dem Server? Ist ein aktiver Proxy hinterlegt?"

## Technische Umsetzung
- `src/routes/admin.bewerbungen.tsx`: `bookingByApp` liefert `{ date, status }`; `computePhase` bekommt den Buchungsstatus und priorisiert `no_show`/`cancelled`.
- Neue Migration `supabase/manual-migrations/2026082500000_task_assignment_unique.sql`: Dubletten bereinigen + `UNIQUE (user_id, task_template_id)`.
- `src/routes/admin.appointments.tsx`: Dublettenfilter im Zuweisen-Dialog, neuer Dialog „Auftrag ändern" (Update von `task_assignments.task_template_id` bzw. Lösen von `bookings.assignment_id`), sprechende Fehlermeldung bei Unique-Verletzung (Postgres-Code `23505`).
- `src/components/admin/AssignTaskDialog.tsx`: gleiche Fehlermeldung bei `23505`.
- `src/routes/admin.bots.tsx`: Runner-Heartbeat-Hinweis und Erklärtext bei Status `queued`.
- Nach dem Merge auf dem Server einmal `bash scripts/migrate.sh` laufen lassen.
