# Katastrophenfall: Server weg — Wiederherstellung in 1-2 Stunden

Dieses Dokument beschreibt Schritt für Schritt, wie du das komplette System
(Frontend, Backend, Landing-Page-Server, Bot-Runner, WebID-Sim) nach einem
Totalausfall wieder aufsetzt.

## Wichtig vorher

- **Code ist sicher**: Das Git-Repository liegt auf GitHub (`zip-it-up`).
- **Daten sind auf dem Backup-Server**: Datenbank, Uploads, Configs, Volumes.
- **Maximaler Datenverlust**: Seit dem letzten Backup — bei täglichem Vollbackup
  + 6-Stunden-DB-Backup maximal 6 Stunden.

## Benötigte Zugangsdaten

| Was | Wo |
|---|---|
| Backup-Server IP | Hosting-Provider / Verwaltungsoberfläche |
| SSH-Key für Backup-Server | In deinem Passwortmanager |
| age-Privater Schlüssel (falls Verschlüsselung aktiv) | In deinem Passwortmanager |
| Domain-Provider | Für DNS-Umschaltung |
| GitHub Deploy-Key / Zugang | Für Notfall-Clone |

## Übersicht: Welcher Server macht was

| Dienst | Server | DNS-Eintrag |
|---|---|---|
| Portal (Frontend) | Portal-Server | portal.deine-domain.de |
| Backend / API | Backend-Server | api.deine-domain.de |
| Landing Pages | Landing-Server | *.deine-domain.de |
| Bot-Runner | Bot-Server | (kein öffentlicher DNS nötig) |
| WebID-Sim | WebID-Server | sim.deine-domain.de |
| Backup | Backup-Server | (kein öffentlicher DNS) |

## 1. Neuen Server bestellen

Für den oder die ausgefallenen Server bestellst du Ersatz. Empfohlene Mindestgrößen:

| Server | vCPU | RAM | Platte |
|---|---|---|---|
| Portal | 2 | 4 GB | 40 GB |
| Backend (Supabase) | 4 | 8 GB | 160 GB |
| Landing | 2 | 4 GB | 40 GB |
| Bot | 4 | 8 GB | 40 GB |
| WebID | 2 | 4 GB | 40 GB |

Installiere auf allen neuen Servern **Ubuntu 22.04 LTS oder 24.04 LTS**.

## 2. Backup-Server erreichen

Von deinem lokalen Rechner oder einem anderen Server:

```bash
ssh root@<BACKUP-SERVER-IP>
ls -lt /var/backups/portal/daily/ | head -5
```

Das neueste Archiv ist die Wiederherstellungsgrundlage.

### 2.1 Backup-Server aufsetzen (empfohlene Variante: Orchestrator)

Kaufe einen kleinen VPS (Ubuntu 22.04/24.04, 2 vCPU, 4 GB RAM, ausreichend SSD).

```bash
# Auf dem Backup-Server als root
bash scripts/setup-backup-server.sh

# Von allen Produktions-Servern erlauben, dass sich der Backup-Server anmeldet:
# Auf Portal, Backend, Landing, Bot, WebID jeweils ausführen:
ssh-copy-id -i /root/.ssh/id_rsa.pub root@<BACKUP-SERVER-IP>
```

Dann auf dem Backup-Server:

```bash
cd /opt/apps/portal
cp scripts/backup-orchestrator.env.example scripts/backup-orchestrator.env
# scripts/backup-orchestrator.env bearbeiten: DB_HOST, SERVER_*_HOST, BACKUP_DIR
bash scripts/install-backup-orchestrator.sh
bash scripts/backup-orchestrator.sh full
```

Wenn das ein Archiv in `/var/backups/portal/daily/` erzeugt, läuft alles.

### 2.2 Alternative: Einzel-Server-Backup

Wenn du keine zentrale Orchestrator-Lösung willst, kannst du auf jedem
Produktions-Server das lokale Backup installieren:

```bash
# Auf dem Backend-Server (wo die DB läuft)
cd /opt/apps/portal
cp scripts/backup.env.example scripts/backup.env
# scripts/backup.env mit BACKUP_HOST, BACKUP_USER, BACKUP_DIR füllen
bash scripts/install-backup-timer.sh
```

Der Nachteil ist keine zentrale Ansicht über alle Server in einem Archiv.

## 3. Archiv auf den neuen Zielserver kopieren


Für den Backend-Server (der wichtigste Teil):

```bash
# Auf dem neuen Backend-Server als root
mkdir -p /opt/apps
# Vom Backup-Server herunterladen
scp -r backup@<BACKUP-SERVER-IP>:/var/backups/portal/daily/<neuestes-archiv>.tar.gz /opt/apps/
# Optional: Checksumme prüfen
cd /opt/apps && sha256sum -c <neuestes-archiv>.tar.gz.sha256
```

## 4. Backend-Server wiederherstellen

### 4.1 Supabase-Stack installieren
Falls du das Supabase-Setup noch nicht automatisiert hast, folge deiner
eigenen Backend-Setup-Anleitung (z. B. `scripts/setup-backend.sh`). Ziel ist
ein laufender Docker-Container `supabase-db` mit einer leeren Datenbank.

### 4.2 Restore-Skript ausführen
```bash
cd /opt/apps/portal
# Repo erneut klonen (falls es fehlt)
git clone https://github.com/DianaKnodel1/zip-it-up.git /opt/apps/portal

# Config anlegen
bash scripts/setup-server2.sh          # Portal + nginx
# Dann Restore:
bash scripts/restore.sh /opt/apps/<neuestes-archiv>.tar.gz
```

Das Skript:
- spielt `.env` und `.env.server` zurück,
- spielt nginx/systemd-Config zurück,
- spielt die Datenbank mit `pg_restore` ein,
- spielt Supabase-Volumes und Storage-Dateien zurück,
- startet die Dienste neu.

### 4.3 Supabase-Edge-Functions neu deployen
```bash
bash scripts/deploy-backend.sh
```

### 4.4 Prüfen
```bash
systemctl status portal nginx
# Supabase-Health
curl https://api.deine-domain.de/auth/v1/health
# Datenbank-Tabellen zählen
docker exec supabase-db psql -U postgres -d postgres -c "SELECT count(*) FROM pg_tables WHERE schemaname='public';"
```

## 5. Portal-Server wiederherstellen

Falls auch der Portal-Server ausgefallen ist:

```bash
# Auf dem neuen Portal-Server
bash scripts/setup-server2.sh
# Repo enthält bereits den Code; nur .env und nginx-Config brauchen evtl. Restore
# Wenn du ein Portal-Backup hast:
bash scripts/restore.sh /opt/apps/portal-....tar.gz
```

Der Portal-Server ist schnell neu aufgesetzt, weil alle Geschäftslogik im Code
und die Daten in der Backend-Datenbank liegen.

## 6. Landing-Server wiederherstellen

```bash
# Auf dem neuen Landing-Server
cd /opt/apps/landing
# Falls Code fehlt: aus Repo herstellen oder vom Backup kopieren
bash scripts/setup.sh   # dein Landing-Server-Setup
systemctl restart landing-server
```

Alle Landing-Inhalte kommen aus der Datenbank, daher reicht meist ein frischer
Code-Stand.

## 7. Bot- und WebID-Server wiederherstellen

Folge `docs/SERVER-SETUP.md` für beide Server. Die kritischen Daten sind:

- Bot-Server: `bot-runner/.env.server`, evtl. lokale Lauf-Logs
- WebID-Server: `/opt/apps/webid-sim/.env`, Caddyfile

Wenn diese im Backup enthalten sind, einfach zurückspielen.

## 8. DNS umschalten

Gehe zu deinem Domain-Provider und ändere die A-Records auf die neuen IPs:

| Subdomain | Neue IP |
|---|---|
| portal | Portal-Server |
| api | Backend-Server |
| sim | WebID-Server |
| * (Wildcard) | Landing-Server |

Wartezeit: 5–30 Minuten je nach TTL. Vorher kannst du mit `curl -v --resolve`
oder durch Einträge in `/etc/hosts` testen.

## 9. End-to-End-Prüfung

| Prüfung | Wie |
|---|---|
| Admin-Login | https://portal.deine-domain.de/login |
| Bewerbungsformular | Öffentliche Landing-Page öffnen, Testbewerbung abschicken |
| Landing-Page | https://landing.deine-domain.de aufrufen, Impressum/Datenschutz prüfen |
| Mailversand | Admin → E-Mail-Vorschau senden |
| Bot-Lauf | Admin → Bots → Testlauf mit aktivem Proxy |
| Datenbank | Letzte Bewerbung und letzte Buchung sichtbar? |

## 10. Wenn etwas nicht klappt

### Datenbank-Restore läuft nicht
- Prüfe, ob `supabase-db` Container läuft: `docker ps`
- Prüfe, ob das Archiv eine `db.dump` enthält: `tar -tzf archiv.tar.gz | grep db.dump`
- Versuche manuell: `docker exec -i supabase-db pg_restore -U postgres -d postgres < db.dump`

### Archiv ist verschlüsselt (.age)
- Installiere `age`: `apt-get install age` oder `bun install -g age-encryption`
- Entschlüssele: `age -d -o archiv.tar.gz archiv.tar.gz.age`
- Privater Schlüssel muss aus dem Passwortmanager kommen.

### Backup-Server ist auch weg
- Prüfe, ob ein lokales Backup auf dem Original-Server noch erreichbar ist
  (`/opt/supabase/backups/pre-deploy-*.sql.gz` oder lokale `/tmp`-Dateien).
- Notfall-Export der Datenbank: `docker exec supabase-db pg_dump -U postgres -Fc postgres > notfall.dump`

## 11. Nach dem Notfall

Sobald alles wieder läuft:

1. Führe **einmal** ein vollständiges `scripts/backup.sh full` durch, damit das
   neue System sofort wieder gesichert ist.
2. Überprüfe die Backup-Überwachung im Admin-Bereich unter `/admin/infrastructure`.
3. Dokumentiere die Ursache des Ausfalls und ob DNS-TTL verkürzt werden soll.

## 12. Checkliste für die Zukunft (Empfehlungen)

- [ ] Backup-Status jeden Morgen kurz prüfen.
- [ ] Einmal pro Quartal: Probe-Wiederherstellung auf einem Wegwerf-Server.
- [ ] age-Privaten Schlüssel sicher ablegen (Passwortmanager, nicht nur auf dem Server).
- [ ] Domain-TTL auf 300 Sekunden setzen für schnellere Umschaltung.
- [ ] Backup-Server in einem anderen Rechenzentrum / bei einem anderen Anbieter aufstellen.
