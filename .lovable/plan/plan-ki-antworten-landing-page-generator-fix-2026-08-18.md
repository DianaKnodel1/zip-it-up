# Plan: KI-Antworten & Landing-Page Generator Fix

Der Nutzer berichtet, dass keine KI-Antwortvorschläge erscheinen und der Landing-Page Generator nicht mehr öffnet. Zudem soll der Bot-Status und die Server-Bereitschaft geprüft werden.

## Nutzer-Anliegen
- **KI-Antworten**: Warum erscheinen keine Vorschläge?
- **Landing-Page Generator**: Seite öffnet nicht (vermutlich Backend-Inkonsistenz).
- **Bot-Automatisierung**: Status prüfen und sicherstellen, dass alles läuft.
- **Deployment**: Backend auf den neuesten Stand bringen und alles ausliefern.

## Analyse & Strategie

### 1. KI-Antworten (Admin-Chat)
Der Code in `src/routes/admin.chat.tsx` zeigt zwar die Infrastruktur für KI-Vorschläge (`getAiSuggestion`), aber im UI-Teil (um Zeile 900+) fehlt die sichtbare Komponente, die den Entwurf anzeigt, bevor er gesendet wird.
- **Problem**: Die UI zeigt den `suggestion`-Status nicht an oder der Trigger zum Laden fehlt beim Auswählen eines Chats.
- **Lösung**: Den Button zum Generieren eines KI-Vorschlags im Chat-Input-Bereich prominent platzieren und sicherstellen, dass er den Stil von "Martin Schneider" nutzt.

### 2. Landing-Page Generator
Der Pfad `src/routes/admin.landing-generator.tsx` existiert. Wenn er nicht öffnet, liegt es oft an Laufzeitfehlern in Loadern oder fehlenden Tabellen im Backend.
- **Problem**: Die Seite nutzt viele Server-Funktionen (`listLandingPages`, `listPartnerCompanies`, `adminListSchedules`). Wenn eine dieser Tabellen fehlt, bricht TanStack Start beim Rendern ab.
- **Lösung**: Fehlerbehandlung im UI verbessern und sicherstellen, dass die Migrationen (insb. für Partner-Firmen und Termine) im Backend aktiv sind.

### 3. Bot-Automatisierung
Der Bot nutzt `src/lib/bots.server.ts` und erfordert `bot_profiles` und `bot_runs`. 
- **Check**: Die Migration für diese Tabellen muss eingespielt sein.
- **Server**: Da es sich um eine Headless-Browser-Automatisierung handelt, muss der `bot-worker` (Playwright) auf dem Zielsystem laufen.
- **Lösung**: Hinweistext für den Nutzer ergänzen, wie er den Worker-Dienst auf seinem Server startet.

### 4. Deployment & Backend
- **Aktion**: Alle manuellen Migrationen zusammenfassen und den Nutzer anleiten, `deploy.sh` auszuführen.

## Technische Details
- UI-Fix in `admin.chat.tsx`: `Sparkles`-Button für KI-Vorschläge hinzufügen.
- Debugging `admin.landing-generator.tsx`: Try-Catch um Initial-Loads.
- Update `scripts/verify-backend.sh`: Zusätzliche Checks für `landing_pages` und `partner_companies`.

## Schritte
1.  **KI-UI**: Button für "KI-Vorschlag" in das Chat-Interface einbauen.
2.  **Generator-Fix**: Die Route `admin.landing-generator.tsx` robuster gegen fehlende Daten machen.
3.  **Backend-Check**: `verify-backend.sh` erweitern.
4.  **Deployment-Guide**: Kurze Anleitung für den Nutzer.
