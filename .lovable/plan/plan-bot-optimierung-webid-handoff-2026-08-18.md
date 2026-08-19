# Plan - Bot-Optimierung & WebID-Handoff

Optimierung des Bot-Workflows für Bank-Aufträge (DKB, Deutsche Bank etc.) sowie Finalisierung des Handoffs für die Legitimation und des WebID-Sim-Servers.

## Änderungen

### Bot-Workflow (Legitimation & Vorgangsnummer)
- **Bots (Server-Logik)**: Der Bot wird angewiesen, nach Erstellung des Girokontos die **Vorgangsnummer** (TID) auszulesen, bevor er bei der Legitimation (Identifizierung) stoppt.
- **Deutsche Bank Profil**: Spezifische Behandlung für den Ausweis-Check. Der Bot bereitet alles vor, macht einen Screenshot und übergibt dann für den Upload (entweder durch Admin oder Mitarbeiter).
- **Status-Übergabe**: Klarere Trennung zwischen "Bot läuft", "Vorgangsnummer erhalten" und "Wartet auf Legitimation".

### WebID-Simulation & Handoff
- **Sim-Server**: Sicherstellung, dass der Simulations-Server (`webid-digitaldgi.de` etc.) POST-Anfragen blockiert, außer wenn explizit freigegeben, um Fehlbuchungen zu vermeiden.
- **Handoff-UI**: Optimierung der Checkliste im Admin-Bereich: Ein Link zur "Simulation" wird direkt neben dem "Daten im Antrag prüfen"-Button angezeigt, falls eine Simulationsdomain registriert ist.
- **Dokumentation**: Aktualisierung der internen Hilfe für die Domain-Registrierung und den Platzhalter `{vorgangsnummer}`.

### System-Status Check
- Prüfung der automatischen Zuweisung (Dubletten-Schutz) und der KI-Chat-Lernfunktion (Style-Learning).

## Technische Details
- Anpassung in `src/lib/bots.server.ts` für die Handoff-Logik.
- Erweiterung der `AssignmentBotPanel.tsx` Komponente um direkte Simulations-Links.
- Verfeinerung des `bot-automation.functions.ts` für die KI-generierten Anweisungen.

## Benutzer-Impact
- Der Admin sieht sofort, wenn der Bot die Vorgangsnummer erfolgreich erfasst hat.
- Der Ausweis-Check kann gezielt manuell durchgeführt werden, während der Rest automatisiert bleibt.
- Keine Gefahr von Live-Buchungen auf Simulations-Domains durch standardmäßiges POST-Blocking.
