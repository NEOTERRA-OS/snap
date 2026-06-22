# NEOS Snap — MVP

Mobile-first Beleg-/Spesenerfassung mit Übergabe an ERPNext. Next.js (App Router) + Supabase, im NEOS-Design.

## Stack
- **Next.js 14** (App Router, JS)
- **Supabase** — Auth, Postgres (dedizierte `belegflow`-Schema), Storage-Bucket `receipts`, RLS
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
Schema, Tabellen, RLS und Seed liegen in Supabase (`neoterra-dev`, Schema `belegflow`). Siehe `Snap_Konzept.md`.

## Nächste Schritte
- Echter Document-AI-OCR-Dienst statt Mock
- Regelbasierte Genehmigung + Rollen-Views (Approver/Buchhaltung)
- Echte Frappe-REST-Anbindung + Webhook-Status, E-Mail-Inbox-Ingest
