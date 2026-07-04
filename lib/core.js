"use client";
// NEOS Snap — gemeinsame Kernlogik (Konstanten, Formatter, Kategorien-Store,
// Daten-Helfer, Toast-Bus). Wird von allen UI-Komponenten importiert; hier liegt
// die wiederverwendbare Schicht, die bei einem UI-Neubau (z. B. Claude Design)
// unverändert bleibt.
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

// ===== Kategorien (Built-in-Fallback) =====
export const CATS = {
  fuel: { label: "Kraftstoff", icon: "fuel" },
  travel: { label: "Reise", icon: "train" },
  hospitality: { label: "Bewirtung", icon: "utensils" },
  it: { label: "IT / SaaS", icon: "laptop" },
  lodging: { label: "Übernachtung", icon: "bed" },
  office: { label: "Büromaterial", icon: "filetext" },
  other: { label: "Sonstiges", icon: "receipt" },
};

// Auswählbare Icons für Kategorien (müssen in components/Icon.js existieren).
export const CAT_ICONS = ["receipt", "fuel", "car", "droplet", "train", "utensils", "cart", "laptop", "phone", "bed", "filetext", "package", "cog", "tool", "ticket", "banknote", "wallet", "building", "parking", "megaphone", "graduation", "sprout", "shield", "heart", "layers", "mail", "key", "camera"];

// Dynamischer Kategorien-Store: Built-ins als Fallback, echte Werte aus DB (Tabelle categories).
let _catsArr = Object.entries(CATS).map(([key, v], i) => ({ key, label: v.label, icon: v.icon, active: true, sort: i + 1 }));
let _catsMap = { ...CATS };
let _catsLoaded = false;
const _catSubs = new Set();
function _rebuild(rows) {
  _catsArr = rows;
  _catsMap = {};
  rows.forEach((c) => { _catsMap[c.key] = { label: c.label, icon: c.icon || "receipt", active: c.active }; });
  _catSubs.forEach((fn) => fn());
}
export async function loadCats(force) {
  if (_catsLoaded && !force) return;
  _catsLoaded = true;
  const { data } = await supabase.from("categories").select("key,label,icon,sort,active").order("sort");
  if (data && data.length) _rebuild(data);
}
export function catInfo(key) { return _catsMap[key] || _catsMap.other || { label: "Sonstiges", icon: "receipt" }; }
export function catOpts() {
  return _catsArr.filter((c) => c.active).slice().sort((a, b) => {
    if (a.key === "other") return 1;            // Sammelkategorie „Sonstiges" ans Ende
    if (b.key === "other") return -1;
    return (a.label || "").localeCompare(b.label || "", "de", { sensitivity: "base" });
  });
}
export function useCats() {
  const [, force] = useState(0);
  useEffect(() => {
    const fn = () => force((x) => x + 1);
    _catSubs.add(fn);
    loadCats();
    return () => { _catSubs.delete(fn); };
  }, []);
  return { info: catInfo, opts: catOpts };
}

// ===== Status =====
export const STATUS = {
  draft: "Entwurf", review: "In Prüfung", submitted: "In Prüfung",
  approved: "Freigabe", booked: "Gebucht", rejected: "Abgelehnt",
};

// ===== Formatter =====
export const eur = (n) => (n == null ? "—" : Number(n).toLocaleString("de-DE", { style: "currency", currency: "EUR" }));
// Currency-aware money formatter — never assume EUR for foreign receipts.
export const money = (n, cur) => {
  if (n == null) return "—";
  try { return Number(n).toLocaleString("de-DE", { style: "currency", currency: (cur || "EUR") }); }
  catch { return `${Number(n).toLocaleString("de-DE", { minimumFractionDigits: 2 })} ${cur || ""}`.trim(); }
};
export const dDE = (s) => (s ? new Date(s).toLocaleDateString("de-DE", { day: "numeric", month: "long", year: "numeric" }) : "—");
// Netto aus Brutto & MwSt-Satz (falls kein gespeicherter Netto-Wert vorliegt).
export const netFrom = (g, r) => (g == null || r == null ? null : Math.round((Number(g) / (1 + Number(r) / 100)) * 100) / 100);
export const netOf = (r) => (r?.net != null ? Number(r.net) : netFrom(r?.gross, r?.vat_rate));

// ===== Plausibilität & Dublettenprüfung =====
export function plausFlags(it, limit = 5000) {
  const f = [];
  const today = new Date().toISOString().slice(0, 10);
  if (!it.merchant || !String(it.merchant).trim()) f.push(it.source === "cash" ? "Zweck fehlt" : "Händler fehlt");
  if (it.gross == null || Number(it.gross) <= 0) f.push("Betrag fehlt");
  if (it.doc_date && it.doc_date > today) f.push("Datum in der Zukunft");
  if (it.vat_rate != null && (Number(it.vat_rate) < 0 || Number(it.vat_rate) > 27)) f.push("MwSt-Satz unplausibel");
  if (it.gross != null && limit > 0 && Number(it.gross) > limit) f.push("Betrag über Warnschwelle");
  if (it.category === "hospitality" && (!it.attendees || !String(it.attendees).trim())) f.push("Bewirtung: Teilnehmer fehlen");
  return f;
}
// Liefert die ID eines bereits vorhandenen Belegs (gleicher Datei-Hash ODER Händler+Datum+Betrag).
export async function findDuplicate(hash, merchant, date, gross) {
  if (hash) {
    const { data } = await supabase.from("receipts").select("id").eq("file_hash", hash).limit(1);
    if (data && data.length) return data[0].id;
  }
  if (merchant && date && gross != null) {
    const { data } = await supabase.from("receipts").select("id").eq("merchant", merchant).eq("doc_date", date).eq("gross", gross).limit(1);
    if (data && data.length) return data[0].id;
  }
  return null;
}

// ===== Import (Excel/CSV) + Manuell — Parsing & Spalten-Mapping =====
let _seqCounter = 0;
export function nextSeq() { return ++_seqCounter; }
export function parseAmount(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number") return v;
  let s = String(v).replace(/[^0-9.,-]/g, "");
  if (s.includes(".") && s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if (s.includes(",")) s = s.replace(",", ".");
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}
export function parseDateAny(v) {
  const today = () => new Date().toISOString().slice(0, 10);
  if (v == null || v === "") return today();
  if (v instanceof Date && !isNaN(v)) return v.toISOString().slice(0, 10);
  if (typeof v === "number") { const d = new Date(Math.round((v - 25569) * 86400 * 1000)); return isNaN(d) ? today() : d.toISOString().slice(0, 10); }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[.\/](\d{1,2})[.\/](\d{2,4})/); if (m) { let [, d, mo, y] = m; if (y.length === 2) y = "20" + y; return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`; }
  const d = new Date(s); return isNaN(d) ? today() : d.toISOString().slice(0, 10);
}
export function normCurC(v) { let x = String(v || "EUR").toUpperCase().trim(); if (x === "LEI" || x === "RON LEI") x = "RON"; if (x === "$" || x === "USD$") x = "USD"; if (x === "€") x = "EUR"; return ["EUR", "USD", "RON"].includes(x) ? x : (x || "EUR"); }
const _catByLabel = {}; Object.entries(CATS).forEach(([k, v]) => { _catByLabel[k] = k; _catByLabel[v.label.toLowerCase()] = k; });
export function mapCategory(v) { if (!v) return "other"; return _catByLabel[String(v).toLowerCase().trim()] || "other"; }
export function mapPayment(v) { return /privat|private|verausl|own/.test(String(v || "").toLowerCase()) ? "private" : "company_card"; }
export function pickField(row, names) { for (const k of Object.keys(row)) { if (names.includes(k.toLowerCase().trim())) return row[k]; } return ""; }
export function importRow(row, ccByCode) {
  const merchant = String(pickField(row, ["händler", "haendler", "merchant", "vendor", "lieferant"]) || "").trim();
  const ccRaw = String(pickField(row, ["kostenstelle", "kst", "cost center", "cost_center", "costcenter"]) || "").toLowerCase().trim();
  return {
    id: nextSeq(), name: merchant || "Import", loading: false, preview: null, filePath: null, file_hash: null, file_size: null,
    merchant, doc_date: parseDateAny(pickField(row, ["datum", "date", "belegdatum"])),
    gross: parseAmount(pickField(row, ["brutto", "betrag", "amount", "gross", "summe", "total"])),
    currency: normCurC(pickField(row, ["währung", "waehrung", "currency", "whg"])),
    vat_rate: parseAmount(pickField(row, ["mwst", "mwst-satz", "mwst_satz", "vat", "ust", "steuer", "vat_rate"])),
    category: mapCategory(pickField(row, ["kategorie", "category", "art"])),
    payment_method: mapPayment(pickField(row, ["zahlart", "payment", "zahlung", "payment_method"])),
    cost_center_id: ccByCode[ccRaw] || "", confidence: null,
    occasion: String(pickField(row, ["anlass", "occasion"]) || ""), attendees: String(pickField(row, ["teilnehmer", "attendees"]) || ""),
    duplicate_of: null, source: "import",
  };
}

// ===== Lieferanten-Gedächtnis =====
const vendorKey = (m) => String(m || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").replace(/\b(gmbh|ag|kg|srl|sa|ltd|inc|llc|co|the)\b/g, "").trim().replace(/\s+/g, " ");
export async function loadVendorMemory(merchant) {
  const key = vendorKey(merchant);
  if (!key) return null;
  const { data } = await supabase.from("vendor_memory").select("*").eq("merchant_key", key).limit(1);
  return data && data.length ? data[0] : null;
}
export async function saveVendorMemory(it) {
  const key = vendorKey(it.merchant);
  if (!key) return;
  const prev = await loadVendorMemory(it.merchant);
  await supabase.from("vendor_memory").upsert({
    merchant_key: key, merchant: it.merchant, merchant_cui: (it.merchant_cui || "").trim() || prev?.merchant_cui || null,
    category: it.category || null, cost_center_id: it.cost_center_id || null,
    vat_rate: it.vat_rate ?? null, payment_method: it.payment_method || null,
    currency: it.currency || null, hits: (prev?.hits || 0) + 1, updated_at: new Date().toISOString(),
  }, { onConflict: "merchant_key" });
}

// ===== Drive / Dateien / FX / OCR-Mock =====
export async function syncToDrive(receiptId) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch("/api/drive", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${session?.access_token || ""}` },
      body: JSON.stringify({ receiptId }),
    });
    return await res.json();
  } catch (e) { return { error: String(e?.message || e) }; }
}
export const fileToBase64 = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(",")[1] || "");
  r.onerror = reject;
  r.readAsDataURL(file);
});
export async function sha256(file) {
  try {
    const buf = await file.arrayBuffer();
    const h = await crypto.subtle.digest("SHA-256", buf);
    return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch { return null; }
}
const _fxCache = {};
export async function fxToEur(amount, cur, date) {
  if (amount == null) return { eur: null, rate: null };
  cur = (cur || "EUR").toUpperCase();
  if (cur === "EUR") return { eur: +Number(amount).toFixed(2), rate: 1 };
  const d = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "latest";
  const key = d + "|" + cur;
  if (_fxCache[key] === undefined) {
    try { _fxCache[key] = (await (await fetch(`/api/fx?from=${cur}&date=${d}`)).json()).rate ?? null; }
    catch { _fxCache[key] = null; }
  }
  const rate = _fxCache[key];
  return rate ? { eur: +(amount * rate).toFixed(2), rate } : { eur: null, rate: null };
}
export function mockOcr(filename) {
  const f = (filename || "").toLowerCase();
  const today = new Date().toISOString().slice(0, 10);
  if (f.includes("aral") || f.includes("shell") || f.includes("tank") || f.includes("fuel"))
    return { merchant: "ARAL Tankstelle", doc_date: today, gross: 77.16, vat_rate: 19, category: "fuel", confidence: 97 };
  if (f.includes("hotel") || f.includes("steigen") || f.includes("lodg"))
    return { merchant: "Steigenberger Hotel", doc_date: today, gross: 149.0, vat_rate: 7, category: "lodging", confidence: 95 };
  if (f.includes("aws") || f.includes("micro") || f.includes("saas") || f.includes("it"))
    return { merchant: "Microsoft 365", doc_date: today, gross: 42.84, vat_rate: 19, category: "it", confidence: 99 };
  if (f.includes("rest") || f.includes("adler") || f.includes("food"))
    return { merchant: "Restaurant Adler", doc_date: today, gross: 86.5, vat_rate: 19, category: "hospitality", confidence: 96 };
  return { merchant: "Beleg erkannt", doc_date: today, gross: 24.9, vat_rate: 19, category: "other", confidence: 88 };
}

// ===== Toast-Bus (leichtes Pub/Sub) =====
const _toastSubs = new Set();
let _toastId = 0;
export function toast(text, type = "ok") { _toastSubs.forEach((fn) => fn({ id: ++_toastId, text, type })); }
export function onToast(fn) { _toastSubs.add(fn); return () => _toastSubs.delete(fn); }
