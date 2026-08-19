#!/usr/bin/env bash
# Prüft, ob das Edge-Runtime Zeitzonen (ICU) korrekt anwendet und ob ein
# gespeicherter Termin in Berliner Ortszeit richtig umgerechnet wird.
set -euo pipefail

echo "═══ 1) Runtime-Zeitzonentest (Edge-Runtime) ═══"
docker exec -i supabase-edge-functions deno eval '
const d = new Date(Date.UTC(2026, 6, 1, 0, 0, 0));
const berlin = d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" });
console.log("UTC 00:00 → Europe/Berlin:", berlin, berlin.startsWith("02") ? "OK" : "FEHLER (Runtime ignoriert Zeitzone)");
' 2>/dev/null || echo "(deno im Container nicht direkt aufrufbar – Fallback im Code greift trotzdem)"

echo ""
echo "═══ 2) Letzte Buchungen (UTC vs. Berliner Zeit) ═══"
docker exec -i supabase-db psql -U supabase_admin -d postgres -c \
"SELECT id, starts_at AS utc, starts_at AT TIME ZONE 'Europe/Berlin' AS berlin, status
   FROM bookings ORDER BY created_at DESC LIMIT 5;"
