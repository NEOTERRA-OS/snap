# NEOS Snap — MVP

Mobile-first Beleg-/Spesenerfassung mit Übergabe an ERPNext. Next.js (App Router) + Supabase, im NEOS-Design.

## Stack
- **Next.js 14** (App Router, JS)
- **Supabase** — eigenes Projekt `neoterra-snap` (eu-central-1), Auth, Postgres (`public`-Schema), Storage-Bucket `receipts`, RLS
- **NEOS Global UX/UI Guideline** — Bottle Green `#2C3C2B`, Neoterra Yellow `#FAD201`, Lucide-Icons, keine Emojis

## Features (MVP)
- Login (E-Mail/Passwort) · Demo: `demo@belegflow.neoterra.ag` / `belegflow2026`
- Erfassen: Upload (Foto/Scan/PDF) → Storage → **Mock-OCR** füllt Felder → Review → Einreichen
- Belege: Liste mit Status, Filter-Tabs, Detail mit Audit-Trail
- Übersicht: KPIs + Ausgaben nach Kategorie
- ERPNext-Übergabe: Stub-API (`/api/erpnext`) → setzt DocType (Expense Claim / Purchase Invoice) + DocName + Status „gebucht"

## Lokal starten
```bash
npm install
npm run dev   # http://localhost:3000
```
`.env.local` enthält die (öffentlichen) Supabase-Keys.

## Datenbank
Eigenes Supabase-Projekt **`neoterra-snap`** (eu-central-1) — getrennt vom FMIS. Tabellen, RLS, Trigger, Storage-Bucket `receipts` und Seed liegen im `public`-Schema. URL/Anon stehen in `lib/config.js`; der `SUPABASE_SERVICE_ROLE_KEY` (Admin-Tool) und `ANTHROPIC_API_KEY` (OCR) sind Vercel-Secrets.

## Nächste Schritte
- Echter Document-AI-OCR-Dienst statt Mock
- Regelbasierte Genehmigung + Rollen-Views (Approver/Buchhaltung)
- Echte Frappe-REST-Anbindung + Webhook-Status, E-Mail-Inbox-Ingest
