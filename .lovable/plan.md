# Aufträge automatisch zuweisen – mit manueller Ausnahme pro Vorlage

## Ziel
Die meisten Aufträge werden ohne dein Zutun an Termine der Mitarbeiter verteilt. Vorlagen, die du selbst steuern willst (z. B. Bank-/Bot-Aufträge), bleiben strikt manuell. Kein Mitarbeiter bekommt dieselbe Vorlage zweimal.

## Regeln
1. **Automatik-Fenster:** Startet ein Termin in <= 15 Minuten und hat noch keinen Auftrag, wird automatisch der nächste passende Auftrag zugewiesen.
2. **Manuelle Vorlagen:** Jede Auftragsvorlage hat einen Schalter „Automatisch verteilen" / „Nur manuell". Manuelle Vorlagen werden von der Automatik nie angefasst – nur du weist sie zu.
3. **Nie doppelt:** Vor jeder Zuweisung wird über alle bestehenden Zuweisungen des Mitarbeiters geprüft (auch alte und manuelle). Bereits vergebene Vorlagen fallen raus.
4. **Dein Plan gewinnt:** Hat der Termin schon eine Zuweisung, passiert nichts.
5. **Kennzeichnung:** Jede Zuweisung ist als „automatisch" oder „manuell" markiert und im Termin-Überblick sichtbar.

## Was gebaut wird
- **Vorlagen-Übersicht (`admin.tasks.index.tsx`):** pro Vorlage ein Badge „Auto" / „Manuell" plus Umschalter, der `assignment_mode` direkt speichert. So entscheidest du je Auftrag, was die Automatik darf.
- **Auftrags-Builder (`admin.tasks.builder.$templateId.tsx`):** derselbe Schalter in den Einstellungen der Vorlage, damit neu angelegte Bot-/Bank-Aufträge sofort auf „Nur manuell" gesetzt werden können.
- **Zuweisen-Dialog (`AssignTaskDialog.tsx`):** manuelle Vorlagen bleiben hier wählbar (sie sind ja dein Werkzeug) und werden mit dem Hinweis „nur manuell" gekennzeichnet; bereits zugewiesene Vorlagen bleiben ausgeblendet.
- **Termine (`admin.appointments.tsx`):** Badge „Auto zugewiesen" / „Manuell zugewiesen" / „Offen"; der Button „Automatisch zuweisen" überspringt manuelle Vorlagen (schon in der Planungslogik hinterlegt).
- **Automatik im Hintergrund:** die Cron-Route `/api/public/auto-assign-cron` läuft minütlich und nutzt exakt dieselbe Auswahl-Logik wie der Button.

## Technisch
- Die Spalten `task_templates.assignment_mode` ('auto' | 'manuell'), `task_assignments.assignment_group` und `auto_assigned_at` existieren bereits in `supabase/manual-migrations/20260823000000_...` und `20260824000000_auto_assign_15min.sql`. Erster Schritt: `bash scripts/migrate.sh` bzw. `scripts/verify-backend.sh` ausführen und bestätigen, dass beide Migrationen auf der Datenbank angewendet sind.
- `src/integrations/supabase/types.ts` kennt `assignment_mode` noch nicht → Typen für `task_templates` ergänzen, damit der Umschalter ohne `as any` typsicher ist.
- Auswahl-Logik bleibt zentral in `src/lib/auto-assign.ts` (`autoEligibleTemplates` filtert `assignment_mode !== 'manuell'`), genutzt von Button und `auto-assign.server.ts`.
- Cron-Eintrag in `RUNBOOK.md` dokumentieren:
  `* * * * * curl -fsS "https://mb-portal.com/api/public/auto-assign-cron?key=<CRON_SECRET>"`

## Offen für dich
Falls die Automatik statt „nächste freie Vorlage in Erstellungsreihenfolge" einer festen Reihenfolge je Mandant folgen soll (`tenant_default_tasks`), sag Bescheid – das wäre eine kleine Erweiterung der Auswahlfunktion.
