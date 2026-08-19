# Bot-Runner aktivieren und Vorgangsnummer automatisch erfassen

## Bestätigte Ursache

- Der Lauf bleibt nicht wegen des hinterlegten Proxys in der Warteschlange, sondern weil der eigenständige `bot-runner`-Dienst auf keinem Server installiert ist. Die systemd-Unit existiert bisher nur als Beispiel in der Dokumentation.
- Der Runner ist für den Portal-Server `.124` vorgesehen; der Backend-Server `.123` stellt Datenbank und Queue bereit.
- Das aktuelle Deploy aktualisiert und startet nur das Portal. Es installiert oder startet den Runner nicht.
- Das Feld „Vorgangsnummer“ im Startdialog ist technisch optional, wird aber fälschlich vor dem Lauf angezeigt. Der Runner besitzt aktuell keinen Schritt zum Auslesen und Speichern einer von der Bank erzeugten Vorgangsnummer.
- Die vorhandenen Bankprofile enden derzeit nach den Formularschritten mit Screenshot/Handoff; eine automatische Extraktion der Vorgangsnummer ist noch nicht implementiert.

## Änderungen

### 1. Runner auf dem Portal-Server dauerhaft einrichten
- Ein Setup-Skript für den Runner ergänzen, das im Verzeichnis `bot-runner` die Abhängigkeiten und Chromium installiert.
- Eine echte `bot-runner.service` unter systemd erzeugen, aktivieren und starten.
- Die vorhandene geschützte Server-Umgebung verwenden; der Runner akzeptiert den bereits vorhandenen Service-Key-Namen, sodass kein Geheimnis in Code oder Unit-Datei geschrieben wird.
- Headless-Betrieb und Proxy-Pflicht explizit aktivieren; automatischer Neustart bei Absturz bleibt eingeschaltet.

### 2. Deploy selbstheilend machen
- `scripts/setup-server2.sh` so erweitern, dass Portal und Runner beim Erst-Setup gemeinsam installiert werden.
- `scripts/deploy.sh` so erweitern, dass der Runner nach jedem Code-Deploy ebenfalls aktualisiert und neu gestartet wird.
- Vor dem Neustart prüfen, ob Unit, Abhängigkeiten und Chromium vorhanden sind; fehlende Bestandteile automatisch nachinstallieren.
- Am Deploy-Ende den Dienststatus prüfen und bei einem Fehler das Deployment mit einer klaren Meldung abbrechen, statt erfolgreich zu melden, während die Queue stehen bleibt.

### 3. Startdialog korrigieren
- Das Eingabefeld „Vorgangsnummer“ aus dem Bot-Startdialog entfernen.
- Im Dialog verständlich anzeigen: Der Bot verwendet die Mitarbeiterdaten, arbeitet bis zur Kontoeröffnung beziehungsweise Vorgangsnummer und stoppt vor VideoIdent/TAN.
- Proxy-Anzeige beibehalten, aber zusätzlich den Runner-Status beziehungsweise einen klaren Hinweis bei länger wartenden Läufen anzeigen.

### 4. Vorgangsnummer im Runner erfassen
- Die Schritt-DSL um einen Extraktionsschritt erweitern, der Text aus einem Element oder der Bestätigungsseite liest und über ein konfiguriertes Muster die Vorgangsnummer ermittelt.
- Die extrahierte Nummer sofort in `bot_runs.vorgangsnummer` speichern.
- Bei auftragsbezogenen Läufen dieselbe Nummer zusätzlich in `task_assignments.individual_case_number` speichern, damit Admin-Freigabe und Mitarbeiteransicht dieselbe Nummer verwenden.
- Wenn die Kontoeröffnung erreicht wurde, aber keine Nummer erkannt wird, nicht fälschlich „erfolgreich“ melden: Screenshot erstellen und mit einem klaren Prüfhinweis an den Admin übergeben.

### 5. Bankprofile bis zum richtigen Übergabepunkt führen
- DKB, Deutsche Bank, Consorsbank, comdirect und Santander um die jeweils notwendigen Fortsetzungs-, Bestätigungs- und Extraktionsschritte ergänzen.
- Handoff erst nach erkannter Vorgangsnummer oder unmittelbar vor dem nicht automatisierbaren Identifikationsschritt auslösen.
- Captcha, VideoIdent, PostIdent, SMS-/photoTAN bleiben manuell; der Bot versucht nicht, diese Schutzschritte zu umgehen.

## Prüfung

- Runner auf `.124` installieren und mit `systemctl is-active bot-runner` sowie den Dienstlogs prüfen.
- Einen Testlauf mit aktivem Proxy einreihen und bestätigen, dass er innerhalb des Poll-Intervalls von `queued` auf `running` wechselt.
- Proxy-Verwendung, Schrittprotokoll, Screenshot und Fehlerstatus kontrollieren.
- Pro Bankprofil prüfen, dass die Vorgangsnummer erst nach der Antrags-/Kontoeröffnung gespeichert wird und der Lauf anschließend auf „Wartet auf Admin“ wechselt.
- Abschließend einen normalen Portal-Deploy durchführen und bestätigen, dass Portal und Runner beide aktiv bleiben.

## Ergebnis für den Admin

Der Admin wählt nur Mitarbeiter und Bankprofil aus. Der Bot nimmt den Lauf mit einem aktiven Proxy auf, füllt den Antrag bis zur erzeugten Vorgangsnummer aus, speichert diese automatisch und übergibt erst dann für Legitimation oder eine notwendige manuelle Prüfung.