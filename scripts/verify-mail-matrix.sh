#!/usr/bin/env bash
# =============================================================================
#  verify-mail-matrix.sh — prueft die 17 dokumentierten Mails 1:1 gegen das
#  laufende Self-Hosting.  NUR LESEND, verschickt nichts.
#
#  Portal-Server:  bash scripts/verify-mail-matrix.sh
#  Backend-Server: bash scripts/verify-mail-matrix.sh --local
#  Direkte DB:     TARGET_DB_URL=postgres://... bash scripts/verify-mail-matrix.sh
# =============================================================================
set -uo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CONF_FILE="$REPO_DIR/scripts/backend-server.env"
[ -f "$CONF_FILE" ] && . "$CONF_FILE"

: "${BACKEND_USER:=root}"
: "${BACKEND_DB_CONTAINER:=supabase-db}"
: "${BACKEND_DB_USER:=supabase_admin}"
: "${BACKEND_DB_NAME:=postgres}"
: "${BACKEND_FUNCTIONS_DIR:=/opt/supabase/docker/volumes/functions}"

LOCAL=0
[ "${1:-}" = "--local" ] && LOCAL=1

if   [ -n "${TARGET_DB_URL:-}" ]; then RUNNER="url"
elif [ "$LOCAL" = "1" ];         then RUNNER="docker"
elif [ -n "${BACKEND_HOST:-}" ]; then RUNNER="ssh"
else echo "✗ Keine DB-Verbindung (TARGET_DB_URL, --local oder BACKEND_HOST)." >&2; exit 1; fi

sqlt() {
  local q="$1"
  case "$RUNNER" in
    url)    printf '%s\n' "$q" | psql "$TARGET_DB_URL" -At -F '|' -P pager=off 2>/dev/null ;;
    docker) printf '%s\n' "$q" | docker exec -i "$BACKEND_DB_CONTAINER" psql -U "$BACKEND_DB_USER" -d "$BACKEND_DB_NAME" -At -F '|' -P pager=off 2>/dev/null ;;
    ssh)    printf '%s\n' "$q" | ssh -o StrictHostKeyChecking=accept-new "${BACKEND_USER}@${BACKEND_HOST}" \
              "docker exec -i $BACKEND_DB_CONTAINER psql -U $BACKEND_DB_USER -d $BACKEND_DB_NAME -At -F '|' -P pager=off" 2>/dev/null ;;
  esac
}
remote() {
  case "$RUNNER" in
    ssh) ssh -o StrictHostKeyChecking=accept-new "${BACKEND_USER}@${BACKEND_HOST}" "$1" 2>/dev/null ;;
    *)   bash -c "$1" 2>/dev/null ;;
  esac
}

G="\033[1;32m"; R="\033[1;31m"; Y="\033[1;33m"; C="\033[1;36m"; N="\033[0m"
hd(){ printf "\n${C}═══ %s ═══${N}\n" "$*"; }

echo "=============================================================="
echo " MAIL-MATRIX  $(date '+%F %T')   DB: $RUNNER"
echo "=============================================================="

# --- Fakten einsammeln -------------------------------------------------------
CRONS="$(sqlt "SELECT jobname||' :: '||schedule||' :: '||active FROM cron.job ORDER BY jobname;")"
FNS="$(remote "ls -1 $BACKEND_FUNCTIONS_DIR" )"
LOGS="$(sqlt "SELECT coalesce(template_name,'(null)'), status, count(*)
                FROM email_send_log
               WHERE created_at > now() - interval '30 days'
               GROUP BY 1,2;")"
# Reminder werden zusaetzlich je Art protokolliert — email_send_log allein
# reicht nicht, weil dort teils der Tenant-Vorlagenname steht.
RLOGS="$(sqlt "SELECT reminder_kind, status, count(*)
                 FROM application_reminder_log
                WHERE sent_at > now() - interval '30 days'
                GROUP BY 1,2
                UNION ALL
               SELECT reminder_type, status, count(*)
                 FROM reminder_log
                WHERE sent_at > now() - interval '30 days'
                GROUP BY 1,2;")"

has_fn()   { printf '%s\n' "$FNS"   | grep -qx "$1"; }
# Job-Namen koennen mit '-' oder '_' angelegt sein -> beide akzeptieren
cron_line(){
  local pat; pat="$(printf '%s' "$1" | sed 's/[-_]/[-_]/g')"
  printf '%s\n' "$CRONS" | grep -E "^${pat} ::" | head -1
}
log_sent() { printf '%s\n%s\n' "$LOGS" "$RLOGS" | awk -F'|' -v t="$1" '$1==t && ($2=="sent"||$2=="delivered"){s+=$3} END{print s+0}'; }
log_fail() { printf '%s\n%s\n' "$LOGS" "$RLOGS" | awk -F'|' -v t="$1" '$1==t && ($2=="failed"||$2=="error"||$2=="bounced"){s+=$3} END{print s+0}'; }
log_skip() { printf '%s\n' "$RLOGS" | awk -F'|' -v t="$1" '$1==t && $2=="skipped"{s+=$3} END{print s+0}'; }

row() { # nr | name | function | template | cron-job ("-" = ereignisgesteuert)
  local nr="$1" name="$2" fn="$3" tpl="$4" job="$5" st ok=1 note=""
  has_fn "$fn" || { ok=0; note="Function fehlt auf Backend; "; }
  if [ "$job" != "-" ]; then
    local cl; cl="$(cron_line "$job")"
    if [ -z "$cl" ]; then ok=0; note="${note}Cron '$job' fehlt; "
    else
      case "$cl" in
        *":: t"|*":: true"|*":: on"|*":: yes")
          note="${note}cron: $(echo "$cl"|awk -F' :: ' '{print $2}'); ";;
        *) ok=0; note="${note}Cron '$job' INAKTIV; ";;
      esac
    fi
  else note="${note}ereignisgesteuert; "; fi
  local s f; s="$(log_sent "$tpl")"; f="$(log_fail "$tpl")"
  note="${note}30d: ${s} gesendet / ${f} fehlgeschlagen / $(log_skip "$tpl") uebersprungen"
  [ "$f" -gt 0 ] 2>/dev/null && ok=$(( ok == 1 ? 2 : ok ))
  case "$ok" in
    1) st="${G}OK  ${N}" ;;
    2) st="${Y}WARN${N}" ;;
    *) st="${R}FEHL${N}" ;;
  esac
  printf "%2s  %b  %-34s %s\n" "$nr" "$st" "$name" "$note"
}

hd "A) Bewerber-Mails (zentrale Vorlage)"
row 1 "Bewerbung eingegangen"       send-invitation-email        application_received        -
row 2 "Termin bestätigt (.ics)"     send-booking-confirmation    booking_confirmation        send-booking-confirmation
row 3 "Interview-Einladung 30 Min"  send-appointment-reminders   interview_invite_30min      send-appointment-reminders

hd "B) Bewerber-Reminder (Cron)"
row 4 "Kein Termin 24h"             send-application-reminders   no_booking_24h              send-application-reminders
row 5 "Kein Termin 72h"             send-application-reminders   no_booking_72h              send-application-reminders
row 6 "No-Show 24h"                 send-application-reminders   no_show_24h                 send-application-reminders
row 7 "Rebook nach Absage"          send-application-reminders   rebook_after_cancel_24h     send-application-reminders
row 7b "Rebook nach Absage 72h"     send-application-reminders   rebook_after_cancel_72h     send-application-reminders
row 7c "Zusage, nicht registriert 24h" send-application-reminders registration_pending_24h   send-application-reminders
row 7d "Zusage, nicht registriert 72h" send-application-reminders registration_pending_72h   send-application-reminders

hd "C) Onboarding / Account"
row 8  "Willkommen / Einladung"     send-invitation-email        welcome_invitation          -
row 9  "E-Mail-Bestätigung"         send-signup-confirmation     signup_confirmation         -
row 10 "Bestätigung erneut senden"  resend-signup-confirmation   signup_confirmation_resend  -
row 11 "Passwort zurücksetzen"      send-password-reset          password_reset              -

hd "D) Drip-Serien neue Mitarbeiter"
row 12 "Einladung noch offen"       send-reminders               reminder_invite             send-reminders-hourly
row 13 "E-Mail noch nicht bestätigt" send-reminders              reminder_confirm_email      send-reminders-hourly
row 14 "Registrierung abschließen"  send-reminders               reminder_complete_registration send-reminders-hourly
row 15 "Invite-Drip-Queue"          process-invite-resend-queue  invitation                  process-invite-resend-queue
row 14b "Registrierung abschließen (Log)" send-reminders         complete_registration       send-reminders-hourly
row 14c "E-Mail bestätigen (Log)"   send-reminders               confirm_email               send-reminders-hourly
row 14d "Keine Buchung (Mitarbeiter)" send-reminders             no_recent_booking           send-reminders-hourly
row 14e "Domain-Recovery"           send-reminders               domain_recovery             send-reminders-hourly

hd "E) Intern / Manuell"
row 16 "Chat-Erinnerung"            send-chat-reminder           chat_reminder               -
row 17 "SMTP-Test"                  smtp-test                    smtp_test                   -

hd "Reminder-Protokoll je Art (30 Tage)"
sqlt "SELECT reminder_kind||' | '||status||' | '||count(*)
        FROM application_reminder_log
       WHERE sent_at > now() - interval '30 days'
       GROUP BY 1,2 ORDER BY 1;" | sed 's/^/  /'
sqlt "SELECT reminder_type||' | '||status||' | '||count(*)
        FROM reminder_log
       WHERE sent_at > now() - interval '30 days'
       GROUP BY 1,2 ORDER BY 1;" | sed 's/^/  /'

hd "Cron-Übersicht (Ist-Zustand)"
printf '%s\n' "$CRONS" | sed 's/^/  /'

hd "Mandanten-Versandfähigkeit"
sqlt "SELECT name||' | smtp='||CASE WHEN coalesce(smtp_host,'')<>'' THEN 'ja' ELSE 'NEIN' END
            ||' | paused='||coalesce(emails_paused::text,'?')
            ||' | health='||coalesce(smtp_health_status,'-')
        FROM tenants ORDER BY name;" | sed 's/^/  /'

hd "Fehlgeschlagene Sends (30 Tage, nach Vorlage)"
sqlt "SELECT coalesce(template_name,'(null)')||' | '||status||' | '||count(*)
        FROM email_send_log
       WHERE created_at > now() - interval '30 days'
         AND status NOT IN ('sent','delivered')
       GROUP BY 1,2 ORDER BY 3 DESC;" | sed 's/^/  /'
echo
