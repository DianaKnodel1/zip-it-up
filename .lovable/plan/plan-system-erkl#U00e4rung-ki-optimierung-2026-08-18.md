# Plan: System-Erklärung & KI-Optimierung

Dieser Plan adressiert die Fragen zur automatischen Zuweisung, zur Funktionsweise der KI-Unterstützung und zur Klärung der Infrastruktur (WhatsApp/Bots).

## Änderungen

### 1. Automatische Zuweisung & Dublettenschutz
*   **Logik-Check**: Die bestehende PostgreSQL-Funktion `auto_assign_default_task_on_booking` implementiert bereits einen Dublettenschutz (prüft `count(*) > 0` für dieselbe Vorlage).
*   **15-Minuten-Regel**: Aktuell erfolgt die Zuweisung direkt bei der Buchung. Da Calendly-Termine oft kurzfristig sind, ist die Zuweisung zum Buchungszeitpunkt der sicherste Weg. Eine zeitverzögerte Zuweisung (15 Min vorher) würde einen Cron-Job erfordern, der das System verkompliziert.
*   **Manuelle Kontrolle**: Wenn ein Auftrag manuell zugewiesen wurde oder die Vorlage auf `assignment_mode = 'manuell'` steht, greift die Automatik nicht.

### 2. KI-Chat & "Martin Schneider"-Stil
*   **Zweck**: Die KI dient als Schreibassistent für den Admin (Martin Schneider). Sie generiert Entwürfe basierend auf dem bisherigen Chatverlauf und dem persönlichen Stil des Admins.
*   **Optimierung**:
    *   Anpassung des `systemPrompt` in `getAiSuggestion`, um explizit darauf hinzuweisen, dass die KI dem Teamleiter helfen soll, auf die letzte Nachricht des Mitarbeiters zu reagieren.
    *   Sicherstellung, dass manuelle Korrekturen des Admins über `logAiCorrection` gespeichert werden, damit die KI aus diesen Änderungen lernt.

### 3. Infrastruktur-Klärung
*   **WhatsApp**: Die Spalte `whatsapp_number` in der Tabelle `tenants` dient der Hinterlegung einer offiziellen Kontaktnummer für das Portal (z.B. für den Footer oder Support-Hinweise). Sie steuert aktuell keinen automatischen Versand (da "Mailless Mode" aktiv ist).
*   **Bot-Status**: Die Bots für Consorsbank, DKB, Deutsche Bank, Santander und comdirect sind so konfiguriert, dass sie die Antragsstrecke bis zur Kontoerstellung/Vorgangsnummer (TID) durchlaufen. Danach übernimmt der Mensch für VideoIdent.

## Technische Details

### Dateien
*   `src/lib/ai-chat-helper.functions.ts`: Verfeinerung der Prompt-Instruktionen.
*   `src/components/admin/AssignmentBotPanel.tsx`: Präzisierung der Bot-Hinweistexte.

### Datenbank
*   Die Trigger-Funktion `auto_assign_default_task_on_booking` in der Migration `20260823000000_assignment_groups_bots_proxies.sql` stellt sicher, dass keine doppelten Aufträge entstehen.

## Erklärungen für den Nutzer

*   **Zuweisung**: Das System prüft bei jeder Buchung, ob der Mitarbeiter die Standard-Aufgabe schon hat. Wenn ja, passiert nichts. So wird verhindert, dass jemand denselben Auftrag zweimal bekommt.
*   **KI**: Das Glitzern-Icon ist dein Assistent. Es "liest" die letzte Nachricht des Mitarbeiters und schlägt dir eine Antwort vor, die so klingt wie du. Wenn du den Vorschlag änderst und abschickst, merkt sich die KI das für das nächste Mal.
*   **WhatsApp**: Das ist nur ein Feld in den Einstellungen, damit deine Mitarbeiter wissen, unter welcher Nummer sie dich (Martin Schneider) erreichen können.
*   **Bot**: Du startest den Bot im Admin-Panel beim jeweiligen Auftrag. Er füllt alles aus. Sobald die Bank die "Vorgangsnummer" anzeigt, stoppt er. Du nimmst dann diese Nummer, trägst sie ein und gibst den Auftrag für den Mitarbeiter frei, damit dieser den Ausweis-Check machen kann.
