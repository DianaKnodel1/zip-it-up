# Statistik-Fix, KI-Chat als Vorschlag-Assistent, Online/Offline im Chat

## 1. „Nicht erschienen" zählt 0 — Ursache gefunden

Im Code geprüft:
- Die Datenbank-Automatik (`auto_complete_and_noshow_appointments`) setzt No-Show auf **`interview_appointments.status`**.
- Die Bewerbungsseite lädt aber ausschließlich die Tabelle **`bookings`** (`AdminDataContext`, `BOOKING_OVERVIEW_COLUMNS`) und wertet nur `bookings.status` und `applications.booking_status` aus.
- Ergebnis: Der von der Automatik gesetzte No-Show kommt in der Oberfläche nie an → Chip bleibt bei 0. Wer nicht erschienen ist, landet stattdessen unter „Interview" (Termin verstrichen → `auswertung_fehler`), was den Interview-Zähler aufbläht.

Fix:
- `AdminDataContext` lädt zusätzlich `interview_appointments` (Termin-Zeit + Status + `application_id`).
- Die Termin-Zuordnung auf der Bewerbungsseite berücksichtigt beide Quellen; der neueste Termin gewinnt, `no_show`/`cancelled` aus **beiden** Tabellen zählen.
- **Zusätzliche Sicherung, falls der Cron nicht läuft:** Termin liegt mehr als 45 Minuten in der Vergangenheit, kein Interview gestartet und keine Entscheidung getroffen → wird als „Nicht erschienen" gezählt (statt wie heute unter „Interview").
- Reihenfolge bleibt: Nicht erschienen / Abgesagt gewinnen gegen Empfehlung und Zusage.
- Kontrolle: Die Summe der Chips muss „Alle" ergeben; das prüfe ich nach der Änderung an den echten Zahlen (139 gesamt).

## 2. KI-Chat — nur Vorschläge, immer deine Freigabe

Grundregel, die überall gilt: **Die KI sendet nie selbst.** Jede Antwort erscheint als Vorschlag im Eingabefeld, du liest, änderst und sendest. Nach außen ist der Absender immer der Teamleiter — keine Kennzeichnung als „KI" oder „Assistent", kein Bot-Avatar, kein Hinweistext beim Mitarbeiter.

Umgesetzt wird nur:
- **Wissensbasis statt Allgemeinplätze:** Der Vorschlag bekommt den Kontext des Mitarbeiters (offene Aufträge und deren Status, nächster Termin, Onboarding-Stand, Vertragsstatus) plus eine gepflegte FAQ-Liste. Dadurch beantwortet der Vorschlag „Wo finde ich meinen Auftrag?", „Wann ist mein Termin?", „Wie läuft die Legitimation?" konkret statt allgemein.
- **Stil bleibt wie bisher:** aus deinen bisherigen Nachrichten gelernt, inkl. Lernen aus deinen Korrekturen.
- **FAQ-Pflege:** kleine Admin-Seite, auf der du Frage/Antwort-Paare hinterlegst, die die KI verwenden darf.

Gestrichen (auf deinen Wunsch): automatische Antworten, Kennzeichnung als Assistent, Sammelantworten in der Chat-Übersicht, Eskalationsregeln, Nachtmodus.

Der öffentliche Support-Chat („KI Chat" im Floating-Widget) bleibt davon unberührt; im direkten Mitarbeiter-Teamleiter-Chat antwortet ausschließlich du.

## 3. Online/Offline direkt im Chat umschalten

Heute kommt der Online-Status aus `profiles.leader_online` bzw. den Tenant-Einstellungen und ist nur in den Einstellungen änderbar.

- Im Admin-Chat (`/admin` Chat-Ansicht) kommt oben ein Schalter „Online / Offline" mit farbigem Punkt — ein Klick schreibt den Status sofort und gilt für alle Mitarbeiter.
- Mitarbeiter-Ansicht (Teamleiter-Karte und Chat-Kopf) zeigt entsprechend:
  - Online: „Ich bin online. Ich antworte in der Regel innerhalb weniger Minuten."
  - Offline: „<Name>, schreib mir — ich antworte innerhalb der nächsten Stunden."
- Der Status aktualisiert sich beim Mitarbeiter live (Realtime), ohne Neuladen.

## Technische Details

- `src/contexts/AdminDataContext.tsx`: zusätzliche Abfrage `interview_appointments` (id, application_id, starts_at, status).
- `src/routes/admin.bewerbungen.tsx`: Termin-/Statusquelle zusammenführen, `computePhase` um die 45-Minuten-Regel ergänzen, Chip-Summenprüfung.
- `src/lib/ai-chat-helper.functions.ts`: Kontext-Loader (Aufträge, Termin, Onboarding) + FAQ-Einträge in den Systemprompt; Rückgabe bleibt reiner Vorschlagstext.
- Neue Tabelle `chat_faq` (Frage, Antwort, aktiv, Mandant) inkl. GRANTs und RLS, plus Admin-Pflegeseite.
- Online/Offline: Schreibpfad auf `profiles.leader_online` des Teamleiters, Realtime-Abo in `use-team-leader.ts`, Texte in `TeamLeaderCard` und Chat-Kopf.
- Nach dem Merge auf dem Server einmal `bash scripts/migrate.sh`.
