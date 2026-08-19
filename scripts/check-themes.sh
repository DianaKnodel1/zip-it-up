#!/usr/bin/env bash
# =============================================================================
#  check-themes.sh — prueft alle Landing-Theme-Vorlagen auf die Fehler, die
#  bei "Nebula Flux" aufgetreten sind.  NUR LESEND, keine DB noetig.
#
#    bash scripts/check-themes.sh
#
#  Geprueft wird je Theme:
#    1) Platzhalter {{...}} vorhanden?      (ohne sie wird nichts ersetzt)
#    2) data-editable ohne {{...}}?         (wird vom Renderer ignoriert)
#    3) Impressum + Datenschutz verlinkt?   (Pflicht)
#    4) meta.json <-> Template konsistent?  (fehlende / ueberzaehlige Slots)
# =============================================================================
set -uo pipefail
cd "$(cd "$(dirname "$0")/.." && pwd)"
DIR="src/landing-themes"
BUILTIN="impressum_url datenschutz_url landing_domain logo_image favicon_image logo_text firmenname \
seo_title seo_description seo_image address contact_address contact_email contact_phone contact_block \
legal_block footer_address footer_email footer_phone sitz_stadt sitz_stadt_upper hrb hrb_nummer email \
telefon strasse plz stadt geschaeftsfuehrer registergericht steuernummer ust_id portal_url"

echo "=============================================================="
echo " THEME-CHECK  $(date '+%Y-%m-%d %H:%M:%S')"
echo "=============================================================="
fail=0
for d in "$DIR"/theme-*/; do
  name=$(basename "$d"); tpl="$d/template.html"; meta="$d/meta.json"
  [ -f "$tpl" ] || { echo "$name  !! template.html fehlt"; fail=1; continue; }
  probs=(); hints=()

  ph=$(grep -o '{{[a-z0-9_]*}}' "$tpl" | sort -u | tr -d '{}')
  [ -z "$ph" ] && probs+=("keine Platzhalter — Eingaben werden NICHT uebernommen")

  de=$(grep -c 'data-editable' "$tpl")
  [ "$de" -gt 0 ] && probs+=("$de x data-editable (wird vom Renderer ignoriert)")

  grep -q 'impressum_url\|href="/impressum\|id="impressum' "$tpl" || probs+=("Impressum nicht verlinkt")
  grep -q 'datenschutz_url\|href="/datenschutz\|id="datenschutz' "$tpl" || probs+=("Datenschutz nicht verlinkt")

  dead=$(grep -o 'href="#"' "$tpl" | wc -l | tr -d ' ')
  [ "$dead" -gt 1 ] && probs+=("$dead tote Links (href=\"#\")")

  if [ -f "$meta" ]; then
    keys=$(grep -o '"key"[[:space:]]*:[[:space:]]*"[a-z0-9_]*"' "$meta" | sed 's/.*"\([a-z0-9_]*\)"$/\1/' | sort -u)
    miss=""; for k in $ph; do
      case " $BUILTIN " in *" $k "*) continue;; esac
      grep -qx "$k" <<<"$keys" || miss="$miss $k"
    done
    [ -n "$miss" ] && probs+=("Platzhalter ohne meta.json-Slot:$miss")
    extra=$(cat "$d"/style.css "$d"/script.js 2>/dev/null | grep -o '{{[a-z0-9_]*}}' | tr -d '{}' | sort -u)
    unused=""; for k in $keys; do
      case " $BUILTIN " in *" $k "*) continue;; esac
      grep -qx "$k" <<<"$ph" || grep -qx "$k" <<<"$extra" || unused="$unused $k"
    done
    [ -n "$unused" ] && hints+=("Slots ohne Platzhalter im Template (nur Hinweis):$unused")
  else
    probs+=("meta.json fehlt")
  fi

  n=$(printf '%s\n' "$ph" | grep -c . )
  if [ ${#probs[@]} -eq 0 ]; then
    printf '%-32s OK    %s Platzhalter\n' "$name" "$n"
    for p in "${hints[@]:-}"; do [ -n "$p" ] && echo "                                 i $p"; done
  else
    fail=1
    printf '%-32s !!    %s Platzhalter\n' "$name" "$n"
    for p in "${probs[@]}"; do echo "                                 - $p"; done
    for p in "${hints[@]:-}"; do [ -n "$p" ] && echo "                                 i $p"; done
  fi
done
echo
[ "$fail" = 0 ] && echo "Alle Themes in Ordnung." || echo "Mit !! markierte Themes muessen korrigiert werden."
