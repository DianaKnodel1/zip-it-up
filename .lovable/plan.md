# Verschwindende Nachrichten im Mitarbeiter-Chat – Ursache gefunden

## Was ich geprüft habe

- Datenbank-Regeln: Nachrichten werden **nicht** gelöscht. Die Lese-Regel erlaubt jedem Nutzer alle Nachrichten, bei denen er Absender oder Empfänger ist. Löschen darf nur der eigene Absender.
- Chat-Widget (`FloatingChat`) und Chat-Seite (`/chat`): beide laden den Verlauf **ausschließlich für das Paar Mitarbeiter ↔ aktuell zugewiesener Teamleiter** (`profiles.team_leader_id`).
- Admin-Chat (`admin.chat.tsx`): beim Senden wird nur dann im Namen des Teamleiters gesendet, wenn ein Teamleiter hinterlegt **und** der Absender ein Admin-Mitarbeiter ist. In allen anderen Fällen ist der Absender die **eigene Admin-Kennung**.

## Ursache

Nachrichten, die von einer anderen Kennung kommen als der aktuell hinterlegte Teamleiter, fallen beim Mitarbeiter aus dem Filter heraus:

- Antwort kam vom Haupt-Admin (nicht vom zugewiesenen Teamleiter) → Nachricht ist in der Datenbank, wird aber nie angezeigt.
- Der Mitarbeiter hatte noch keinen Teamleiter (`team_leader_id` leer) → Widget zeigt gar nichts an.
- Teamleiter wurde gewechselt → der komplette bisherige Verlauf verschwindet auf einen Schlag.

Das passt exakt zum Bild „nach dem Schließen und erneuten Öffnen sind die neuen Nachrichten weg": im laufenden Fenster erscheinen sie kurz über Realtime, beim Neuladen filtert die Abfrage sie wieder heraus.

## Fix

1. **Verlauf gesprächsübergreifend laden**: In `FloatingChat` und auf `/chat` alle Nachrichten laden, an denen der Mitarbeiter beteiligt ist (`sender_id = ich ODER receiver_id = ich`), statt nur das Paar mit dem Teamleiter. Interne KI-/Eskalations-Notizen bleiben clientseitig ausgeblendet.
2. **Realtime gleichziehen**: Eingehende Nachrichten werden akzeptiert, sobald der Mitarbeiter Absender oder Empfänger ist — unabhängig davon, welche Admin-Kennung geantwortet hat.
3. **Widget auch ohne Teamleiter zeigen**: Chat-Button und Verlauf erscheinen auch dann, wenn (noch) kein Teamleiter zugewiesen ist; gesendet wird an den Teamleiter, sonst an die zuletzt antwortende Admin-Kennung.
4. **Ungelesen-Zähler** entsprechend auf „alle empfangenen ungelesenen Nachrichten" umstellen.
5. **Gegenprüfung** im Preview: Nachricht senden, Widget schließen, erneut öffnen, Seite neu laden — Verlauf muss vollständig bleiben; zusätzlich Antwort vom Admin-Konto gegenprüfen.

## Technische Details

- `src/components/FloatingChat.tsx`: Query-Filter, Realtime-Guard, Unread-Count, Empfänger-Ermittlung.
- `src/routes/_employee/chat.tsx`: gleicher Query-Filter, veraltete serverseitige `ilike`-Ausschlüsse entfernen (sie verwerfen Zeilen ohne Text), Realtime-Guard.
- Keine Datenbank-Änderung nötig. Die offene Migration `20260828000000_chat_conversations_unique_user.sql` (Ungelesen-Markierung) läuft beim Deploy über `bash scripts/migrate.sh` mit.

## Danach

Deploy über `scripts/deploy.sh` vom Portal-Server, inklusive Migrationen.
