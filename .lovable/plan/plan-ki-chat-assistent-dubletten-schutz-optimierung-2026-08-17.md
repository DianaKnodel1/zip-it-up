# Plan: KI-Chat-Assistent & Dubletten-Schutz Optimierung

Dieses Dokument beschreibt die geplanten Änderungen zur Verbesserung des Teamleiter-KI-Assistenten, zur Verfeinerung des Dubletten-Schutzes und zur weiteren Automatisierung des KYC-Bots.

## User-Facing Changes
- **Individuelle KI-Teamleiter**: Der Chat-Assistent erkennt nun den spezifischen Teamleiter der jeweiligen Firma und antwortet in dessen Namen und individuellem Stil.
- **Transparenter Dubletten-Schutz**: Beim Zuweisen eines Auftrags wird sofort angezeigt, ob der Mitarbeiter diesen Auftrag bereits hat. Ein Doppelt-Zuweisen ist möglich, erfordert aber eine explizite Bestätigung.
- **Bearbeitbare Zuweisungen**: Neu zugewiesene Aufträge können nun auch nach der Erstellung flexibel angepasst oder korrigiert werden.
- **Volle Bot-Automatisierung**: Der KYC-Bot kann nun den gesamten Auftragsprozess inkl. Vorgangsnummer-Abruf vollautomatisch durchführen.
- **Bereinigter Chat**: Der KI-Chat für Mitarbeiter wurde entfernt. Es gibt nur noch den direkten Draht zum Teamleiter, der durch KI-Vorschläge unterstützt wird.

## Technical Details

### 1. KI-Teamleiter & Schreibstil-Anpassung
- **Dynamische Persona**: `getAiSuggestion` in `src/lib/ai-chat-helper.functions.ts` wird erweitert, um den `team_leader_id` des Firmenprofils zu laden. Der Prompt wird basierend auf dem Teamleiter-Namen und dessen bisherigen Nachrichten dynamisch generiert.
- **Stil-Lernen**: Die KI analysiert die letzten manuell bearbeiteten Antworten des spezifischen Teamleiters, um Satzbau und Tonalität zu spiegeln.
- **Nur für Teamleiter**: Die `src/routes/api/public/ai-chat.ts` (Mitarbeiter-Bot) wird deaktiviert oder auf eine einfache "Warte auf Antwort"-Nachricht reduziert.

### 2. Dubletten-Schutz & Zuweisungs-Logik
- **UI-Indikator**: In der Auftrags-Zuweisung (Modaler Dialog oder Liste) wird eine Prüfung gegen `task_assignments` implementiert, die "Bereits zugewiesen" anzeigt.
- **Zuweisungs-Override**: Die `createAssignment`-Logik erhält ein `force_duplicate`-Flag. Wenn `false` und Dublette gefunden -> Fehler mit Bestätigungsanforderung.
- **Edit-Modus**: Die Route `admin.assignments.$assignmentId.tsx` wird so angepasst, dass Felder auch im Status `zugewiesen` oder `geplant` editierbar bleiben (entfernen von `readOnly` Beschränkungen).

### 3. KYC-Bot Vollautomatisierung
- **Prozess-Kette**: `createAssignmentAutomation` in `src/lib/bot-automation.functions.ts` wird um einen "Auto-Run" Modus erweitert.
- **Vorgangsnummer-Logik**: Integration einer (simulierten oder API-basierten) Abfrage-Logik für die KYC-Vorgangsnummern der Zielbanken.
- **Trigger**: Optionale Checkbox "Automatisch starten" bei der Zuweisung eines neuen Auftrags.

### 4. Admin-Struktur Cleanup
- **Navigation**: Entfernen der letzten Reste von "Mitarbeiter-Termine" (falls noch vorhanden) und "Mitarbeiter-KI-Chat" aus dem `AdminLayout`.
- **Zugriffsschutz**: Harte Prüfung in `AdminLayout`, dass nur der Haupt-Admin (keine `admin_mitarbeiter` Rollen mehr) Zugriff auf sensible Bereiche hat.

## Strategic Direction
Wir bewegen uns weg von generischen Bots hin zu einem hocheffizienten "Copilot"-System für den Teamleiter, das Routineaufgaben (Compliance-Texte, Dublettenprüfung) übernimmt, aber die finale Kontrolle beim Menschen belässt.
