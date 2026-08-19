#!/usr/bin/env bash
# =============================================================================
#  diagnose-invite-mail.sh — warum ging nach der KI-Zusage keine
#  "Willkommen im Team"-/Registrierungs-Mail raus?
#  NUR LESEND, verschickt nichts.
#
#  Backend-Server: bash scripts/diagnose-invite-mail.sh --local <email|app-id>
#  Portal-Server:  bash scripts/diagnose-invite-mail.sh <email|app-id>
#  Direkte DB:     TARGET_DB_URL=postgres://... bash scripts/diagnose-invite-mail.sh <email>
# =============================================================================
set -uo pipefail
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CONF_FILE="$REPO_DIR/scripts/backend-server.env"
[ -f "$CONF_FILE" ] && . "$CONF_FILE"
: "${BACKEND_USER:=root}"; : "${BACKEND_DB_CONTAINER:=supabase-db}"
: "${BACKEND_DB_USER:=supabase_admin}"; : "${BACKEND_DB_NAME:=postgres}"

LOCAL=0
ARGS=()
for a in "$@"; do
  if [ "$a" = "--local" ]; then LOCAL=1; else ARGS+=("$a"); fi
done
NEEDLE="${ARGS[0]:-}"
if [ -z "$NEEDLE" ]; then
  echo "Aufruf: bash scripts/diagnose-invite-mail.sh [--local] <email|bewerbungs-id>" >&2; exit 1
fi
SAFE="$(printf '%s' "$NEEDLE" | sed "s/'/''/g")"

if   [ -n "${TARGET_DB_URL:-}" ]; then RUNNER="url"
elif [ "$LOCAL" = "1" ];         then RUNNER="docker"
elif [ -n "${BACKEND_HOST:-}" ]; then RUNNER="ssh"
else echo "x Keine DB-Verbindung (TARGET_DB_URL, --local oder BACKEND_HOST)." >&2; exit 1; fi

sqlt() {
  local q="$1"
  case "$RUNNER" in
    url)    printf '%s\n' "$q" | psql "$TARGET_DB_URL" -At -F '|' -P pager=off 2>&1 ;;
    docker) printf '%s\n' "$q" | docker exec -i "$BACKEND_DB_CONTAINER" psql -U "$BACKEND_DB_USER" -d "$BACKEND_DB_NAME" -At -F '|' -P pager=off 2>&1 ;;
    ssh)    printf '%s\n' "$q" | ssh -o StrictHostKeyChecking=accept-new "${BACKEND_USER}@${BACKEND_HOST}" \
              "docker exec -i $BACKEND_DB_CONTAINER psql -U $BACKEND_DB_USER -d $BACKEND_DB_NAME -At -F '|' -P pager=off" 2>&1 ;;
  esac
}
hd(){ echo; echo "═══ $1 ═══"; }

MATCH="(a.email ILIKE '%${SAFE}%' OR a.id::text = '${SAFE}')"

echo "=============================================================="
echo " EINLADUNGS-MAIL-DIAGNOSE für: $NEEDLE   $(date '+%Y-%m-%d %H:%M')"
echo "=============================================================="

hd "1) Bewerbung / KI-Entscheidung"
sqlt "SELECT 'ID           : '||a.id
       ||E'\nName         : '||coalesce(a.full_name,'-')
       ||E'\nE-Mail       : '||a.email
       ||E'\nStatus       : '||a.status||'   Stage: '||coalesce(a.stage,'-')
       ||E'\nInterview    : '||coalesce(a.interview_status,'-')
       ||'  Empfehlung: '||coalesce(a.interview_recommendation,'(keine)')
       ||'  Score: '||coalesce(a.interview_score::text,'-')
       ||E'\nAI-Decision  : '||coalesce(a.ai_decision,'-')
       ||E'\nBeendet am   : '||coalesce(a.interview_completed_at::text,'-')
       ||E'\nUser-Turns   : '||(SELECT count(*) FROM jsonb_array_elements(coalesce(a.interview_messages,'[]'::jsonb)) m WHERE m->>'role'='user')
       ||E'\nEinladung    : '||coalesce(to_jsonb(a)->>'invite_mail_status','(nie versucht / Migration fehlt)')
       ||coalesce('  — '||(to_jsonb(a)->>'invite_mail_error'),'')
       ||coalesce('  @ '||(to_jsonb(a)->>'invite_mail_at'),'')
       ||E'\n--------------------------------------------------------------'
   FROM applications a WHERE ${MATCH} ORDER BY a.created_at DESC LIMIT 5;"

hd "2) Registrierungs-Token (Token vorhanden = Versand wurde ausgelöst)"
sqlt "SELECT t.created_at||' | token='||left(t.token,12)||'… | used='||t.used
   FROM invitation_tokens t JOIN applications a ON a.id = t.application_id
  WHERE ${MATCH} ORDER BY t.created_at DESC LIMIT 10;"
sqlt "SELECT CASE WHEN count(*)=0 THEN '(kein Token — Einladung wurde gar nicht ausgelöst)' ELSE '' END
   FROM invitation_tokens t JOIN applications a ON a.id = t.application_id WHERE ${MATCH};"

hd "3) E-Mail-Protokoll zu dieser Adresse (30 Tage)"
sqlt "SELECT l.created_at||' | '||rpad(coalesce(l.template_name,'-'),26)||' | '||rpad(l.status,8)
       ||' | '||coalesce(l.error_message, coalesce(l.metadata->>'skip_reason',''))
   FROM email_send_log l
  WHERE l.recipient_email ILIKE '%${SAFE}%'
    AND l.created_at > now() - interval '30 days'
  ORDER BY l.created_at DESC LIMIT 40;"

hd "4) Mandant / SMTP-Zustand"
sqlt "SELECT 'Mandant      : '||t.name
       ||E'\naktiv        : '||t.is_active||'   pausiert: '||t.emails_paused
       ||coalesce('  ('||t.emails_paused_reason||' / '||coalesce(t.emails_paused_by,'?')||')','')
       ||E'\nSMTP         : '||coalesce(t.smtp_host,'(fehlt)')||':'||coalesce(t.smtp_port::text,'-')
       ||'  user='||coalesce(t.smtp_username,'(fehlt)')
       ||'  pw_len='||coalesce(length(t.smtp_password)::text,'0')
       ||E'\nAbsender     : '||coalesce(t.sender_email,'(fehlt)')
       ||E'\nSMTP-Health  : fails='||coalesce(h.consecutive_fails::text,'-')
       ||'  last_ok='||coalesce(h.last_verify_ok::text,'-')
       ||coalesce('  err='||h.last_fail_error,'')
   FROM applications a
   JOIN tenants t ON t.id = coalesce(a.fasttrack_tenant_id, a.tenant_id)
   LEFT JOIN tenant_smtp_health h ON h.tenant_id = t.id
  WHERE ${MATCH} LIMIT 3;"

hd "5) Aktivitäts-Log"
sqlt "SELECT g.created_at||' | '||g.action||' | '||coalesce(g.comment,'')
   FROM activity_log g JOIN applications a ON a.id = g.entity_id
  WHERE ${MATCH} ORDER BY g.created_at DESC LIMIT 10;"

echo
echo "── Deutung ────────────────────────────────────────────────────"
echo " • Empfehlung != 'invite'      → KI hat keine Zusage erteilt (Mail korrekt ausgeblieben)."
echo " • Kein Token                  → Versand nie ausgelöst (Guard/Empfehlung prüfen)."
echo " • Token da, Log 'failed'      → SMTP-/Provider-Fehler (Fehlertext oben)."
echo " • Log 'skipped'               → Kontingent/Sendefenster/Pause (skip_reason oben)."
echo " • Token da, kein Log-Eintrag  → Edge-Funktion send-invitation-email nicht erreichbar."
