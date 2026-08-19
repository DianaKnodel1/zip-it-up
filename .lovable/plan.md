# Termin- und Auftragsübersicht auf die Ansicht aus der ZIP zurückbauen

## Was ich verglichen habe
Die hochgeladene ZIP ist ein älterer Stand desselben Projekts (04.08.2026). Unterschiede:

- **Aufträge / Vorlagen** (`/admin/tasks`): fast identisch. Der aktuelle Stand hat zusätzlich den Button „Zuweisen" pro Vorlage. Hier ist kein Umbau nötig.
- **Mitarbeiter-Termine** (`/admin/appointments`): komplett anders. Die ZIP-Version ist eine echte **Tabelle**, der aktuelle Stand eine kompakte, nach Tagen gruppierte Zeilenliste ohne Termin-Anlage.

## Was gebaut wird: Termin-Seite wie in der ZIP

Die Seite wird wieder als Tabelle mit diesen Spalten aufgebaut:

```text
Mitarbeiter | Datum | Uhrzeit | Status | Auftrag | Freischaltung | Aktionen
```

Im Detail:

1. **Status direkt in der Zeile änderbar** (Gebucht / Bestätigt / Abgeschlossen / Storniert) über ein Dropdown im Status-Badge.
2. **Auftragsspalte**
   - Kein Auftrag → „Zuweisen": Vorlage wählen, es wird eine Zuweisung angelegt, `release_at` = Termin­zeitpunkt, und die Buchung damit verknüpft.
   - Direkt danach öffnet sich automatisch der Dialog **„Individuelle Daten"** (Auftragsnummer, SMS-Nummer, PDF) für diesen Mitarbeiter — wie in der ZIP.
   - Auftrag vorhanden → Vorlagenname + Link „Individuell".
3. **Freischaltungs-Spalte**: „Freigegeben", „Noch gesperrt · Datum/Uhrzeit" oder „Admin freigeschaltet". Für gesperrte Termine gibt es den Button **„Freischalten"** (setzt `admin_override` und gibt den verknüpften Auftrag sofort frei).
4. **„Termin erstellen"**: Dialog mit Mitarbeiter, Datum (Kalender), Uhrzeit (00:00–23:30 in 30-Min-Schritten) und optionaler Auftragsvorlage. Der Termin ist sofort manuell freigeschaltet; wurde eine Vorlage gewählt, öffnet sich anschließend der Individuell-Dialog.
5. **Status-Filter** oben rechts, Sortierung: neueste Termine zuerst.
6. **Löschen** je Zeile.

## Was aus dem aktuellen Stand erhalten bleibt
- Button **„Automatisch zuweisen (n)"** in der Kopfzeile (Auto-Zuweisung 15 Min. vor Termin) — die ZIP kannte das noch nicht, es geht sonst verloren.
- Badge-Unterscheidung **„Auto zugewiesen" / „Manuell zugewiesen"** in der Auftragsspalte.
- Bewerbungstermine bleiben ausgeblendet (es gibt hier keine eigene Bewerbungstermin-Seite).
- Direktlink „Öffnen" zur Personenakte in der Aktionsspalte.

Die Suchleiste und die Umschalter „Nur offene" / „Vergangene ausblenden" entfallen, da die ZIP-Ansicht stattdessen mit dem Status-Filter arbeitet.

## Technisch
- `src/routes/admin.appointments.tsx` wird auf die Tabellen-Variante der ZIP umgebaut (Status-Update, Delete, `assignTask`, `createBooking`, `toggleAdminOverride`), ergänzt um `planAutoAssignments`/`runAutoAssignments` aus `src/lib/auto-assign`.
- Wiederverwendet: `AssignmentIndividualData`, `AdminDataContext` (`allBookings`, `profiles`, `templates`, `assignments`), `getAssignableEmployees`.
- Der bestehende `AssignTaskDialog` wird auf dieser Seite nicht mehr gebraucht, bleibt aber für `/admin/tasks` erhalten.
- Keine Schema- oder Backend-Änderung nötig; alle Spalten (`admin_override`, `assignment_id`, `release_at`) existieren.
- Abschluss: Typecheck + Sichtprüfung der Seite.
