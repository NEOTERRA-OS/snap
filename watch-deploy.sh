#!/usr/bin/env bash
# NEOS Snap — Auto-Deploy-Watcher (robuste Version).
# Läuft auf DEINEM Mac (hat Git-Login + Schreibrechte). Beobachtet den Ordner:
# sobald sich Dateien ändern (z. B. durch Claude), wird automatisch committet + gepusht
# → Vercel deployt. Einmal starten, dann nichts mehr tun.
#
#   Start:   bash watch-deploy.sh        (läuft im Vordergrund; Ctrl+C beendet)
#   Tipp:    eigenes Terminal-Tab offen lassen.
#
# NEU ggü. alter Version:
#   • entfernt verwaiste .git/index.lock automatisch (Alters-Check ≥10s) — die war
#     die Ursache, dass Commits still fehlschlugen und „nichts passierte".
#   • zeigt bei add/commit/push jetzt die echte Git-Fehlermeldung an.
set -u
cd "$(dirname "$0")" || exit 1

ERRLOG="$(mktemp -t nsb_git)"
ts() { date '+%H:%M:%S'; }

# Datei-mtime plattformübergreifend (macOS: stat -f %m, Linux: stat -c %Y)
mtime() { stat -f %m "$1" 2>/dev/null || stat -c %Y "$1" 2>/dev/null || echo 0; }

# Verwaiste Lock entfernen: existiert sie und ist älter als 10s, ist sie stale
# (der Watcher ist der einzige automatische Schreiber). So bleibt das Repo nie blockiert.
clear_stale_lock() {
  local lock=".git/index.lock"
  [ -f "$lock" ] || return 0
  local age=$(( $(date +%s) - $(mtime "$lock") ))
  if [ "$age" -ge 10 ]; then
    rm -f "$lock" && echo "$(ts)  ⚠ verwaiste .git/index.lock entfernt (Alter ${age}s)"
  fi
}

commit_and_push() {
  clear_stale_lock
  if ! git add -A 2>"$ERRLOG"; then
    echo "$(ts)  ✗ git add fehlgeschlagen: $(tr '\n' ' ' <"$ERRLOG")"
    clear_stale_lock   # falls add an einer Lock scheiterte → nächster Durchlauf klappt
    return
  fi
  git diff --cached --quiet && return   # nichts zu committen
  if git commit -q -m "auto: $(date '+%Y-%m-%d %H:%M:%S')" 2>"$ERRLOG"; then
    if git push -q 2>"$ERRLOG"; then
      echo "$(ts)  ✓ committet & gepusht → Vercel deployt"
    else
      echo "$(ts)  ⚠ Push fehlgeschlagen: $(tr '\n' ' ' <"$ERRLOG")"
    fi
  else
    echo "$(ts)  ✗ Commit fehlgeschlagen: $(tr '\n' ' ' <"$ERRLOG")"
    clear_stale_lock
  fi
}

hashcmd() { git status --porcelain | (md5 2>/dev/null || md5sum); }

echo "● Auto-Deploy-Watcher aktiv in $(pwd)"
clear_stale_lock   # beim Start evtl. vorhandene Alt-Lock aufräumen
echo "  Beobachte Änderungen … (Ctrl+C zum Beenden)"

trap 'echo; echo "● Watcher beendet."; rm -f "$ERRLOG"; exit 0' INT TERM

while true; do
  if [ -n "$(git status --porcelain)" ]; then
    # Debounce: warten bis ~8s lang keine weitere Änderung mehr kommt
    last=""
    while :; do
      cur="$(hashcmd)"
      [ "$cur" = "$last" ] && break
      last="$cur"; sleep 8
    done
    commit_and_push
  fi
  sleep 5
done
