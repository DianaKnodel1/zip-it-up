# Notfallplan: Server weg — Stand in 1-2 Stunden zurückholen

## Der Unterschied kurz erklärt

| | Wenige Stunden (empfohlen) | Unter 30 Minuten |
|---|---|---|
| Wie | Neuen Server bestellen, Setup-Skript laufen lassen, letztes Backup einspielen | Zweiter Server läuft dauerhaft mit, Daten werden ständig gespiegelt, im Notfall nur DNS umstellen |
| Kosten | 1 kleiner Backup-Server (~5 EUR/Monat) | Doppelte Serverkosten, dauerhaft |
| Datenverlust | Maximal seit dem letzten Backup (nachts + alle 6 Std = max. 6 Std) | Fast keiner |
| Aufwand | Gering, ein Skript | Hoch: Replikation, Monitoring, Umschaltlogik |

Für dieses Projekt reicht Variante 1 klar aus: Bewerbungen und Aufträge sind
keine Sekunden-kritischen Zahlungsdaten. Wir bauen sie so, dass später auf
Variante 2 erweitert werden kann.

## Was heute schon da ist (geprüft)

- `scripts/deploy-backend.sh` macht vor jeder Migration einen `pg_dump` — aber
  nur **auf demselben Server**. Ist der Server weg, ist auch das Backup weg.
- Kein Zeitplan, kein zweiter Ort, kein Skript zum Zurückspielen.
- Der Code liegt sicher auf GitHub (`zip-it-up`) — Code ist also nie das Problem.
  Das Problem sind **Datenbank, Uploads/Dokumente und Landing-Konfiguration**.

## Was wir bauen

### 1. Backup-Server (der Extra-Server, den du kaufen willst)
Kleinste Linux-VPS reicht aus: **Ubuntu 22.04 LTS oder 24.04 LTS**, 2 vCPU, 4 GB RAM,
80–160 GB SSD. Zum Beispiel Hetzner Cloud CX21 (2 vCPU/4 GB/80 GB) oder vergleichbar
bei deinem Hosting-Anbieter. Der Server nimmt nur Sicherungen entgegen, betreibt
keine Dienste — dadurch ist er kaum angreifbar. Wichtig: 24/7 erreichbar mit
fester IP und SSH-Key-Zugang (kein Passwort).


### 2. Nächtliches Backup-Skript auf dem Backend-Server
`scripts/backup.sh` sichert alles Wichtige in ein Archiv pro Lauf:
- kompletter Datenbank-Dump (`pg_dump`)
- Storage-/Upload-Verzeichnisse (Dokumente, Verträge, Logos, Landing-Assets)
- Konfigurationsdateien (`.env.server`, Caddy-Konfig, systemd-Units)

Danach wird das Archiv per `rsync` über SSH auf den Backup-Server geschoben.
Zeitplan über systemd-Timer: täglich 03:00 Uhr voll, alle 6 Stunden nur DB.
Aufbewahrung: 14 Tage täglich, 3 Monatsstände. Alte werden automatisch gelöscht.

### 3. Landing-Server und Portal-Server mitsichern
Auf beiden läuft dasselbe Skript in kleiner Form (Konfig + lokale Daten).
Der Landing-Server hält seine Inhalte ohnehin aus der Datenbank — er ist damit
in Minuten neu aufsetzbar.

### 4. Wiederherstellungs-Skript
`scripts/restore.sh <archiv>` spielt auf einem frischen Server zurück:
Datenbank importieren, Uploads entpacken, Konfiguration wiederherstellen,
Dienste starten. Ein Befehl statt Handarbeit.

### 5. Notfall-Handbuch `docs/DISASTER-RECOVERY.md`
Schritt für Schritt, in einfacher Sprache:
1. Neuen Server bestellen, IP notieren
2. Setup-Skript ausführen (Portal / Backend / Landing / Bot / WebID)
3. Letztes Backup vom Backup-Server holen
4. `restore.sh` ausführen
5. DNS auf die neue IP zeigen
6. Prüfliste: Login, Bewerbungsformular, Landing-Seite, Mailversand, Bot-Lauf

Dazu eine Tabelle: welcher Server macht was, welche DNS-Einträge zeigen wohin,
welche Zugangsdaten werden gebraucht (und wo sie liegen).

### 6. Backup-Überwachung
Nach jedem Lauf schreibt das Skript einen Status ins Portal
(`automation_log`). Im Admin-Bereich unter Infrastruktur wird angezeigt:
„Letztes Backup: heute 03:00, 412 MB, OK". Bleibt es länger als 26 Stunden aus,
erscheint eine rote Warnung — damit du nie ein stilles Backup-Loch hast.

### 7. Probe-Wiederherstellung
Einmal eingerichtet, testen wir den Ernstfall einmal echt durch: Backup auf
einen Wegwerf-Server einspielen und prüfen, dass Portal und Daten laufen.
Ein Backup, das nie zurückgespielt wurde, ist kein Backup.

## Technische Details

- Backups verschlüsselt (`age`/`gpg`) vor dem Upload; Schlüssel wird dir einmalig
  ausgegeben und gehört in deinen Passwortmanager.
- SSH-Key-only-Zugang zum Backup-Server, eigener Nutzer, kein Root, kein Passwort.
- DB-Dump per `docker exec <db-container> pg_dump -U postgres -Fc` (custom format,
  schnell und selektiv wiederherstellbar), gzip-komprimiert.
- Prüfsumme je Archiv, Restore bricht bei kaputtem Archiv ab.
- Retention über `find -mtime`; Monatsstände per Hardlink, kein doppelter Platz.
- `restore.sh` bricht ab, wenn die Ziel-Datenbank nicht leer ist (kein
  versehentliches Überschreiben eines laufenden Systems).

## Reihenfolge der Umsetzung

1. `scripts/backup.sh` + systemd-Timer + Backup-Server-Einrichtungsskript
2. `scripts/restore.sh`
3. `docs/DISASTER-RECOVERY.md`
4. Backup-Status im Admin-Bereich (Infrastruktur)
5. Gemeinsamer Probelauf
