#!/bin/bash
# 1. Container-Namen auf dem Backend-Server ermitteln (via SSH oder lokal)
# Wenn dieses Script lokal auf .123 ausgeführt wird:
CONTAINER=$(docker ps --format "{{.Names}}" | grep -E "db|postgres" | head -n 1)

if [ -z "$CONTAINER" ]; then
  echo "Fehler: Kein Datenbank-Container gefunden!"
  exit 1
fi

echo "Verwende Container: $CONTAINER"

# 2. Alle neuen Migrations gesammelt in den Container einspielen
# Wir sortieren sie, um die richtige Reihenfolge einzuhalten.
MIGRATIONS_DIR="supabase/manual-migrations"

if [ ! -d "$MIGRATIONS_DIR" ]; then
  echo "Fehler: Verzeichnis $MIGRATIONS_DIR nicht gefunden!"
  exit 1
fi

for sql in $(ls "$MIGRATIONS_DIR"/*.sql | sort); do
  echo "Applying $sql ..."
  # Wir leiten die Datei direkt in den docker exec psql Stream
  cat "$sql" | docker exec -i -u postgres "$CONTAINER" psql -d postgres -U supabase_admin
done

echo "Alle Migrationen wurden auf dem Backend (.123) eingespielt. ✅"
