#!/usr/bin/env bash
# Zeigt, welche Firma/Recruiter:in im Bewerbungsgespräch erscheint.
# Nutzung (Backend-Server):  bash scripts/check-interview-branding.sh --local "bewerber@mail.de"
set -euo pipefail
[ "${1:-}" = "--local" ] && shift
EMAIL="${1:?E-Mail des Bewerbers angeben}"
docker exec -i supabase-db psql -U supabase_admin -d postgres -c "
SELECT a.email, a.flow_type,
       ls.slug  AS quelle_slug,
       ft.slug  AS fasttrack_slug,
       COALESCE(ft.branding->>'firmenname', ls.branding->>'firmenname')            AS firma,
       COALESCE(ft.branding->>'recruiter_name', ft.recruiter_name,
                ls.branding->>'recruiter_name', ls.recruiter_name)                 AS recruiter,
       COALESCE(ft.recruiter_avatar_url, ls.recruiter_avatar_url)                  AS avatar,
       ft.is_published AS fasttrack_veroeffentlicht
  FROM applications a
  LEFT JOIN landing_pages ls ON ls.id = a.source_landing_id
  LEFT JOIN landing_pages ft ON ft.id = COALESCE(ls.linked_fasttrack_landing_id, a.target_landing_id)
 WHERE a.email ILIKE '%${EMAIL}%'
 ORDER BY a.created_at DESC LIMIT 5;"
