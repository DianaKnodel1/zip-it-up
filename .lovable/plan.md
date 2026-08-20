# Chat-Verlauf zuverlässig anzeigen (Admin + Mitarbeiter)

Ausgangslage laut deiner Beschreibung: Es gibt genau ein Admin-Konto, das in jedem Mandanten der Teamleiter ist — nur der angezeigte Name unterscheidet sich. Genau darauf ist der Code aktuell nicht ausgelegt. Im Code (nicht in der Datenbank, dafür fehlt hier der Zugriff) sind vier Stellen belegt fehlerhaft:

## 1. Mitarbeiter sieht Chat nur bei gesetztem `team_leader_id`

`FloatingChat` und `/chat` laden ausschließlich Nachrichten zwischen Mitarbeiter und `profiles.team_leader_id`. Ist das Feld leer oder zeigt es auf eine alte ID, blendet sich das Widget komplett aus (`if (!teamLeaderId) return null`) und der Verlauf ist scheinbar weg — obwohl alle Nachrichten in `chat_messages` liegen.

Fix: Der Mitarbeiter lädt seinen kompletten Verlauf (alles wo er Sender oder Empfänger ist) statt nur den Verlauf mit einer einzigen ID. Anzeige-Name/Avatar kommen weiter aus Teamleiter- bzw. Mandanten-Einstellungen. Das Widget wird auch ohne gesetzte `team_leader_id` angezeigt; als Empfänger wird dann der Admin des Mandanten aufgelöst.

## 2. Admin-Nachrichten erscheinen im Admin-Chat als fremde Nachrichten

Beim Senden wird teils mit `sender_id = team_leader_id` statt der eigenen User-ID geschrieben. Die Anzeige prüft aber `msg.sender_id === user.id` — solche Nachrichten landen dann links mit Mitarbeiter-Avatar, und die Gruppierung/Ungelesen-Zählung ordnet sie falsch zu.

Fix: Immer mit der echten Admin-User-ID senden; der abweichende Teamleiter-Name wird rein zur Anzeige aufgelöst (Mandanten-Einstellung), nicht über eine andere `sender_id`. Anzeige-Logik: „meine Nachricht" = jede Nachricht von einem Admin-Konto, nicht nur exakt `user.id`.

## 3. Alte Chats fehlen in der Admin-Liste

Die Übersicht lädt global nur die letzten 100 Nachrichten. Bei mehreren aktiven Mitarbeitern fallen ältere Konversationen ganz aus der Liste.

Fix: Übersicht aus `chat_conversations` + letzter Nachricht je Partner aufbauen (kein globales Limit), Verlauf im geöffneten Chat bleibt bei 200 Nachrichten mit Nachladen nach oben.

## 4. Serverseitige Textfilter können Nachrichten schlucken

Im Admin-Chat filtern noch `ilike`-Bedingungen auf `[ESCALATE]` und KI-Eskalations-Texte direkt in der Abfrage. Enthält eine normale Nachricht so einen Text (z. B. weitergeleitet), verschwindet sie samt Konversation.

Fix: Filter clientseitig, wie im Mitarbeiter-Chat bereits umgestellt.

## Gegenprüfung vor dem Deploy

Mit einem echten Mitarbeiterkonto: Nachricht senden, Widget schließen/öffnen, Seite neu laden, Admin antwortet, Mandant wechseln — Verlauf muss in beiden Ansichten vollständig und seitenrichtig sein.

## Technische Details

- `src/components/FloatingChat.tsx`, `src/routes/_employee/chat.tsx`: Verlauf ohne harte `team_leader_id`-Bedingung laden, Empfänger-Auflösung mit Fallback auf den Mandanten-Admin
- `src/routes/admin.chat.tsx`: `sender_id` immer = Admin-ID, `isMine` über Admin-ID-Set, Konversationsliste ohne globales 100er-Limit, `ilike`-Filter nach clientseitig verschieben
- `src/hooks/use-team-leader.ts`: liefert zusätzlich einen Fallback-Empfänger, wenn `team_leader_id` fehlt
- Keine Datenbank-Änderung nötig; der bereits erstellte Unique-Index auf `chat_conversations(user_id)` muss beim Deploy laufen (`bash scripts/migrate.sh`)
