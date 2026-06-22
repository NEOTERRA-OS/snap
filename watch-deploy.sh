#!/usr/bin/env bash
# NEOS Snap — Auto-Deploy-Watcher.
# Läuft auf DEINEM Mac (hat Git-Login + Schreibrechte). Beobachtet den Ordner:
# sobald sich Dateien ändern (z. B. durch Claude), wird automatisch committet + gepusht
# → Vercel deployt. Einmal starten, dann nichts mehr tun.
#
#   Start:   bash watch-deploy.sh        (läuft im Vordergrund; Ctrl+C beendet)
#   Tipp:    eigenes Terminal-Tab offen lassen.
set -u
cd "$(dirname "$0")"
hashcmd() { git status --porcelain | (md5 2>/dev/null || md5sum); }

echo "● Auto-Deploy-Watcher aktiv in $(pwd)"
echo "  Beobachte Änderungen … (Ctrl+C zum Beenden)"
while true; do
  if [ -n "$(git status --porcelain)" ]; then
    # Debounce: warten bis ~8s lang keine weitere Änderung mehr kommt
    last=""
    while :; do
      cur="$(hashcmd)"
      [ "$cur" = "$last" ] && break
      last="$cur"; sleep 8
    done
    git add -A
    if git commit -q -m "auto: $(date '+%Y-%m-%d %H:%M:%S')"; then
      if git push -q; then
        echo "$(date '+%H:%M:%S')  ✓ committet & gepusht → Vercel deployt"
      else
        echo "$(date '+%H:%M:%S')  ⚠ Push fehlgeschlagen (Login/Netz prüfen)"
      fi
    fi
  fi
  sleep 5
done
