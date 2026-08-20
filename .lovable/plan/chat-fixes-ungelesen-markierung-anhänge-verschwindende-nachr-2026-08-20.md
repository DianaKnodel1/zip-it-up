# Chat-Fixes: Ungelesen-Markierung, Anhänge, verschwindende Nachrichten

## 1. "Als ungelesen markieren" schlägt fehl

Fehlermeldung im Screenshot: *there is no unique or exclusion constraint matching the ON CONFLICT specification*.

Der Admin-Chat schreibt den Ungelesen-Status per `upsert(..., { onConflict: "user_id" })` auf `chat_conversations`. In der Datenbank gibt es auf `user_id` aber keinen Unique-Index — deshalb bricht jeder dieser Aufrufe ab. Betroffen sind alle vier Stellen: ungelesen setzen, gelesen setzen, Notiz speichern, Chat ausblenden/einblenden.

Fix: neue Migration `supabase/manual-migrations/…_chat_conversations_unique_user.sql`
- vorhandene Duplikate pro `user_id` zusammenführen (neueste Zeile behalten)
- `CREATE UNIQUE INDEX … ON public.chat_conversations (user_id)`

Danach funktionieren alle Upserts (Ungelesen, Notiz, Ausblenden) ohne Codeänderung.

## 2. Mitarbeiter kann keinen Anhang senden

Die Mitarbeiter-Chatseite (`/chat`) hat bereits Anhänge. Das Problem ist das Chat-Widget unten rechts (`FloatingChat`), das der Mitarbeiter im Alltag benutzt: dort gibt es weder einen Upload-Button noch werden Anhänge angezeigt.

Fix in `src/components/FloatingChat.tsx`:
- vorhandene Komponenten `ChatAttachmentButton` / `AttachmentPreview` einbinden (gleiche Logik wie auf der Chatseite)
- Anhangfelder beim Senden mitschreiben und empfangene Anhänge (Bild-Vorschau / Datei-Link) rendern

Zusätzlich wird geprüft, dass der Storage-Bucket `chat-attachments` samt Policies vorhanden ist; falls nicht angewendet, kommt die Migration in denselben Deploy.

## 3. Nachrichten "verschwinden" beim Schließen und erneuten Öffnen

Ursache noch nicht bestätigt — sie wird zuerst verifiziert, dann behoben. Auffällig im Widget:
- Beim Nachladen werden Fehler der Abfrage komplett verschluckt (`const { data } = …` ohne `error`), ein Fehlschlag zeigt sich als leerer Chat.
- Der Verlauf wird nur beim Öffnen geladen und beim Schließen aus dem State geworfen; die Filter (`[ESCALATE]`, Emoji-Muster) können bei einer fehlerhaften Abfrage alles ausblenden.

Vorgehen:
1. Abfragefehler auswerten und im UI anzeigen ("Verlauf konnte nicht geladen werden – erneut versuchen") statt still leer zu bleiben.
2. Filter serverseitig entschlacken und stattdessen im Client filtern (nur echte interne Notizen ausblenden), damit keine normale Nachricht verloren geht.
3. Verlauf beim Schließen im State behalten und beim Öffnen nur nachladen (kein Reset auf leer), plus Deduplizierung der Realtime-Nachrichten.
4. Gegenprüfung mit einem echten Konto: Nachrichten senden, Widget schließen, neu öffnen, Seite neu laden — der Verlauf muss vollständig bleiben.

Nichts wird gelöscht: alle Nachrichten bleiben dauerhaft in `chat_messages` und werden nach dem Fix beim Öffnen vollständig geladen (Limit von 100 auf 200 angehoben, älteste zuerst).

## Technische Details

- Migration: Unique-Index auf `chat_conversations(user_id)` + Dublettenbereinigung
- `src/components/FloatingChat.tsx`: Anhänge senden/anzeigen, robustes Laden, Fehleranzeige, State-Erhalt
- Keine Änderung an Admin-Chat-Logik nötig, sobald der Unique-Index existiert
- Nach dem Deploy müssen die manuellen Migrationen laufen (`bash scripts/migrate.sh`)
