# Plan: Systemoptimierung für Bot, WebID und KI-Stil

Wir optimieren die Verzahnung zwischen der Bot-Automatisierung, dem WebID-Modul und der Lernfähigkeit der KI.

## Änderungen

### 1. Bot-Automatisierung & WebID-Verknüpfung
- Der Bot wurde aktualisiert (`src/lib/bot-automation.functions.ts`), um nicht nur die Anleitung, sondern auch den **WebID-Auftraggeber-Namen** und die **Start-URL** automatisch zu setzen.
- Dies ermöglicht es, dass das WebID-Modul sofort nach dem Durchlauf des Bots einsatzbereit ist.
- Im Admin-Bereich (`src/routes/admin.assignments.$assignmentId.tsx`) wurde ein neuer Button **"Daten im Antrag prüfen"** im WebID-Bereich hinzugefügt, um die vom Bot gesetzte URL direkt gegenprüfen zu können.

### 2. KI-Lernfähigkeit & Schreibstil
- Der KI-Chat-Assistent (`src/lib/ai-chat-helper.functions.ts`) wurde instruiert, aus deinen **Anpassungen und Korrekturen** zu lernen.
- Der System-Prompt wurde so erweitert, dass die KI aktiv versucht, den Schreibstil an deine vorherigen Antworten anzupassen, während der Grundton (direktes "Du", unterstützend) beibehalten wird.

### 3. Modul-Verknüpfung
- Die KI "versteht" nun den Zusammenhang zwischen dem Wrangler-Bot und dem WebID-Modul und kann dies Mitarbeitern im Chat präzise erklären (z. B. dass der Bot die Vorgangsnummer für die WebID-Identifizierung vorbereitet).

## Technische Details
- Update der Server-Funktion `createAssignmentAutomation` für zusätzliche WebID-Felder.
- Erweiterung des `getAiSuggestion` Server-Funktions-Prompts um Lern-Instruktionen.
- UI-Anpassung in der Auftrags-Detailseite für den Prüf-Button.
