#!/usr/bin/env bash
# Einmal-Setup: NEOS Snap ins (leere) GitHub-Repo pushen → danach Vercel-Git-Auto-Deploy.
# Voraussetzung: leeres GitHub-Repo OHNE README/.gitignore/Lizenz angelegt.
# Aufruf:  bash setup-git.sh <git-remote-url>
#   z. B.  bash setup-git.sh git@github.com:neoterra/snap.git
set -e
cd "$(dirname "$0")"

REPO="${1:-}"
if [ -z "$REPO" ]; then
  echo "Bitte Repo-URL angeben:"
  echo "  bash setup-git.sh git@github.com:neoterra/snap.git"
  echo "  (oder https://github.com/neoterra/snap.git)"
  exit 1
fi

# Sauberer Start (falls eine halbe .git aus früheren Versuchen existiert)
rm -rf .git
git init -q
git add -A
git commit -q -m "NEOS Snap — initial commit"
git branch -M main
git remote add origin "$REPO"
git push -u origin main

echo ""
echo "✓ Code ist auf GitHub: $REPO"
echo "Jetzt in Vercel: Projekt 'belegflow-mvp' → Settings → Git → Connect Repository → $REPO wählen."
echo "Danach deployt jeder 'git push' automatisch. Künftige Änderungen: git add -A && git commit -m '…' && git push"
