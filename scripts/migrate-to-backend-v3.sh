#!/bin/bash
# Dieses Script hilft beim Einspielen der Datenbank-Tabellen auf dem Backend-Server (.123)

# 1. Container-Namen auf dem Backend-Server ermitteln
CONTAINER=$(docker ps --format "{{.Names}}" | grep -E "db|postgres" | head -n 1)

if [ -z "$CONTAINER" ]; then
  echo "Fehler: Kein Datenbank-Container gefunden!"
  exit 1
fi

echo "Gefundener Container: $CONTAINER"

# 2. Migrations-Verzeichnis definieren (relativ zum Script)
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$( dirname "$SCRIPT_DIR" )"
MIGRATIONS_DIR="$PROJECT_ROOT/supabase/manual-migrations"

if [ ! -d "$MIGRATIONS_DIR" ]; then
  echo "Fehler: Verzeichnis $MIGRATIONS_DIR nicht gefunden!"
  exit 1
fi

# 3. Alle SQL-Dateien einspielen
echo "Starte Migrationen..."
for sql in $(ls "$MIGRATIONS_DIR"/*.sql | sort); do
  echo "Wende an: $(basename "$sql") ..."
  cat "$sql" | docker exec -i -u postgres "$CONTAINER" psql -d postgres -U supabase_admin
done

echo "Fertig! Alle Tabellen wurden auf dem Backend (.123) aktualisiert. ✅"
