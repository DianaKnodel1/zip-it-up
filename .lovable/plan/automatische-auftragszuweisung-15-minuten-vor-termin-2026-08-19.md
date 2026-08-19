# Automatische Auftragszuweisung 15 Minuten vor Termin

## Ziel
Termine werden ohne dein Zutun mit einem Auftrag versorgt — aber nur dort, wo du selbst noch nichts geplant hast. Alles bleibt jederzeit von dir überschreibbar.

## Regeln
1. **Auslöser:** Ein Termin startet in <= 15 Minuten und hat noch keinen Auftrag → automatische Zuweisung.
2. **Nie überschreiben:** Hat der Termin bereits eine Zuweisung (`bookings.assignment_id`), passiert nichts. Dein Plan gewinnt immer.
3. **Keine Dubletten:** Ein Mitarbeiter bekommt dieselbe Auftragsvorlage nie zweimal — geprüft über **alle** vorhandenen Zuweisungen des Mitarbeiters, inklusive der aus vergangenen Terminen und der manuell angelegten.
4. **Kennzeichnung:** Jede Zuweisung wird als „automatisch" oder „manuell" markiert. Automatische Zuweisungen kannst du im Portal auf eine andere Vorlage umstellen oder auf „manuell" setzen — danach fasst die Automatik sie nicht mehr an.
5. **Nur zukünftige Termine:** Die Automatik greift ausschließlich im 15-Minuten-Fenster vor dem Termin. Vergangene Termine bleiben unberührt und weist du selbst zu.

## Vergangene Termine
- Die Terminliste bekommt einen klaren Umschalter „Vergangene anzeigen" (bleibt beim Neuladen erhalten), damit die verpassten Termine sichtbar sind.
- Pro vergangenem Termin: Status „Offen" bzw. „Auftrag zugewiesen" und die Aktionen „Zuweisen" / „Neu zuweisen".
- Der Zuweisen-Dialog blendet Vorlagen aus, die dieser Mitarbeiter schon hat — auch aus alten Terminen.

## Sichtbar im Portal
- Badge pro Termin: „Auto zugewiesen" (blass) vs. „Manuell zugewiesen" (kräftig) vs. „Offen".
- In der Zuweisungs-Detailseite: Umschalter „Diesen Auftrag als manuell übernehmen" und Auswahl einer anderen Vorlage (mit Dublettenprüfung).
- Der bestehende Button „Automatisch zuweisen" bleibt für manuelles Nachziehen erhalten.

## Technisch
- **Migration:** Spalten `assignment_source text default 'manual'` (Werte `manual` | `auto`) und `auto_assigned_at timestamptz` auf `task_assignments`; Index auf `bookings(assignment_id)` und `bookings(booking_date, booking_time)`.
- **Cron-Endpunkt:** neue Server-Route `src/routes/api/public/auto-assign-cron.ts`, geschützt über `?key=<CRON_SECRET>` (gleiches Muster wie `sms-poll-cron.ts`). Läuft minütlich per Cron auf .123.
- **Server-Logik:** `src/lib/auto-assign.server.ts` — lädt offene Buchungen im Fenster `now .. now+15min` ohne `assignment_id`, lädt alle `task_assignments` des jeweiligen Mitarbeiters, wählt die erste aktive Vorlage ohne Dublette, legt die Zuweisung mit `assignment_source='auto'`, `status='zugewiesen'`, `release_at = Terminzeit` an und setzt `bookings.assignment_id`. Idempotent: Vor dem Insert wird `assignment_id` erneut geprüft.
- Die vorhandene Client-Funktion `src/lib/auto-assign.ts` wird auf dieselbe Auswahl-Logik reduziert (gemeinsame reine Planungsfunktion), damit Button und Cron identisch entscheiden.
- **UI:** `src/routes/admin.appointments.tsx` (Badges, persistenter Vergangenheits-Filter), `src/components/admin/AssignTaskDialog.tsx` (Quelle `manual` beim Speichern), `src/routes/admin.assignments.$assignmentId.tsx` (Vorlage ändern + „als manuell übernehmen").
- **Cron-Eintrag** wird in `RUNBOOK.md` dokumentiert: `* * * * * curl -fsS "https://mb-portal.com/api/public/auto-assign-cron?key=<CRON_SECRET>"`.
