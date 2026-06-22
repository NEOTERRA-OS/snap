#!/usr/bin/env bash
# BelegFlow — one-shot Vercel deploy (no global install needed). Run on your Mac:
#   bash deploy.sh
set -e
cd "$(dirname "$0")"

V="npx --yes vercel@latest"

# 1) Login (öffnet Browser, falls noch nicht eingeloggt)
$V whoami >/dev/null 2>&1 || $V login

# 2) Projekt verknüpfen (Scope: NEOS's projects; neues Projekt: belegflow-mvp)
$V link

# 3) Öffentliche Supabase-Keys als Production-Env setzen (Fehler ignorieren, falls schon gesetzt)
printf 'https://wgglwqkxlexjgupejpeg.supabase.co' | $V env add NEXT_PUBLIC_SUPABASE_URL production || true
printf 'sb_publishable_Grvvmco73_M8743kmMZWOQ_4Ede3L8I' | $V env add NEXT_PUBLIC_SUPABASE_ANON_KEY production || true

# 4) Production-Deployment
$V deploy --prod
