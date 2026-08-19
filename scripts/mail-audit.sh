#!/usr/bin/env bash
# =============================================================================
#  mail-audit.sh — Vollpruefung des Mail-Systems
# =============================================================================
#  Teil 1 (immer): NUR LESEND. Cron, Versand, Empfaenger, Mandanten.
#  Teil 2 (--live): echter SMTP-Login-Test je Mandant + Trockenlauf der
#                   Reminder-Endpunkte. Verschickt KEINE Mail an Bewerber.
#  Teil 3 (--send-test adresse@example.com): echter Testversand je Mandant.
#
#  Verwendung (Portal-Server):
#     bash scripts/mail-audit.sh
#     bash scripts/mail-audit.sh --live
#     bash scripts/mail-audit.sh --live --send-test du@example.com
#
#  Direkt AUF dem Backend-Server:  zusaetzlich  --local
# =============================================================================
set -uo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CONF_FILE="$REPO_DIR/scripts/backend-server.env"
[ -f "$CONF_FILE" ] && . "$CONF_FILE"

: "${BACKEND_USER:=root}"
: "${BACKEND_DB_CONTAINER:=supabase-db}"
: "${BACKEND_DB_USER:=supabase_admin}"
: "${BACKEND_DB_NAME:=postgres}"

LOCAL=0; LIVE=0; SEND_TEST=""
while [ $# -gt 0 ]; do
  case "$1" in
    --local)     LOCAL=1 ;;
    --live)      LIVE=1 ;;
    --send-test) SEND_TEST="${2:-}"; shift ;;
    *) echo "Unbekannte Option: $1" >&2; exit 1 ;;
  esac
  shift
done
[ -n "$SEND_TEST" ] && LIVE=1

log()  { printf "\n\033[1;36m▸ %s\033[0m\n" "$*"; }
head2(){ printf "\n\033[1;35m═══ %s ═══\033[0m\n" "$*"; }
warn() { printf "\033[1;33m  ! %s\033[0m\n" "$*"; }

# --- Env aus .env.server / .env laden (SERVICE_ROLE_KEY, CRON_SECRET, URLs) ---
read_env() {
  local key="$1" f val
  for f in "$REPO_DIR/.env.server" "$REPO_DIR/.env"; do
    [ -f "$f" ] || continue
    val="$(grep -E "^${key}=" "$f" | tail -1 | cut -d= -f2- | sed 's/^"//;s/"$//;s/^'"'"'//;s/'"'"'$//')"
    [ -n "$val" ] && { printf '%s' "$val"; return 0; }
  done
  return 1
}
: "${SUPABASE_URL:=$(read_env VITE_SUPABASE_URL || read_env SUPABASE_URL || echo '')}"
: "${SERVICE_ROLE_KEY:=$(read_env SUPABASE_SERVICE_ROLE_KEY || read_env SERVICE_ROLE_KEY || echo '')}"
: "${CRON_SECRET:=$(read_env CRON_SECRET || echo '')}"

# --- SQL-Runner --------------------------------------------------------------
if [ -n "${TARGET_DB_URL:-}" ]; then RUNNER="url"
elif [ "$LOCAL" = "1" ]; then RUNNER="docker"
elif [ -n "${BACKEND_HOST:-}" ]; then RUNNER="ssh"
else
  echo "✗ Keine DB-Verbindung konfiguriert (TARGET_DB_URL, --local oder BACKEND_HOST)." >&2; exit 1
fi

sql() {
  local q="$1"
  case "$RUNNER" in
    url)    printf '%s\n' "$q" | psql "$TARGET_DB_URL" -v ON_ERROR_STOP=0 -P pager=off 2>&1 ;;
    docker) printf '%s\n' "$q" | docker exec -i "$BACKEND_DB_CONTAINER" psql -U "$BACKEND_DB_USER" -d "$BACKEND_DB_NAME" -v ON_ERROR_STOP=0 -P pager=off 2>&1 ;;
    ssh)    printf '%s\n' "$q" | ssh -o StrictHostKeyChecking=accept-new "${BACKEND_USER}@${BACKEND_HOST}" \
              "docker exec -i $BACKEND_DB_CONTAINER psql -U $BACKEND_DB_USER -d $BACKEND_DB_NAME -v ON_ERROR_STOP=0 -P pager=off" 2>&1 ;;
  esac
}
sqlt() { # tuples-only, pipe-getrennt
  local q="$1"
  case "$RUNNER" in
    url)    printf '%s\n' "$q" | psql "$TARGET_DB_URL" -At -F '|' -v ON_ERROR_STOP=0 -P pager=off 2>/dev/null ;;
    docker) printf '%s\n' "$q" | docker exec -i "$BACKEND_DB_CONTAINER" psql -U "$BACKEND_DB_USER" -d "$BACKEND_DB_NAME" -At -F '|' -v ON_ERROR_STOP=0 -P pager=off 2>/dev/null ;;
    ssh)    printf '%s\n' "$q" | ssh -o StrictHostKeyChecking=accept-new "${BACKEND_USER}@${BACKEND_HOST}" \
              "docker exec -i $BACKEND_DB_CONTAINER psql -U $BACKEND_DB_USER -d $BACKEND_DB_NAME -At -F '|' -v ON_ERROR_STOP=0 -P pager=off" 2>/dev/null ;;
  esac
}

echo "=============================================================="
echo " MAIL-AUDIT   $(date '+%Y-%m-%d %H:%M:%S')   DB: $RUNNER   Live: $LIVE"
echo "=============================================================="

# =============================================================================
head2 "A  CRON-EBENE"
# =============================================================================
log "A1  Alle Jobs, Zeitplan, aktiv"
sql "SELECT jobname, schedule, active FROM cron.job ORDER BY jobname;"

log "A2  Duplikate (muss LEER sein)"
sql "SELECT jobname, count(*) FROM cron.job GROUP BY jobname HAVING count(*) > 1;"

log "A3  Jobs mit unersetztem Platzhalter in der URL (muss LEER sein)"
sql "SELECT jobname FROM cron.job
      WHERE command LIKE '%<%>%' OR command LIKE '%YOUR_%' OR command LIKE '%PLACEHOLDER%';"

log "A4  Letzter Lauf je Job + Fehler der letzten 24h"
sql "SELECT j.jobname,
            max(d.start_time)                                   AS letzter_lauf,
            round(extract(epoch FROM (now()-max(d.start_time)))/60) AS vor_min,
            count(*) FILTER (WHERE d.status='succeeded' AND d.start_time > now()-interval '24 hours') AS ok_24h,
            count(*) FILTER (WHERE d.status<>'succeeded' AND d.start_time > now()-interval '24 hours') AS fehler_24h
       FROM cron.job j LEFT JOIN cron.job_run_details d ON d.jobid=j.jobid
      GROUP BY j.jobname ORDER BY j.jobname;"

log "A5  STILLE AUSFAELLE: Jobs, die noch NIE gelaufen sind"
sql "SELECT j.jobname, j.schedule FROM cron.job j
      WHERE NOT EXISTS (SELECT 1 FROM cron.job_run_details d WHERE d.jobid=j.jobid);"

log "A6  Fehlgeschlagene Laeufe im Klartext (letzte 24h)"
sql "SELECT j.jobname, d.start_time, d.status, left(coalesce(d.return_message,''),200) AS meldung
       FROM cron.job_run_details d JOIN cron.job j ON j.jobid=d.jobid
      WHERE d.status<>'succeeded' AND d.start_time > now()-interval '24 hours'
      ORDER BY d.start_time DESC LIMIT 25;"

log "A7  HTTP-Antworten der Cron-Aufrufe (pg_net, letzte 25)"
sql "SELECT status_code, count(*) AS anzahl, max(created) AS zuletzt
       FROM net._http_response WHERE created > now()-interval '24 hours'
      GROUP BY status_code ORDER BY status_code;"
sql "SELECT id, status_code, left(coalesce(content,''),160) AS antwort, created
       FROM net._http_response ORDER BY created DESC LIMIT 25;"

# =============================================================================
head2 "B  VERSAND-EBENE"
# =============================================================================
log "B1  Versand nach Status (24h / 7 Tage)"
sql "SELECT status,
            count(*) FILTER (WHERE created_at > now()-interval '24 hours') AS h24,
            count(*) FILTER (WHERE created_at > now()-interval '7 days')   AS t7
       FROM email_send_log GROUP BY status ORDER BY status;"

log "B2  Versand je Vorlage und Mandant (7 Tage)"
sql "SELECT coalesce(t.name,'(ohne Mandant)') AS mandant,
            l.template_name,
            count(*) FILTER (WHERE l.status IN ('sent','delivered','ok')) AS erfolg,
            count(*) FILTER (WHERE l.status NOT IN ('sent','delivered','ok')) AS fehler,
            max(l.created_at) AS zuletzt
       FROM email_send_log l LEFT JOIN tenants t ON t.id=l.tenant_id
      WHERE l.created_at > now()-interval '7 days'
      GROUP BY 1,2 ORDER BY 1,2;"

log "B3  VERDAECHTIGE: Vorlagen aus dem Code ohne Versand in 7 Tagen"
sql "WITH codetpl(name) AS (VALUES
        ('invite'),('confirm_email'),('complete_registration'),('no_recent_booking'),
        ('recovery'),('app_no_booking'),('app_no_show'),('app_rebook'),
        ('app_registration'),('interview_invite_30min'),('booking_confirmation'),
        ('application_received'),('welcome'),('password_reset'),('chat_reminder'))
     SELECT c.name AS vorlage_ohne_versand
       FROM codetpl c
      WHERE NOT EXISTS (
        SELECT 1 FROM email_send_log l
         WHERE l.created_at > now()-interval '7 days'
           AND l.template_name ILIKE '%'||c.name||'%')
      ORDER BY 1;"

log "B4  Fehler im Klartext (7 Tage)"
sql "SELECT created_at, coalesce(template_name,'—') AS vorlage, recipient_email, status,
            left(coalesce(error_message,''),200) AS fehler
       FROM email_send_log
      WHERE status NOT IN ('sent','delivered','ok') AND created_at > now()-interval '7 days'
      ORDER BY created_at DESC LIMIT 30;"

log "B5  Reminder-Ketten (7 Tage)"
sql "SELECT reminder_kind, status, count(*) AS anzahl, max(sent_at) AS zuletzt
       FROM application_reminder_log WHERE sent_at > now()-interval '7 days'
      GROUP BY 1,2 ORDER BY 1,2;"
sql "SELECT reminder_type, status, count(*) AS anzahl, max(sent_at) AS zuletzt
       FROM reminder_log WHERE sent_at > now()-interval '7 days'
      GROUP BY 1,2 ORDER BY 1,2;"
sql "SELECT status, count(*) AS anzahl, max(sent_at) AS zuletzt
       FROM appointment_reminder_log WHERE sent_at > now()-interval '7 days' GROUP BY 1;"
sql "SELECT status, count(*) AS anzahl, min(created_at) AS aeltester FROM invite_resend_queue GROUP BY 1 ORDER BY 1;"

# =============================================================================
head2 "C  EMPFAENGER-EBENE"
# =============================================================================
log "C1  Blockierte Adressen"
sql "SELECT source, reason, count(*) AS anzahl FROM suppressed_emails GROUP BY 1,2 ORDER BY 3 DESC LIMIT 25;"
sql "SELECT email, reason, source, created_at FROM suppressed_emails ORDER BY created_at DESC LIMIT 20;"

log "C2  Adressen mit Fehlversuchen in Folge"
sql "SELECT recipient_email, consecutive_failures, last_failed_at,
            left(coalesce(last_error,''),140) AS letzter_fehler,
            suppressed_at
       FROM email_recipient_failures
      WHERE consecutive_failures > 0
      ORDER BY consecutive_failures DESC LIMIT 25;"

log "C3  Bewerber/Profile mit Bounce-Markierung"
sql "SELECT 'applications' AS quelle, email_status, count(*) FROM applications GROUP BY 1,2
     UNION ALL
     SELECT 'profiles', email_status, count(*) FROM profiles GROUP BY 1,2 ORDER BY 1,2;"

# =============================================================================
head2 "D  MANDANTEN-EBENE"
# =============================================================================
log "D1  SMTP-Konfiguration, Pause-Zustand, Health"
sql "SELECT name,
            CASE WHEN coalesce(smtp_host,'')='' OR coalesce(smtp_username,'')=''
                      OR coalesce(smtp_password,'')='' OR coalesce(sender_email,'')=''
                 THEN 'UNVOLLSTAENDIG' ELSE 'vollstaendig' END AS smtp,
            coalesce(smtp_host,'—')||':'||coalesce(smtp_port::text,'—') AS server,
            is_active AS aktiv,
            emails_paused AS pausiert,
            coalesce(emails_paused_by,'—')     AS pausiert_durch,
            coalesce(emails_paused_reason,'—') AS pause_grund,
            emails_paused_at                   AS pausiert_seit,
            coalesce(smtp_health_status,'(nie getestet)') AS health
       FROM tenants ORDER BY name;"

log "D2  SMTP-Health-Historie"
sql "SELECT t.name, h.consecutive_fails, h.last_verify_at, h.last_verify_ok,
            h.last_fail_at, left(coalesce(h.last_fail_error,''),160) AS letzter_fehler
       FROM tenant_smtp_health h JOIN tenants t ON t.id=h.tenant_id ORDER BY t.name;"

log "D3  Gibt es ueberhaupt Kandidaten fuer Reminder?"
sql "SELECT (SELECT count(*) FROM tenants WHERE is_active)                       AS aktive_mandanten,
            (SELECT count(*) FROM applications)                                  AS bewerbungen_gesamt,
            (SELECT count(*) FROM applications WHERE created_at > now()-interval '30 days') AS bewerbungen_30t,
            (SELECT count(*) FROM applications WHERE tenant_id IS NULL)          AS ohne_mandant,
            (SELECT count(*) FROM applications WHERE booking_status='pending' OR booking_status IS NULL) AS ohne_termin,
            (SELECT count(*) FROM interview_appointments WHERE starts_at > now() AND status='scheduled') AS kommende_termine,
            (SELECT count(*) FROM invite_resend_queue WHERE status='pending')    AS offene_invites;"

# =============================================================================
if [ "$LIVE" = "1" ]; then
head2 "E  LIVE-TEST"

  if ! command -v python3 >/dev/null 2>&1; then
    warn "python3 fehlt — SMTP-Login-Test wird uebersprungen."
  else
    log "E1  Echter SMTP-Login je Mandant"
    TENANTS="$(sqlt "SELECT id,name,smtp_host,coalesce(smtp_port,587),smtp_username,smtp_password,coalesce(sender_email,'')
                       FROM tenants
                      WHERE coalesce(smtp_host,'')<>'' AND coalesce(smtp_username,'')<>''
                        AND coalesce(smtp_password,'')<>'' ORDER BY name;")"
    if [ -z "$TENANTS" ]; then
      warn "Kein Mandant mit vollstaendigen SMTP-Daten."
    else
      while IFS='|' read -r tid tname thost tport tuser tpass tfrom; do
        [ -z "$tid" ] && continue
        RESULT="$(TH="$thost" TP="$tport" TU="$tuser" TW="$tpass" TF="$tfrom" TO="$SEND_TEST" TN="$tname" python3 - <<'PY'
import os, smtplib, ssl, socket
from email.message import EmailMessage
host=os.environ["TH"]; port=int(os.environ["TP"]); user=os.environ["TU"]
pw=os.environ["TW"]; frm=os.environ["TF"] or user; to=os.environ.get("TO","").strip()
name=os.environ["TN"]
try:
    ctx=ssl.create_default_context()
    if port==465:
        s=smtplib.SMTP_SSL(host,port,timeout=20,context=ctx)
    else:
        s=smtplib.SMTP(host,port,timeout=20); s.ehlo()
        try: s.starttls(context=ctx); s.ehlo()
        except Exception: pass
    s.login(user,pw)
    status="LOGIN_OK"
    if to:
        m=EmailMessage()
        m["From"]=frm; m["To"]=to
        m["Subject"]=f"[Mail-Audit] Testversand {name}"
        m.set_content(f"Testmail aus dem Mail-Audit.\nMandant: {name}\nSMTP: {host}:{port}\nAbsender: {frm}\n\nWenn diese Mail ankommt, ist der Versandweg dieses Mandanten in Ordnung.")
        s.send_message(m)
        status="LOGIN_OK + TESTMAIL_GESENDET"
    s.quit()
    print(status)
except Exception as e:
    print(f"FEHLER: {type(e).__name__}: {str(e)[:200]}")
PY
)"
        printf "  %-28s %s:%s  → %s\n" "$tname" "$thost" "$tport" "$RESULT"
        ESC_R="$(printf '%s' "$RESULT" | sed "s/'/''/g")"
        case "$RESULT" in
          LOGIN_OK*) sql "UPDATE tenants SET smtp_health_status='ok ($(date '+%Y-%m-%d %H:%M'))' WHERE id='$tid';" >/dev/null ;;
          *)         sql "UPDATE tenants SET smtp_health_status='fehler: $ESC_R' WHERE id='$tid';" >/dev/null ;;
        esac
      done <<< "$TENANTS"
    fi
  fi

  log "E2  Trockenlauf der Reminder-Endpunkte"
  if [ -z "$SUPABASE_URL" ] || [ -z "$SERVICE_ROLE_KEY" ]; then
    warn "SUPABASE_URL oder SUPABASE_SERVICE_ROLE_KEY nicht in .env.server gefunden — Trockenlauf uebersprungen."
  else
    for fn in send-reminders send-application-reminders send-appointment-reminders; do
      printf "\n  ── %s\n" "$fn"
      curl -sS -m 90 -X POST "${SUPABASE_URL%/}/functions/v1/$fn" \
        -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
        -H "apikey: $SERVICE_ROLE_KEY" \
        -H "x-cron-secret: $CRON_SECRET" \
        -H "Content-Type: application/json" \
        -d '{"dry_run":true}' | head -c 3000
      echo
    done
    echo
    warn "Lies hier vor allem: candidates / sent / skipped und die reason-Felder."
    warn "candidates=0 heisst: Job laeuft, aber es ist schlicht niemand faellig."
  fi

  log "E3  SMTP-Health nach dem Test"
  sql "SELECT name, coalesce(smtp_health_status,'—') AS health, emails_paused FROM tenants ORDER BY name;"
fi

echo
echo "=============================================================="
echo " Fertig. Bitte die komplette Ausgabe zurueckschicken."
echo "=============================================================="
