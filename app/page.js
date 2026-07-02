"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "@/lib/supabaseClient";
import Icon, { Logo } from "@/components/Icon";
import { LangProvider, useT } from "@/lib/i18n";

const CATS = {
  fuel: { label: "Kraftstoff", icon: "fuel" },
  travel: { label: "Reise", icon: "train" },
  hospitality: { label: "Bewirtung", icon: "utensils" },
  it: { label: "IT / SaaS", icon: "laptop" },
  lodging: { label: "Übernachtung", icon: "bed" },
  office: { label: "Büromaterial", icon: "filetext" },
  other: { label: "Sonstiges", icon: "receipt" },
};
const STATUS = {
  draft: "Entwurf", review: "In Prüfung", submitted: "Freigabe",
  approved: "Genehmigt", booked: "Gebucht", rejected: "Abgelehnt",
};
const eur = (n) => (n == null ? "—" : Number(n).toLocaleString("de-DE", { style: "currency", currency: "EUR" }));
// Currency-aware money formatter — never assume EUR for foreign receipts.
const money = (n, cur) => {
  if (n == null) return "—";
  try { return Number(n).toLocaleString("de-DE", { style: "currency", currency: (cur || "EUR") }); }
  catch { return `${Number(n).toLocaleString("de-DE", { minimumFractionDigits: 2 })} ${cur || ""}`.trim(); }
};
const dDE = (s) => (s ? new Date(s).toLocaleDateString("de-DE", { day: "numeric", month: "long", year: "numeric" }) : "—");

// Plausibilitäts-Flags (kanonisch deutsch; bei Anzeige via t() übersetzt).
function plausFlags(it) {
  const f = [];
  const today = new Date().toISOString().slice(0, 10);
  if (!it.merchant || !String(it.merchant).trim()) f.push(it.source === "cash" ? "Zweck fehlt" : "Händler fehlt");
  if (it.gross == null || Number(it.gross) <= 0) f.push("Betrag fehlt");
  if (it.doc_date && it.doc_date > today) f.push("Datum in der Zukunft");
  if (it.vat_rate != null && (Number(it.vat_rate) < 0 || Number(it.vat_rate) > 27)) f.push("MwSt-Satz unplausibel");
  if (it.gross != null && Number(it.gross) > 1000) f.push("Betrag über Limit (1.000)");
  if (it.category === "hospitality" && (!it.attendees || !String(it.attendees).trim())) f.push("Bewirtung: Teilnehmer fehlen");
  return f;
}

// Liefert die ID eines bereits vorhandenen Belegs, falls Datei-Hash gleich
// ist ODER Händler+Datum+Betrag übereinstimmen.
async function findDuplicate(hash, merchant, date, gross) {
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
function parseAmount(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number") return v;
  let s = String(v).replace(/[^0-9.,-]/g, "");
  if (s.includes(".") && s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if (s.includes(",")) s = s.replace(",", ".");
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}
function parseDateAny(v) {
  const today = () => new Date().toISOString().slice(0, 10);
  if (v == null || v === "") return today();
  if (v instanceof Date && !isNaN(v)) return v.toISOString().slice(0, 10);
  if (typeof v === "number") { const d = new Date(Math.round((v - 25569) * 86400 * 1000)); return isNaN(d) ? today() : d.toISOString().slice(0, 10); }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[.\/](\d{1,2})[.\/](\d{2,4})/); if (m) { let [, d, mo, y] = m; if (y.length === 2) y = "20" + y; return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`; }
  const d = new Date(s); return isNaN(d) ? today() : d.toISOString().slice(0, 10);
}
function normCurC(v) { let x = String(v || "EUR").toUpperCase().trim(); if (x === "LEI" || x === "RON LEI") x = "RON"; if (x === "$" || x === "USD$") x = "USD"; if (x === "€") x = "EUR"; return ["EUR", "USD", "RON"].includes(x) ? x : (x || "EUR"); }
const _catByLabel = {}; Object.entries(CATS).forEach(([k, v]) => { _catByLabel[k] = k; _catByLabel[v.label.toLowerCase()] = k; });
function mapCategory(v) { if (!v) return "other"; return _catByLabel[String(v).toLowerCase().trim()] || "other"; }
function mapPayment(v) { return /privat|private|verausl|own/.test(String(v || "").toLowerCase()) ? "private" : "company_card"; }
function pickField(row, names) { for (const k of Object.keys(row)) { if (names.includes(k.toLowerCase().trim())) return row[k]; } return ""; }
function importRow(row, ccByCode) {
  const merchant = String(pickField(row, ["händler", "haendler", "merchant", "vendor", "lieferant"]) || "").trim();
  const ccRaw = String(pickField(row, ["kostenstelle", "kst", "cost center", "cost_center", "costcenter"]) || "").toLowerCase().trim();
  return {
    id: ++_seq, name: merchant || "Import", loading: false, preview: null, filePath: null, file_hash: null, file_size: null,
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

// ===== Lieferanten-Gedächtnis (Learning Phase 1) =====
// Normalisierter Händler-Schlüssel (Groß/Klein, Sonderzeichen, GmbH-Suffixe egal).
const vendorKey = (m) => String(m || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").replace(/\b(gmbh|ag|kg|srl|sa|ltd|inc|llc|co|the)\b/g, "").trim().replace(/\s+/g, " ");

async function loadVendorMemory(merchant) {
  const key = vendorKey(merchant);
  if (!key) return null;
  const { data } = await supabase.from("vendor_memory").select("*").eq("merchant_key", key).limit(1);
  return data && data.length ? data[0] : null;
}

async function saveVendorMemory(it) {
  const key = vendorKey(it.merchant);
  if (!key) return;
  const prev = await loadVendorMemory(it.merchant);
  await supabase.from("vendor_memory").upsert({
    merchant_key: key, merchant: it.merchant,
    category: it.category || null, cost_center_id: it.cost_center_id || null,
    vat_rate: it.vat_rate ?? null, payment_method: it.payment_method || null,
    currency: it.currency || null, hits: (prev?.hits || 0) + 1, updated_at: new Date().toISOString(),
  }, { onConflict: "merchant_key" });
}
// Beleg-Ablage: Original in den je-User-Inbox-Ordner des Shared Drive laden
// (der NT Google Drive Scanner indexiert anschließend nach NEOS-Index-Schema).
async function syncToDrive(receiptId) {
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

const fileToBase64 = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(",")[1] || "");
  r.onerror = reject;
  r.readAsDataURL(file);
});

// SHA-256 hash of a file (for revision-safe storage / tamper detection).
async function sha256(file) {
  try {
    const buf = await file.arrayBuffer();
    const h = await crypto.subtle.digest("SHA-256", buf);
    return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch { return null; }
}

// Convert an amount to EUR using the ECB rate on the receipt date (cached).
const _fxCache = {};
async function fxToEur(amount, cur, date) {
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

// Mock OCR — simulates a Document-AI extraction from the uploaded file.
function mockOcr(filename) {
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

export default function Page() {
  return <LangProvider><App /></LangProvider>;
}

function App() {
  const [session, setSession] = useState(undefined);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);
  if (session === undefined) return <div className="center"><span className="spin" /></div>;
  if (!session) return <Login />;
  return <Shell session={session} />;
}

function Login() {
  const { t } = useT();
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [mode, setMode] = useState("signin");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  async function submit(e) {
    e.preventDefault(); setErr(""); setOk(""); setBusy(true);
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password: pw });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signUp({ email, password: pw });
        if (error) throw error;
        setOk(t("Konto erstellt. Bitte E-Mail bestätigen, dann anmelden."));
      }
    } catch (e2) { setErr(e2.message || "Fehler"); } finally { setBusy(false); }
  }
  return (
    <div className="auth">
      <div className="auth-hero">
        <div className="auth-glow" />
        <Logo size={46} />
        <div className="ah-name">NEOS <span>Snap</span></div>
        <div className="ah-tag">{t("Belege & Spesen — erfasst, geprüft, gebucht.")}</div>
      </div>
      <div className="auth-card">
        <div className="panel-card">
          <h3 className="auth-h">{mode === "signin" ? t("Anmelden") : t("Konto erstellen")}</h3>
          <p className="auth-sub">{mode === "signin" ? t("Melde dich an, um Belege zu erfassen und freizugeben.") : t("Lege ein Konto für die Belegerfassung an.")}</p>
          <form onSubmit={submit}>
            <div className="field"><label>{t("E-Mail")}</label>
              <div className="inp"><Icon name="mail" /><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="name@neoterra.ag" /></div></div>
            <div className="field"><label>{t("Passwort")}</label>
              <div className="inp"><Icon name="lock" /><input type={show ? "text" : "password"} value={pw} onChange={(e) => setPw(e.target.value)} required placeholder="••••••••" />
                <button type="button" className="eye" onClick={() => setShow(!show)} aria-label="show password"><Icon name="eye" /></button></div></div>
            <button className="btn" disabled={busy}>{busy ? <span className="spin" /> : <Icon name="arrowright" />} {mode === "signin" ? t("Anmelden") : t("Registrieren")}</button>
          </form>
          {err && <div className="err">{err}</div>}
          {ok && <div className="ok">{ok}</div>}
          <p className="switch">{mode === "signin" ? t("Noch kein Konto? ") : t("Bereits registriert? ")}
            <button className="linkbtn" onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setErr(""); setOk(""); }}>
              {mode === "signin" ? t("Registrieren") : t("Anmelden")}</button></p>
          <div className="demo"><Icon name="check" size={15} /><div><b>{t("Demo-Zugang")}</b><br /><span className="mono">demo@belegflow.neoterra.ag</span> · <span className="mono">belegflow2026</span></div></div>
          <div className="trust"><Icon name="shield" size={13} /> {t("GoBD-konform · Daten in der EU")}</div>
        </div>
      </div>
    </div>
  );
}

// ===== Toasts (leichtes Pub/Sub) =====
const _toastSubs = new Set();
let _toastId = 0;
function toast(text, type = "ok") { _toastSubs.forEach((fn) => fn({ id: ++_toastId, text, type })); }
function Toasts() {
  const [list, setList] = useState([]);
  useEffect(() => {
    const fn = (tt) => { setList((l) => [...l, tt]); setTimeout(() => setList((l) => l.filter((x) => x.id !== tt.id)), 3800); };
    _toastSubs.add(fn); return () => _toastSubs.delete(fn);
  }, []);
  if (!list.length) return null;
  return <div className="toasts">{list.map((tt) => (
    <div className={"toast " + tt.type} key={tt.id}><Icon name={tt.type === "err" ? "alert" : tt.type === "info" ? "sparkles" : "check"} size={15} /> {tt.text}</div>
  ))}</div>;
}

// PWA: Service Worker registrieren (Installierbarkeit).
function useServiceWorker() {
  useEffect(() => {
    if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);
}

// Wiederverwendbare Vertretungs-Verwaltung (Wer darf für mich erfassen?).
function DelegationsModal({ onClose }) {
  const { t } = useT();
  const [list, setList] = useState(null);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const authHdr = async () => { const { data } = await supabase.auth.getSession(); return { Authorization: `Bearer ${data.session?.access_token}`, "Content-Type": "application/json" }; };
  const load = useCallback(async () => {
    try { const h = await authHdr(); const r = await fetch("/api/delegations", { headers: h }); const j = await r.json(); setList(j.delegates || []); } catch { setList([]); }
  }, []);
  useEffect(() => { load(); }, [load]);
  async function add(e) {
    e.preventDefault(); setBusy(true);
    const h = await authHdr();
    const r = await fetch("/api/delegations", { method: "POST", headers: h, body: JSON.stringify({ email }) });
    const j = await r.json().catch(() => ({})); setBusy(false);
    if (j.error) { toast(j.error, "err"); return; }
    setEmail(""); toast(t("Vertretung hinzugefügt")); load();
  }
  async function rm(id) {
    const h = await authHdr();
    await fetch("/api/delegations", { method: "DELETE", headers: h, body: JSON.stringify({ delegate_id: id }) });
    load();
  }
  return (
    <div className="modal-wrap" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
        <div className="modal-ic" style={{ background: "rgba(44,60,43,.1)", color: "var(--green)" }}><Icon name="user" size={20} /></div>
        <h3>{t("Vertretungen")}</h3>
        <p>{t("Diese Personen dürfen Belege in deinem Namen erfassen.")}</p>
        <form onSubmit={add} style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@neoterra.ag" required style={{ flex: 1 }} />
          <button className="btn" disabled={busy} style={{ width: "auto", padding: "10px 14px" }}>{busy ? <span className="spin" /> : <Icon name="plus" size={14} />} {t("Hinzufügen")}</button>
        </form>
        {list === null ? <div className="center" style={{ minHeight: 50 }}><span className="spin" /></div>
          : list.length === 0 ? <p className="hint">{t("Noch keine Vertretung.")}</p> : (
            <div className="dlist">
              {list.map((d) => (
                <div className="drow" key={d.id}>
                  <div style={{ minWidth: 0 }}><b>{d.name}</b><br /><span className="mut" style={{ fontSize: 12 }}>{d.email}</span></div>
                  <button type="button" className="brem" onClick={() => rm(d.id)} title={t("Entfernen")}><Icon name="x" size={15} /></button>
                </div>
              ))}
            </div>
          )}
        <div className="modal-actions" style={{ marginTop: 16 }}>
          <button type="button" className="modal-btn ghost" onClick={onClose}>{t("Fertig")}</button>
        </div>
      </div>
    </div>
  );
}

function PasswordGate({ session, who, t, onDone }) {
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function submit(e) {
    e.preventDefault();
    setErr("");
    if (pw.length < 8) { setErr(t("Mindestens 8 Zeichen.")); return; }
    if (pw !== pw2) { setErr(t("Passwörter stimmen nicht überein.")); return; }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    if (error) { setBusy(false); setErr(error.message); return; }
    try { await fetch("/api/account/password-set", { method: "POST", headers: { Authorization: `Bearer ${session.access_token}` } }); } catch {}
    setBusy(false);
    onDone();
  }
  return (
    <div className="gate-wrap">
      <form className="card" style={{ maxWidth: 400, width: "100%" }} onSubmit={submit}>
        <div className="modal-ic" style={{ background: "rgba(44,60,43,.1)", color: "var(--green)" }}><Icon name="key" size={20} /></div>
        <h1 className="title" style={{ marginBottom: 4 }}>{t("Neues Passwort festlegen")}</h1>
        <p className="lead">{t("Bitte vergib zur Sicherheit ein eigenes Passwort, um fortzufahren.")}</p>
        <div className="field"><label>{t("Neues Passwort")}</label>
          <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus placeholder="••••••••" /></div>
        <div className="field"><label>{t("Passwort bestätigen")}</label>
          <input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} placeholder="••••••••" /></div>
        {err && <div className="err" style={{ marginBottom: 10 }}>{err}</div>}
        <button className="btn" disabled={busy} style={{ width: "100%" }}>{busy ? <span className="spin" /> : <Icon name="check" size={15} />} {t("Passwort speichern")}</button>
        <p className="hint" style={{ textAlign: "center", marginTop: 12 }}>
          {who} · <button type="button" className="linkbtn" onClick={() => supabase.auth.signOut()}>{t("Abmelden")}</button>
        </p>
      </form>
    </div>
  );
}

// Pull-to-Refresh (mobil): am Seitenanfang nach unten ziehen → Rädchen → neu laden.
function PullToRefresh() {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const start = useRef(0);
  const pulling = useRef(false);
  const dist = useRef(0);
  const refRefreshing = useRef(false);
  const THRESHOLD = 72;
  useEffect(() => {
    const onStart = (e) => {
      if (window.scrollY <= 0 && e.touches.length === 1 && !refRefreshing.current) {
        start.current = e.touches[0].clientY; pulling.current = true;
      } else pulling.current = false;
    };
    const onMove = (e) => {
      if (!pulling.current || refRefreshing.current) return;
      const dy = e.touches[0].clientY - start.current;
      if (dy > 0 && window.scrollY <= 0) {
        const d = Math.min(dy * 0.5, 110);
        dist.current = d; setPull(d);
        if (d > 6 && e.cancelable) e.preventDefault();
      } else { dist.current = 0; setPull(0); }
    };
    const onEnd = () => {
      if (!pulling.current) return;
      pulling.current = false;
      if (dist.current >= THRESHOLD) {
        refRefreshing.current = true; setRefreshing(true);
        setTimeout(() => window.location.reload(), 320);
      } else { dist.current = 0; setPull(0); }
    };
    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onEnd, { passive: true });
    window.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
    };
  }, []);
  if (pull <= 0 && !refreshing) return null;
  const progress = Math.min(pull / THRESHOLD, 1);
  const y = refreshing ? 14 : Math.min(pull - 30, 16);
  return (
    <div className="ptr" style={{ transform: `translateY(${y}px)`, opacity: refreshing ? 1 : Math.min(pull / 36, 1) }}>
      <span className={"ptr-ic" + (refreshing ? " go" : "")} style={refreshing ? undefined : { transform: `rotate(${progress * 280}deg)` }}>
        <Icon name="refresh" size={18} />
      </span>
    </div>
  );
}

function Shell({ session }) {
  const { t, lang, setLang } = useT();
  const [view, setView] = useState("capture");
  const [detail, setDetail] = useState(null);
  const [role, setRole] = useState(null);
  const [mustChange, setMustChange] = useState(false);
  const [delegModal, setDelegModal] = useState(false);
  const [theme, setTheme] = useState("light");
  const [searchQ, setSearchQ] = useState("");
  const goSearch = (v) => { setSearchQ(v); setDetail(null); setView("receipts"); };
  // Service Worker bewusst NICHT mehr registrieren (Stale-Cache vermeiden);
  // ein bereits installierter SW wird über /sw.js automatisch abgemeldet.
  useEffect(() => { try { const s = localStorage.getItem("snap_theme"); if (s) setTheme(s); } catch {} }, []);
  useEffect(() => { try { document.documentElement.dataset.theme = theme; localStorage.setItem("snap_theme", theme); } catch {} }, [theme]);
  // Esc schließt das Detail-Slide-over.
  useEffect(() => {
    if (!detail) return;
    const h = (e) => { if (e.key === "Escape") setDetail(null); };
    window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h);
  }, [detail]);
  const uid = session.user.id;
  const email = session.user.email;
  const who = session.user.user_metadata?.full_name || session.user.email;
  const signOut = () => supabase.auth.signOut();
  const toggleTheme = () => setTheme(theme === "dark" ? "light" : "dark");
  const initials = (who || "?").split(/[ @.]/).filter(Boolean).slice(0, 2).map((s) => s[0]?.toUpperCase()).join("");
  useEffect(() => { supabase.from("profiles").select("role,must_change_password").eq("id", uid).single().then(({ data }) => { setRole(data?.role || "employee"); setMustChange(!!data?.must_change_password); }); }, [uid]);
  const nav = (v, ic, label) => (
    <button className={"snav" + (view === v && !detail ? " on" : "")} onClick={() => { setDetail(null); setView(v); }}>
      <Icon name={ic} size={18} /> <span>{t(label)}</span>
    </button>
  );
  const bnav = (v, ic, label) => (
    <button className={"bnav" + (view === v && !detail ? " active" : "")} onClick={() => { setDetail(null); setView(v); }}><Icon name={ic} size={20} />{t(label)}</button>
  );
  if (mustChange) return <PasswordGate session={session} who={who} t={t} onDone={() => setMustChange(false)} />;
  return (
    <div className="shell">
      <PullToRefresh />
      {delegModal && <DelegationsModal onClose={() => setDelegModal(false)} />}
      <aside className="sidebar">
        <button type="button" className="sb-brand" onClick={() => { setDetail(null); setView("capture"); }} aria-label={t("Zur Startseite")}><Logo size={28} /> <span className="pn"><b>NEOS</b> <span className="sub">Snap</span></span></button>
        <div className="sb-grp">{t("Arbeiten")}</div>
        {nav("capture", "camera", "Erfassen")}
        {nav("receipts", "receipt", "Belege")}
        {["approver", "accounting", "admin"].includes(role) && nav("approvals", "checkcheck", "Freigaben")}
        <div className="sb-grp">{t("Auswerten")}</div>
        {nav("dashboard", "dashboard", "Auswertungen")}
        {role === "admin" && <><div className="sb-grp">{t("System")}</div>{nav("admin", "user", "Admin")}</>}
        <div className="sb-spacer" />
        <button className="sb-cta" onClick={() => { setDetail(null); setView("capture"); }}><Icon name="plus" size={15} /> {t("Neuer Beleg")}</button>
        <button className="sb-sub" onClick={() => setDelegModal(true)}><Icon name="user" size={15} /> <span>{t("Vertretungen")}</span></button>
        <div className="sb-user">
          <span className="sb-av">{initials}</span>
          <div className="sb-id"><div className="nm">{who}</div><div className="ml">{email}</div></div>
          <button className="sb-theme" onClick={toggleTheme} title={theme === "dark" ? t("Hell") : t("Dunkel")} aria-label="theme"><Icon name={theme === "dark" ? "sun" : "moon"} size={16} /></button>
        </div>
        <div className="sb-foot-row">
          <button className="sb-logout" onClick={signOut}><Icon name="logout" size={14} /> {t("Abmelden")}</button>
          <span className="langtog">
            <button className={lang === "de" ? "on" : ""} onClick={() => setLang("de")}>DE</button>
            <button className={lang === "en" ? "on" : ""} onClick={() => setLang("en")}>EN</button>
          </span>
        </div>
      </aside>
      <div className="maincol">
        <div className="topbar">
          <button type="button" className="brand mob-only" onClick={() => { setDetail(null); setView("capture"); }} aria-label={t("Zur Startseite")}><Logo size={22} /> <b>NEOS</b> <span className="sub">Snap</span></button>
          <span className="spacer" />
          <span className="langtog">
            <button className={lang === "de" ? "on" : ""} onClick={() => setLang("de")}>DE</button>
            <button className={lang === "en" ? "on" : ""} onClick={() => setLang("en")}>EN</button>
          </span>
          <button className="themetog" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} title={theme === "dark" ? t("Hell") : t("Dunkel")} aria-label="theme">
            <Icon name={theme === "dark" ? "sun" : "moon"} size={16} />
          </button>
          <span className="who">{who}</span>
          <span className="avatar">{initials}</span>
          <button className="linkbtn" onClick={signOut} title={t("Abmelden")}><Icon name="logout" size={15} /></button>
        </div>
        <div className="cmdbar">
          <span className="mandant"><Icon name="building" size={15} /> Neoterra <span className="mut">· The Vegetable Company</span></span>
          <span className="spacer" />
          <div className="cmdsearch">
            <Icon name="search" size={15} />
            <input value={searchQ} onChange={(e) => goSearch(e.target.value)} placeholder={t("Beleg oder Händler suchen …")} aria-label={t("Suchen")} />
          </div>
        </div>
        <div className="content">
          <div className="container">
            {view === "capture" ? <Capture uid={uid} onDone={() => setView("receipts")} />
              : view === "receipts" ? <Receipts uid={uid} onOpen={setDetail} q={searchQ} setQ={setSearchQ} />
              : view === "approvals" ? <Approvals onOpen={setDetail} />
              : view === "admin" ? <Admin session={session} />
              : <Dashboard />}
          </div>
        </div>
      </div>
      <div className="bottomnav">
        {bnav("capture", "camera", "Erfassen")}
        {bnav("receipts", "receipt", "Belege")}
        {["approver", "accounting", "admin"].includes(role) && bnav("approvals", "checkcheck", "Freigaben")}
        {bnav("dashboard", "dashboard", "Analyse")}
        {role === "admin" && bnav("admin", "user", "Admin")}
      </div>
      {detail && (
        <div className="sheet-wrap" onMouseDown={(e) => { if (e.target === e.currentTarget) setDetail(null); }}>
          <div className="sheet">
            <div className="sheet-bar">
              <span className="sheet-title">{t("Beleg-Status")}</span>
              <button className="sheet-x" onClick={() => setDetail(null)} aria-label={t("Schließen")}><Icon name="x" size={18} /></button>
            </div>
            <div className="sheet-body"><Detail id={detail} onBack={() => setDetail(null)} /></div>
          </div>
        </div>
      )}
      <Toasts />
    </div>
  );
}

let _seq = 0;
function Capture({ uid, onDone }) {
  const { t } = useT();
  const [stage, setStage] = useState("pick"); // pick | review
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ccs, setCcs] = useState([]);
  const [drag, setDrag] = useState(false);
  const [draftFirst, setDraftFirst] = useState(false); // Import → Entwurf als Standardaktion
  const camRef = useRef(null);   // Kamera (Foto/Scan)
  const upRef = useRef(null);    // Datei-Upload (ohne Kamera-Zwang)
  const [activeSrc, setActiveSrc] = useState("foto");
  const [emailInfo, setEmailInfo] = useState(false);
  // Vertretung: für wen darf ich erfassen (owners) → „Für Mitarbeiter"-Auswahl.
  const [owners, setOwners] = useState([]);
  const [forUser, setForUser] = useState("");
  const [delegOpen, setDelegOpen] = useState(false);
  useEffect(() => {
    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const r = await fetch("/api/delegations", { headers: { Authorization: `Bearer ${data.session?.access_token}` } });
        const j = await r.json(); setOwners(j.owners || []);
      } catch {}
    })();
  }, []);

  useEffect(() => { supabase.from("cost_centers").select("id,code,name").eq("active", true).order("code").then(({ data }) => setCcs(data || [])); }, []);

  const upd = (id, patch) => setItems((prev) => prev.map((it) => {
    if (it.id !== id) return it;
    const next = { ...it, ...patch };
    // Ändert der Nutzer ein gemerktes Feld selbst, verschwindet dessen „gemerkt"-Badge.
    if (it.mem && !patch.mem) {
      const m = { ...it.mem };
      let changed = false;
      for (const k of Object.keys(patch)) { if (m[k]) { delete m[k]; changed = true; } }
      if (changed) next.mem = m;
    }
    return next;
  }));
  const mb = (it, k) => (it.mem?.[k] ? <span className="memb"><Icon name="sparkles" size={10} /> {t("gemerkt")}</span> : null);

  function onPick(e) { addFiles(Array.from(e.target.files || [])); e.target.value = ""; }
  function onDrop(e) { e.preventDefault(); setDrag(false); addFiles(Array.from(e.dataTransfer?.files || [])); }

  function addManual() {
    setErr(""); setStage("review");
    setItems((p) => [...p, {
      id: ++_seq, name: t("Manueller Beleg"), loading: false, preview: null, filePath: null, file_hash: null, file_size: null,
      merchant: "", doc_date: new Date().toISOString().slice(0, 10), gross: null, currency: "EUR", vat_rate: null, category: "other",
      payment_method: "company_card", cost_center_id: "", confidence: null, occasion: "", attendees: "", duplicate_of: null, source: "manual",
    }]);
  }
  // Barauslage / Sonderfall: Bargeld ausgelegt (kein Foto). Auslegender bekommt erstattet (privat).
  function addCash() {
    setErr(""); setStage("review");
    setItems((p) => [...p, {
      id: ++_seq, name: t("Barauslage"), loading: false, preview: null, filePath: null, file_hash: null, file_size: null,
      merchant: "", recipient: "", doc_date: new Date().toISOString().slice(0, 10), gross: null, currency: "EUR", vat_rate: null, category: "other",
      payment_method: "private", cost_center_id: "", confidence: null, occasion: "", attendees: "", duplicate_of: null, source: "cash",
    }]);
  }
  async function enrichImported(it) {
    try { const dup = await findDuplicate(null, it.merchant, it.doc_date, it.gross); if (dup) upd(it.id, { duplicate_of: dup }); } catch {}
    try { const mem = await loadVendorMemory(it.merchant); if (mem) { const p = {}; const m = {}; if (!it.cost_center_id && mem.cost_center_id) { p.cost_center_id = mem.cost_center_id; m.cost_center_id = true; } if (mem.payment_method && it.payment_method === "company_card") { p.payment_method = mem.payment_method; m.payment_method = true; } if (Object.keys(m).length) { p.mem = m; upd(it.id, p); } } } catch {}
  }
  async function onImport(e) {
    const file = e.target.files?.[0]; e.target.value = "";
    if (!file) return;
    setErr("");
    try {
      const mod = await import("xlsx");
      const XLSX = mod.read ? mod : mod.default;
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });
      if (!rows.length) { setErr(t("Keine Zeilen in der Datei.")); return; }
      const ccByCode = {}; ccs.forEach((c) => (ccByCode[String(c.code).toLowerCase().trim()] = c.id));
      const newItems = rows.map((r) => importRow(r, ccByCode));
      setDraftFirst(true);
      setStage("review"); setItems((p) => [...p, ...newItems]);
      toast(`${newItems.length} ${t("Zeilen importiert")}`);
      newItems.forEach(enrichImported);
    } catch (e2) { setErr(`${t("Import fehlgeschlagen")}: ${e2?.message || e2}`); }
  }

  function addFiles(files) {
    if (!files.length) return;
    setErr(""); setStage("review");
    const newItems = files.map((file) => ({
      id: ++_seq, name: file.name, loading: true,
      preview: file.type.startsWith("image/") ? URL.createObjectURL(file) : null,
      filePath: null, file_hash: null, file_size: null, merchant: "", doc_date: new Date().toISOString().slice(0, 10),
      gross: null, currency: "EUR", vat_rate: null, category: "other",
      payment_method: "company_card", cost_center_id: "", confidence: null,
      occasion: "", attendees: "", duplicate_of: null,
      source: file.type.includes("pdf") ? "upload" : "photo",
    }));
    setItems((prev) => [...prev, ...newItems]);
    newItems.forEach((it, i) => processFile(it.id, files[i]));
  }

  async function processFile(id, file) {
    try {
      const path = `${uid}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${file.name.replace(/[^a-zA-Z0-9.\-_]/g, "_")}`;
      const [up, hash] = await Promise.all([
        supabase.storage.from("receipts").upload(path, file, { upsert: false }),
        sha256(file),
      ]);
      let ocr;
      try {
        const b64 = await fileToBase64(file);
        const res = await fetch("/api/ocr", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data: b64, mediaType: file.type, filename: file.name }) });
        ocr = (await res.json()).fields || mockOcr(file.name);
      } catch { ocr = mockOcr(file.name); }
      upd(id, { loading: false, filePath: up.error ? null : path, file_hash: hash, file_size: file.size, error: up.error ? up.error.message : null,
        merchant: ocr.merchant || "", doc_date: ocr.doc_date, gross: ocr.gross, currency: ocr.currency || "EUR",
        vat_rate: ocr.vat_rate, category: ocr.category || "other", confidence: ocr.confidence });
      // Dublettenprüfung: gleicher Datei-Hash ODER gleicher Händler+Datum+Betrag.
      try {
        const dup = await findDuplicate(hash, ocr.merchant, ocr.doc_date, ocr.gross);
        if (dup) upd(id, { duplicate_of: dup });
      } catch {}
      // Lieferanten-Gedächtnis: bestätigte Defaults vorbelegen (Kostenstelle/Zahlart immer,
      // Kategorie/MwSt nur wenn vom Nutzer früher bestätigt).
      try {
        const mem = await loadVendorMemory(ocr.merchant);
        if (mem) {
          const patch = {}; const m = {};
          if (mem.cost_center_id) { patch.cost_center_id = mem.cost_center_id; m.cost_center_id = true; }
          if (mem.payment_method) { patch.payment_method = mem.payment_method; m.payment_method = true; }
          if (mem.category) { patch.category = mem.category; m.category = true; }
          if (mem.vat_rate != null) { patch.vat_rate = mem.vat_rate; m.vat_rate = true; }
          if (Object.keys(m).length) { patch.mem = m; upd(id, patch); }
        }
      } catch {}
    } catch (e) { upd(id, { loading: false, error: e.message }); }
  }

  async function submitAll(status = "submitted") {
    const ready = items.filter((it) => !it.loading);
    if (!ready.length) return;
    setBusy(true); setErr("");
    try {
      const rows = [];
      for (const it of ready) {
        const { eur, rate } = await fxToEur(it.gross, it.currency, it.doc_date);
        const flags = plausFlags(it);
        rows.push({
          user_id: forUser || uid, created_by: uid, status, source: it.source, recipient: it.recipient || null, file_path: it.filePath,
          merchant: it.merchant, doc_date: it.doc_date, gross: it.gross, vat_rate: it.vat_rate,
          currency: it.currency || "EUR", gross_eur: eur, fx_rate: rate,
          file_hash: it.file_hash, file_size: it.file_size,
          vat_amount: it.gross && it.vat_rate ? +(it.gross - it.gross / (1 + it.vat_rate / 100)).toFixed(2) : null,
          category: it.category, payment_method: it.payment_method,
          reimbursable: it.payment_method === "private", confidence: it.confidence,
          cost_center_id: it.cost_center_id || null,
          occasion: it.category === "hospitality" ? (it.occasion || null) : null,
          attendees: it.category === "hospitality" ? (it.attendees || null) : null,
          duplicate_of: it.duplicate_of || null,
          flags: flags.length ? flags : null,
        });
      }
      const { error } = await supabase.from("receipts").insert(rows);
      if (error) throw error;
      // Lieferanten-Gedächtnis aktualisieren (fire-and-forget).
      Promise.all(ready.filter((it) => it.merchant).map((it) => saveVendorMemory(it).catch(() => {}))).catch(() => {});
      toast(status === "draft" ? `${rows.length} ${t("als Entwurf gespeichert")}` : `${rows.length} ${t("Beleg(e) eingereicht")}`);
      onDone();
    } catch (e2) { setErr(e2.message); } finally { setBusy(false); }
  }

  const anyLoading = items.some((it) => it.loading);

  if (stage === "pick") return (
    <>
      <h1 className="title">{t("Beleg erfassen")}</h1>
      <p className="lead">{t("Foto, Scan, Upload oder per E-Mail — die OCR füllt die Felder automatisch.")}</p>
      <div className="capwrap">
        <div className="sources">
          <button type="button" className={"src" + (activeSrc === "foto" ? " on" : "")} onClick={() => { setActiveSrc("foto"); camRef.current?.click(); }}><Icon name="camera" size={20} /> {t("Foto")}</button>
          <button type="button" className={"src" + (activeSrc === "scan" ? " on" : "")} onClick={() => { setActiveSrc("scan"); camRef.current?.click(); }}><Icon name="scan" size={20} /> {t("Scan")}</button>
          <button type="button" className={"src" + (activeSrc === "upload" ? " on" : "")} onClick={() => { setActiveSrc("upload"); upRef.current?.click(); }}><Icon name="upload" size={20} /> {t("Upload")}</button>
          <button type="button" className={"src" + (activeSrc === "email" ? " on" : "")} onClick={() => { setActiveSrc("email"); setEmailInfo(true); }}><Icon name="mail" size={20} /> {t("E-Mail-Inbox")}</button>
        </div>
        <label className={"dropzone" + (drag ? " over" : "")}
          onDragOver={(e) => { e.preventDefault(); if (!drag) setDrag(true); }}
          onDragLeave={(e) => { e.preventDefault(); setDrag(false); }}
          onDrop={onDrop}>
          <span className="dz-ic"><Icon name="upload" size={30} /></span>
          <span className="dz-h">{t("Belege hierher ziehen oder auswählen")}</span>
          <span className="dz-p">{t("Mehrere Dateien möglich · JPG, PNG oder PDF")}</span>
          <span className="dz-btn"><Icon name="camera" size={15} /> {t("Dateien auswählen")}</span>
          <input ref={camRef} type="file" accept="image/*,application/pdf" capture="environment" multiple hidden onChange={onPick} />
        </label>
        <input ref={upRef} type="file" accept="image/*,application/pdf" multiple hidden onChange={onPick} />
        <div className="tip"><Icon name="scan" size={14} /> {t("OCR startet automatisch — du prüfst nur die markierten Felder.")}</div>
        <div className="capdiv"><span>{t("oder")}</span></div>
        <div className="capalt">
          <button type="button" className="btn ghost" onClick={addManual}><Icon name="plus" size={15} /> {t("Manuell erfassen")}</button>
          <label className="btn ghost" style={{ cursor: "pointer" }}><Icon name="filetext" size={15} /> {t("Excel/CSV importieren")}
            <input type="file" accept=".csv,.xlsx,.xls,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden onChange={onImport} /></label>
          <button type="button" className="btn ghost" onClick={addCash}><Icon name="banknote" size={15} /> {t("Barauslage erfassen")}</button>
        </div>
        <div className="tip"><Icon name="filetext" size={14} /> {t("Import-Spalten: Datum, Händler, Brutto, Währung, MwSt, Kategorie, Kostenstelle, Zahlart, Anlass, Teilnehmer.")}</div>
        <button type="button" className="delegcta" onClick={() => setDelegOpen(true)}>
          <span className="delegcta-ic"><Icon name="user" size={16} /></span>
          <span className="delegcta-txt">
            <b>{t("Vertretungen verwalten")}</b>
            <span>{t("Wer darf Belege für mich erfassen?")}</span>
          </span>
          <Icon name="arrowright" size={16} />
        </button>
        {err && <div className="err">{err}</div>}
      </div>
      {emailInfo && (
        <div className="modal-wrap" onClick={() => setEmailInfo(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-ic" style={{ background: "rgba(44,60,43,.1)", color: "var(--green)" }}><Icon name="mail" size={20} /></div>
            <h3>{t("E-Mail-Inbox")}</h3>
            <p>{t("Diese Funktion folgt in Kürze: Du kannst Belege dann einfach an eine persönliche Sammeladresse weiterleiten — sie werden automatisch ausgelesen und hier erfasst. Nutze bis dahin Foto, Scan oder Upload.")}</p>
            <div className="modal-actions">
              <button type="button" className="modal-btn ghost" onClick={() => setEmailInfo(false)}>{t("Verstanden")}</button>
            </div>
          </div>
        </div>
      )}
      {delegOpen && <DelegationsModal onClose={() => setDelegOpen(false)} />}
    </>
  );

  return (
    <>
      <div className="ahead">
        <h1 className="title">{t("Prüfen & ergänzen")} ({items.length})</h1>
        {owners.length > 0 && (
          <div className="forsel">
            <label>{t("Für Mitarbeiter")}</label>
            <select value={forUser} onChange={(e) => setForUser(e.target.value)}>
              <option value="">{t("Ich selbst")}</option>
              {owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </div>
        )}
        <label className="btn ghost csv" style={{ cursor: "pointer" }}>
          <Icon name="plus" size={15} /> {t("Mehr hinzufügen")}
          <input type="file" accept="image/*,application/pdf" capture="environment" multiple hidden onChange={onPick} />
        </label>
      </div>
      {items.map((it) => (
        <div className="card bcard" key={it.id}>
          <div className="bcard-head">
            {it.preview ? <img className="bthumb" src={it.preview} alt="" /> : <span className="bthumb ph"><Icon name="file-text" size={18} /></span>}
            <span className="bname">{it.name}</span>
            {it.loading ? <span className="bstat"><span className="spin" /> {t("Lese …")}</span>
              : it.source === "cash" ? <span className="bstat man">{t("Barauslage")}</span>
              : it.source === "manual" ? <span className="bstat man">{t("Manuell")}</span>
              : it.source === "import" ? <span className="bstat man">{t("Import")}</span>
              : <span className="bstat ok"><Icon name="check" size={12} /> {it.confidence ?? "—"}%</span>}
            <button className="brem" onClick={() => setItems((p) => p.filter((x) => x.id !== it.id))} title={t("Entfernen")}>✕</button>
          </div>
          {!it.loading && (
            <div className="bgrid">
              {it.source === "cash" && (
                <div className="field"><label>{t("Empfänger")}</label><input value={it.recipient || ""} onChange={(e) => upd(it.id, { recipient: e.target.value })} placeholder={t("z. B. Bojan")} /></div>
              )}
              <div className="field"><label>{it.source === "cash" ? t("Zweck") : t("Händler")}</label><input value={it.merchant} onChange={(e) => upd(it.id, { merchant: e.target.value })} placeholder={it.source === "cash" ? t("wofür war das Geld?") : undefined} /></div>
              <div className="field"><label>{t("Datum")}</label><input type="date" value={it.doc_date || ""} onChange={(e) => upd(it.id, { doc_date: e.target.value })} /></div>
              <div className="field"><label>{t("Betrag brutto")}</label><input type="number" step="0.01" value={it.gross ?? ""} onChange={(e) => upd(it.id, { gross: parseFloat(e.target.value) })} /></div>
              <div className="field"><label>{t("Währung")}</label>
                <select value={it.currency || "EUR"} onChange={(e) => upd(it.id, { currency: e.target.value })}>
                  {Array.from(new Set([it.currency || "EUR", "EUR", "USD", "RON"])).map((c) => <option key={c} value={c}>{c === "RON" ? "RON (Lei)" : c}</option>)}
                </select></div>
              <div className="field"><label>{t("MwSt-Satz (%)")} {mb(it, "vat_rate")}</label><input type="number" step="0.1" min="0" value={it.vat_rate ?? ""} onChange={(e) => upd(it.id, { vat_rate: e.target.value === "" ? null : parseFloat(e.target.value) })} /></div>
              <div className="field"><label>{t("Kategorie")} {mb(it, "category")}</label>
                <select value={it.category} onChange={(e) => upd(it.id, { category: e.target.value })}>
                  {Object.entries(CATS).map(([k, v]) => <option key={k} value={k}>{t(v.label)}</option>)}</select></div>
              <div className="field"><label>{t("Kostenstelle / Projekt")} {mb(it, "cost_center_id")}</label>
                <select value={it.cost_center_id} onChange={(e) => upd(it.id, { cost_center_id: e.target.value })}>
                  <option value="">{t("— wählen —")}</option>{ccs.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</select></div>
              <div className="field"><label>{t("Zahlart")} {mb(it, "payment_method")}</label>
                <select value={it.payment_method} onChange={(e) => upd(it.id, { payment_method: e.target.value })}>
                  <option value="company_card">{t("Firmenkarte")}</option><option value="private">{t("Privat verauslagt")}</option></select></div>
              {it.category === "hospitality" && (
                <>
                  <div className="field wide"><label>{t("Anlass der Bewirtung")}</label><input value={it.occasion} onChange={(e) => upd(it.id, { occasion: e.target.value })} placeholder={t("z. B. Projektbesprechung mit Lieferant")} /></div>
                  <div className="field wide"><label>{t("Teilnehmer")}</label><input value={it.attendees} onChange={(e) => upd(it.id, { attendees: e.target.value })} placeholder={t("Namen, kommagetrennt")} /></div>
                </>
              )}
            </div>
          )}
          {!it.loading && it.mem && Object.keys(it.mem).length > 0 && (
            <div className="bflag mem"><Icon name="sparkles" size={13} /> {t("Vorbelegt aus Lieferanten-Gedächtnis — bitte prüfen.")}</div>
          )}
          {!it.loading && it.duplicate_of && (
            <div className="bflag dup"><Icon name="alert" size={13} /> {t("Mögliche Dublette — dieser Beleg existiert bereits.")}</div>
          )}
          {!it.loading && plausFlags(it).map((f) => (
            <div className="bflag" key={f}><Icon name="alert" size={13} /> {t(f)}</div>
          ))}
        </div>
      ))}
      {err && <div className="err">{err}</div>}
      <div className="submitrow">
        {draftFirst ? (<>
          <button className="btn" disabled={busy || anyLoading || !items.length} onClick={() => submitAll("draft")}>
            {busy ? <span className="spin" /> : <Icon name="filetext" size={15} />} {`${t("Als Entwürfe speichern")} (${items.filter((i) => !i.loading).length})`}
          </button>
          <button className="btn ghost" disabled={busy || anyLoading || !items.length} onClick={() => submitAll("submitted")}>
            <Icon name="arrowright" size={15} /> {t("Direkt einreichen")}
          </button>
        </>) : (<>
          <button className="btn" disabled={busy || anyLoading || !items.length} onClick={() => submitAll("submitted")}>
            {busy ? <span className="spin" /> : <Icon name="arrowright" />} {anyLoading ? t("OCR läuft …") : `${t("Alle einreichen")} (${items.filter((i) => !i.loading).length})`}
          </button>
          <button className="btn ghost" disabled={busy || anyLoading || !items.length} onClick={() => submitAll("draft")}>
            <Icon name="filetext" size={15} /> {t("Als Entwurf speichern")}
          </button>
        </>)}
      </div>
      <button className="btn ghost" style={{ marginTop: 10 }} onClick={() => { setItems([]); setDraftFirst(false); setStage("pick"); }}>{t("Abbrechen")}</button>
    </>
  );
}

const dShort = (s) => (s ? new Date(s).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—");

function Receipts({ uid, onOpen, q = "", setQ = () => {} }) {
  const { t } = useT();
  const [rows, setRows] = useState(null);
  const [statusF, setStatusF] = useState("all");
  const [sortBy, setSortBy] = useState("date");
  const [dir, setDir] = useState("desc");
  const load = useCallback(() => {
    supabase.from("receipts").select("id,merchant,doc_date,gross,status,category,currency,flags,duplicate_of,source,recipient").order("doc_date", { ascending: false })
      .then(({ data }) => setRows(data || []));
  }, []);
  useEffect(() => { load(); }, [load]);
  if (!rows) return <div className="center"><span className="spin" /></div>;

  const statusMatch = (r) => statusF === "all" ? true
    : statusF === "review" ? ["review", "submitted"].includes(r.status)
    : r.status === statusF;
  const filtered = rows.filter((r) => statusMatch(r) && (!q || (r.merchant || "").toLowerCase().includes(q.toLowerCase())));
  const sorted = [...filtered].sort((a, b) => {
    let c = 0;
    if (sortBy === "amount") c = Number(a.gross || 0) - Number(b.gross || 0);
    else if (sortBy === "merchant") c = (a.merchant || "").localeCompare(b.merchant || "", "de", { numeric: true });
    else c = (a.doc_date || "").localeCompare(b.doc_date || "");
    return dir === "asc" ? c : -c;
  });
  const open = rows.filter((r) => ["review", "submitted", "approved"].includes(r.status));
  const openSum = open.reduce((s, r) => s + Number(r.gross || 0), 0);
  const chips = [["all", "Alle"], ["draft", "Entwurf"], ["review", "In Prüfung"], ["approved", "Genehmigt"], ["booked", "Gebucht"], ["rejected", "Abgelehnt"]];
  const flagged = (r) => (r.flags?.length > 0 || r.duplicate_of);

  return (
    <>
      <h1 className="title">{t("Meine Belege")}</h1>
      <div className="kpis">
        <div className="kpi"><div className="kt"><Icon name="receipt" />{t("Offen")}</div><div className="n mono">{open.length}</div></div>
        <div className="kpi"><div className="kt"><Icon name="wallet" />{t("Offenes Volumen")}</div><div className="n mono">{eur(openSum)}</div></div>
      </div>

      <div className="filterbox">
        <div className="srch"><Icon name="search" size={15} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Belege durchsuchen …")} /></div>
        <div className="srt">
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
            <option value="date">{t("Datum")}</option><option value="amount">{t("Betrag")}</option><option value="merchant">{t("Händler")}</option>
          </select>
          <button className="dirbtn" onClick={() => setDir(dir === "asc" ? "desc" : "asc")} title={dir === "asc" ? t("Aufsteigend") : t("Absteigend")}><Icon name={dir === "asc" ? "arrowup" : "arrowdown"} size={15} /></button>
        </div>
        <div className="fchips">
          {chips.map(([k, l]) => <button key={k} className={"fchip" + (statusF === k ? " on" : "")} onClick={() => setStatusF(k)}>{t(l)}</button>)}
        </div>
      </div>
      <div className="shownline">{sorted.length} {t("von")} {rows.length} {t("Belegen")}</div>

      {sorted.length === 0 ? (
        <div className="empty"><Icon name="receipt" size={28} /><p>{q || statusF !== "all" ? t("Keine Treffer im Filter.") : t("Noch keine Belege erfasst.")}</p></div>
      ) : (<>
        <table className="jtable only-desktop">
          <thead><tr>
            <th className="thc">{t("Datum")}</th><th className="thc">{t("Händler")}</th><th className="thc">{t("Kategorie")}</th>
            <th className="thc">{t("Status")}</th><th className="thc r">{t("Betrag")}</th>
          </tr></thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.id} onClick={() => onOpen(r.id)}>
                <td className="mono">{dShort(r.doc_date)}</td>
                <td className="tdmerch">{flagged(r) && <Icon name="alert" size={13} className="flagdot" />}{r.merchant || "—"}</td>
                <td><span className="catcell"><Icon name={(CATS[r.category] || CATS.other).icon} size={14} /> {t((CATS[r.category] || CATS.other).label)}</span></td>
                <td><span className={"badge b-" + r.status}><span className="dot" />{t(STATUS[r.status])}</span></td>
                <td className="r mono amt">{money(r.gross, r.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="only-mobile">
          {sorted.map((r) => (
            <div key={r.id} className="lcard" onClick={() => onOpen(r.id)}>
              <div className="lthumb"><Icon name={r.source === "cash" ? "banknote" : (CATS[r.category] || CATS.other).icon} size={19} /></div>
              <div className="meta"><div className="t">{r.merchant || (r.source === "cash" ? t("Barauslage") : "—")}{flagged(r) && <Icon name="alert" size={12} className="flagdot" />}</div>
                <div className="d">{dShort(r.doc_date)} · {t((CATS[r.category] || CATS.other).label)}{r.source === "cash" && <span className="mut"> · {t("Barauslage")}{r.recipient ? ` → ${r.recipient}` : ""}</span>}</div>
                <span className={"badge b-" + r.status} style={{ marginTop: 6 }}><span className="dot" />{t(STATUS[r.status])}</span></div>
              <div className="amt mono">{money(r.gross, r.currency)}</div>
            </div>
          ))}
        </div>
      </>)}
    </>
  );
}

function Approvals({ onOpen }) {
  const { t } = useT();
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(false);
  const [sel, setSel] = useState(() => new Set());
  const [names, setNames] = useState({});
  const load = useCallback(() => {
    supabase.from("receipts").select("id,merchant,doc_date,gross,currency,category,flags,duplicate_of,user_id,created_by,creator_name,source,recipient").eq("status", "submitted").order("doc_date").then(({ data }) => { setRows(data || []); setSel(new Set()); });
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { supabase.from("profiles").select("id,full_name").then(({ data }) => { const m = {}; (data || []).forEach((p) => (m[p.id] = p.full_name)); setNames(m); }); }, []);
  if (!rows) return <div className="center"><span className="spin" /></div>;

  const toggle = (id) => setSel((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allSel = rows.length > 0 && sel.size === rows.length;
  const toggleAll = () => setSel(allSel ? new Set() : new Set(rows.map((r) => r.id)));

  async function decideMany(ids, decision, reason) {
    if (!ids.length) return;
    setBusy(true);
    const patch = decision === "approved" ? { status: "approved" } : { status: "rejected", reject_reason: reason || "" };
    const { error } = await supabase.from("receipts").update({ ...patch, decided_at: new Date().toISOString() }).in("id", ids);
    setBusy(false);
    if (error) { toast(error.message, "err"); return; }
    toast(`${ids.length} ${decision === "approved" ? t("freigegeben") : t("abgelehnt")}`);
    if (decision === "approved") Promise.all(ids.map((id) => syncToDrive(id))).catch(() => {});
    load();
  }
  const decide = (id, decision, reason) => decideMany([id], decision, reason);
  const bulkApprove = () => decideMany([...sel], "approved");
  const bulkReject = () => { const reason = prompt(t("Ablehnungsgrund?")); if (reason !== null) decideMany([...sel], "rejected", reason); };

  return (
    <>
      <h1 className="title">{t("Freigaben")}</h1>
      <p className="lead">{rows.length} {t("zur Freigabe")}</p>
      {rows.length === 0 && <div className="empty"><Icon name="checkcheck" size={28} /><p>{t("Nichts zur Freigabe.")}</p></div>}
      {rows.length > 0 && (
        <div className="bulkbar">
          <label className="selall"><input type="checkbox" checked={allSel} onChange={toggleAll} />{sel.size > 0 ? `${sel.size} ${t("ausgewählt")}` : t("Alle auswählen")}</label>
          <div className="bulkacts">
            <button className="btn ghost" disabled={busy || !sel.size} onClick={bulkReject}><Icon name="x" size={15} /> {t("Ablehnen")}</button>
            <button className="btn" disabled={busy || !sel.size} onClick={bulkApprove}>{busy ? <span className="spin" /> : <Icon name="checkcheck" size={15} />} {t("Freigeben")}{sel.size ? ` (${sel.size})` : ""}</button>
          </div>
        </div>
      )}
      {rows.map((r) => (
        <div className={"lcard" + (sel.has(r.id) ? " selrow" : "")} key={r.id} style={{ cursor: "default" }}>
          <label className="selbox" onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={sel.has(r.id)} onChange={() => toggle(r.id)} /></label>
          <div className="lthumb" style={{ cursor: "pointer" }} onClick={() => onOpen(r.id)}><Icon name={(CATS[r.category] || CATS.other).icon} size={19} /></div>
          <div className="meta" style={{ cursor: "pointer" }} onClick={() => onOpen(r.id)}>
            <div className="t">{r.merchant || (r.source === "cash" ? t("Barauslage") : "")}</div>
            <div className="d">{dDE(r.doc_date)} · {t((CATS[r.category] || CATS.other).label)}{r.source === "cash" && <span className="mut"> · {t("Barauslage")}{r.recipient ? ` → ${r.recipient}` : ""}</span>}</div>
            <div className="d">{names[r.user_id] || r.creator_name || "—"}{r.created_by && r.created_by !== r.user_id ? <span className="mut"> · {t("im Auftrag von")} {names[r.created_by] || "—"}</span> : ""}</div>
            {(r.flags?.length > 0 || r.duplicate_of) && <span className="st st-app" style={{ marginTop: 6 }}><Icon name="alert" size={11} /> {r.duplicate_of ? t("mögliche Dublette") : `${r.flags.length} ${t("Hinweise")}`}</span>}
          </div>
          <div style={{ textAlign: "right" }}>
            <div className="amt">{money(r.gross, r.currency)}</div>
            <div style={{ display: "flex", gap: 6, marginTop: 8, justifyContent: "flex-end" }}>
              <button className="ap-ok" disabled={busy} onClick={() => decide(r.id, "approved")} title={t("Freigeben")}><Icon name="check" size={15} /></button>
              <button className="ap-no" disabled={busy} onClick={() => { const reason = prompt(t("Ablehnungsgrund?")); if (reason !== null) decide(r.id, "rejected", reason); }} title={t("Ablehnen")}>✕</button>
            </div>
          </div>
        </div>
      ))}
    </>
  );
}

function Detail({ id, onBack }) {
  const { t } = useT();
  const [r, setR] = useState(null);
  const [log, setLog] = useState([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [preview, setPreview] = useState(null);
  const load = useCallback(() => {
    supabase.from("receipts").select("*").eq("id", id).single().then(({ data }) => setR(data));
    supabase.from("audit_log").select("action,detail,created_at").eq("receipt_id", id).order("created_at").then(({ data }) => setLog(data || []));
  }, [id]);
  useEffect(() => { load(); }, [load]);
  // Namen für „erfasst von / für" auflösen (nur wenn im Auftrag erfasst).
  const [names, setNames] = useState(null);
  useEffect(() => {
    if (r?.created_by && r.created_by !== r.user_id) {
      supabase.from("profiles").select("id,full_name").in("id", [r.user_id, r.created_by].filter(Boolean))
        .then(({ data }) => { const m = {}; (data || []).forEach((p) => (m[p.id] = p.full_name)); setNames(m); });
    } else setNames(null);
  }, [r?.created_by, r?.user_id]);
  // Inline-Vorschau (signierter Link) für Bild-Belege.
  useEffect(() => {
    if (!r?.file_path) return;
    const isImg = /\.(png|jpe?g|webp|gif|heic)$/i.test(r.file_path);
    if (!isImg) { setPreview(null); return; }
    supabase.storage.from("receipts").createSignedUrl(r.file_path, 300).then(({ data }) => setPreview(data?.signedUrl || null));
  }, [r?.file_path]);
  if (!r) return <div className="center"><span className="spin" /></div>;

  async function openOriginal() {
    if (!r.file_path) return;
    const { data, error } = await supabase.storage.from("receipts").createSignedUrl(r.file_path, 120);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank"); else setMsg(error?.message || "—");
  }

  async function setStatus(status, extra = {}) {
    setBusy(true); setMsg("");
    try {
      const { error } = await supabase.from("receipts").update({ status, ...extra }).eq("id", id);
      if (error) throw error;
      toast(status === "submitted" ? t("Eingereicht") : t("Zurückgezogen"));
      load();
    } catch (e) { setMsg(e.message); toast(e.message, "err"); } finally { setBusy(false); }
  }

  async function syncNow() {
    setBusy(true);
    const d = await syncToDrive(id);
    setBusy(false);
    if (d?.ok) toast(t("In Drive abgelegt"));
    else if (d?.skipped) toast(t("Drive ist noch nicht konfiguriert."), "err");
    else toast(d?.error || "Fehler", "err");
    load();
  }

  async function handoff() {
    setBusy(true); setMsg("");
    try {
      const res = await fetch("/api/erpnext", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payment_method: r.payment_method, merchant: r.merchant, gross: r.gross }),
      });
      const j = await res.json();
      const { error } = await supabase.from("receipts").update({ status: "booked", erp_doctype: j.doctype, erp_docname: j.docname }).eq("id", id);
      if (error) throw error;
      setMsg(`${j.doctype} · ${j.docname}`);
      toast(`ERPNext: ${j.doctype} · ${j.docname}`);
      syncToDrive(id).then((d) => { if (d?.ok && !d.already) toast(t("In Drive abgelegt")); });
      load();
    } catch (e) { setMsg(e.message); toast(e.message, "err"); } finally { setBusy(false); }
  }

  const steps = [
    { k: "created", label: "Erfasst", done: true },
    { k: "ocr", label: "OCR & Plausibilität", done: true },
    { k: "submitted", label: "Eingereicht", done: ["submitted", "approved", "booked"].includes(r.status) },
    { k: "approved", label: "Freigabe", done: ["approved", "booked"].includes(r.status) },
    { k: "booked", label: "Übergabe ERPNext", done: r.status === "booked" },
  ];
  return (
    <>
      <button className="linkbtn" onClick={onBack} style={{ marginBottom: 10 }}><Icon name="chevronleft" size={16} /> {t("Zurück")}</button>
      <div className="lcard" style={{ cursor: "default" }}>
        <div className="lthumb"><Icon name={(CATS[r.category] || CATS.other).icon} size={19} /></div>
        <div className="meta"><div className="t">{r.merchant}</div><div className="d">{t((CATS[r.category] || CATS.other).label)} · {r.payment_method === "private" ? t("Privat verauslagt") : t("Firmenkarte")}</div></div>
        <div className="amt">{money(r.gross, r.currency)}</div>
      </div>
      {preview && (
        <a className="rcpt-prev" href={preview} target="_blank" rel="noreferrer" title={t("Öffnen")}>
          <img src={preview} alt={t("Originalbeleg")} />
        </a>
      )}
      <div className="card">
        <div className="kv"><span className="k">{t("Datum")}</span><span className="v">{dDE(r.doc_date)}</span></div>
        <div className="kv"><span className="k">{t("Währung")}</span><span className="v">{r.currency || "EUR"}</span></div>
        <div className="kv"><span className="k">{t("MwSt")}</span><span className="v">{r.vat_rate}% · {money(r.vat_amount, r.currency)}</span></div>
        <div className="kv"><span className="k">{t("Status")}</span><span className="v">{t(STATUS[r.status])}</span></div>
        {r.source === "cash" && (
          <div className="kv"><span className="k">{t("Barauslage")}</span><span className="v">{t("Empfänger")}: {r.recipient || "—"}</span></div>
        )}
        {r.created_by && r.created_by !== r.user_id && (
          <div className="kv"><span className="k">{t("Erfasst von")}</span>
            <span className="v">{names?.[r.created_by] || "—"} <span className="mut">· {t("für")} {names?.[r.user_id] || r.creator_name || "—"}</span></span></div>
        )}
        {r.erp_docname && <div className="kv"><span className="k">ERPNext</span><span className="v">{r.erp_doctype} · {r.erp_docname}</span></div>}
        <div className="kv"><span className="k">{t("Originalbeleg")}</span>
          <span className="v">{r.file_path ? <button className="linkbtn" style={{ color: "var(--green)" }} onClick={openOriginal}><Icon name="filetext" size={13} /> {t("Öffnen")}</button> : "—"}</span></div>
        {r.file_hash && <div className="kv"><span className="k">SHA-256</span><span className="v mono" style={{ fontSize: 11 }} title={r.file_hash}>{r.file_hash.slice(0, 20)}…</span></div>}
        <div className="kv"><span className="k">{t("Drive-Ablage")}</span>
          <span className="v">{r.drive_link
            ? <button className="linkbtn" style={{ color: "var(--green)" }} onClick={() => window.open(r.drive_link, "_blank")}><Icon name="link" size={13} /> {t("In Drive öffnen")}</button>
            : ["approved", "booked"].includes(r.status)
              ? <button className="linkbtn" disabled={busy} onClick={syncNow}><Icon name="upload" size={13} /> {t("Jetzt ablegen")}</button>
              : <span style={{ color: "var(--muted2)" }}>{t("nach Freigabe")}</span>}</span></div>
        {r.category === "hospitality" && (r.occasion || r.attendees) && <>
          <div className="kv"><span className="k">{t("Anlass der Bewirtung")}</span><span className="v">{r.occasion || "—"}</span></div>
          <div className="kv"><span className="k">{t("Teilnehmer")}</span><span className="v">{r.attendees || "—"}</span></div>
        </>}
      </div>
      {r.status === "rejected" && r.reject_reason && (
        <div className="bflag dup" style={{ marginBottom: 12 }}><Icon name="alert" size={13} /> {t("Abgelehnt")}: {r.reject_reason}</div>
      )}
      {r.duplicate_of && <div className="bflag dup" style={{ marginBottom: 12 }}><Icon name="alert" size={13} /> {t("Mögliche Dublette — dieser Beleg existiert bereits.")}</div>}
      {r.flags?.length > 0 && r.flags.map((fl) => <div className="bflag" key={fl} style={{ marginBottom: 8 }}><Icon name="alert" size={13} /> {t(fl)}</div>)}
      <div className="card">
        <div className="pw"><Icon name="filetext" /> {t("Verlauf (Audit-Trail)")}</div>
        {steps.map((s, i) => (
          <div className="tl" key={i}><div className={"mk " + (s.done ? "done" : "pending")}><Icon name={s.done ? "check" : "clock"} size={12} /></div>
            <div><b>{t(s.label)}</b></div></div>
        ))}
      </div>
      {(r.status === "draft" || r.status === "rejected") && (
        <button className="btn" disabled={busy} onClick={() => setStatus("submitted", { reject_reason: null })}>{busy ? <span className="spin" /> : <Icon name="arrowright" />} {t("Einreichen")}</button>
      )}
      {r.status === "submitted" && (
        <button className="btn ghost" disabled={busy} onClick={() => setStatus("draft")} style={{ marginBottom: 10 }}><Icon name="chevronleft" size={15} /> {t("Zurückziehen")}</button>
      )}
      {["submitted", "approved"].includes(r.status) && (
        <button className="btn" disabled={busy} onClick={handoff}>{busy ? <span className="spin" /> : <Icon name="link" />} {t("An ERPNext übergeben")}</button>
      )}
      {msg && <div className="ok">{msg}</div>}
    </>
  );
}

const MONTHS_DE = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
const monthLabel = (k) => { const [y, m] = k.split("-"); return `${MONTHS_DE[(+m) - 1]} ${y.slice(2)}`; };
const shortEur = (v) => (v >= 1000 ? (v / 1000).toLocaleString("de-DE", { maximumFractionDigits: 1 }) + "k" : Math.round(v).toString());

// Monatschart: SVG mit Gitter, Ø-Linie, hervorgehobenem aktuellem Monat (NEOS-konform).
function MonthlyChart({ months, data }) {
  const vals = months.map((k) => data[k] || 0);
  const max = Math.max(1, ...vals);
  const avg = vals.reduce((s, v) => s + v, 0) / (vals.length || 1);
  const n = months.length;
  const SCALE = 0.86; // Kopf-Freiraum über dem höchsten Balken für die Wert-Labels
  return (
    <div className="mc2">
      <div className="mc2-bars">
        <div className="mc2-avg" style={{ bottom: (avg / max) * 100 * SCALE + "%" }}><span>Ø {shortEur(avg)}</span></div>
        {months.map((k, i) => {
          const v = data[k] || 0;
          const cur = i === n - 1;
          return (
            <div className="mc2-col" key={k}>
              <div className={"mc2-bar" + (cur ? " cur" : "")} style={{ height: Math.max(1.5, (v / max) * 100 * SCALE) + "%" }}>
                <span className="mc2-val">{shortEur(v)}</span>
              </div>
            </div>
          );
        })}
      </div>
      <div className="mc2-labs">
        {months.map((k, i) => <div className={"mc2-lab" + (i === n - 1 ? " cur" : "")} key={k}>{monthLabel(k)}</div>)}
      </div>
    </div>
  );
}

function Dashboard() {
  const { t } = useT();
  const [rows, setRows] = useState(null);
  const [ccs, setCcs] = useState([]);
  const [profiles, setProfiles] = useState({});
  const [period, setPeriod] = useState("12m");
  const [cc, setCc] = useState("");
  const [cat, setCat] = useState("");

  useEffect(() => {
    supabase.from("receipts").select("id,merchant,doc_date,gross,net,vat_amount,category,status,payment_method,cost_center_id,user_id,creator_name,currency,gross_eur,fx_rate").then(({ data }) => setRows(data || []));
    supabase.from("cost_centers").select("id,code,name").order("code").then(({ data }) => setCcs(data || []));
    supabase.from("profiles").select("id,full_name").then(({ data }) => { const m = {}; (data || []).forEach((p) => (m[p.id] = p.full_name)); setProfiles(m); });
  }, []);
  if (!rows) return <div className="center"><span className="spin" /></div>;

  const ccMap = {}; ccs.forEach((c) => (ccMap[c.id] = c));
  const now = new Date();
  const cutoff = period === "all" ? null : new Date(now.getFullYear(), now.getMonth() - (period === "1m" ? 1 : period === "3m" ? 3 : 12) + 1, 1);
  const f = rows.filter((r) => {
    if (cc && r.cost_center_id !== cc) return false;
    if (cat && r.category !== cat) return false;
    if (cutoff && r.doc_date && new Date(r.doc_date) < cutoff) return false;
    return true;
  });

  // EUR value per receipt (converted at the receipt-date ECB rate); EUR receipts pass through.
  const eurOf = (r) => (r.gross_eur != null ? Number(r.gross_eur) : ((!r.currency || r.currency === "EUR") ? Number(r.gross || 0) : null));
  const sum = (a) => a.reduce((s, r) => s + (eurOf(r) ?? 0), 0);
  const total = sum(f);
  const vat = f.reduce((s, r) => { const e = eurOf(r); return s + (e && r.vat_rate ? e - e / (1 + r.vat_rate / 100) : 0); }, 0);
  const avg = f.length ? total / f.length : 0;
  const openR = f.filter((r) => ["review", "submitted", "approved"].includes(r.status));
  const openReimb = openR.filter((r) => r.payment_method === "private");
  const booked = f.filter((r) => r.status === "booked");
  const unconverted = f.filter((r) => eurOf(r) == null).length;
  const inReview = f.filter((r) => ["review", "submitted"].includes(r.status));

  // Vorperiode (gleich lange Spanne unmittelbar davor) für Deltas.
  const monthsBack = period === "1m" ? 1 : period === "3m" ? 3 : period === "12m" ? 12 : 0;
  const prevStart = monthsBack ? new Date(now.getFullYear(), now.getMonth() - 2 * monthsBack + 1, 1) : null;
  const prevF = (prevStart && cutoff) ? rows.filter((r) => {
    if (cc && r.cost_center_id !== cc) return false;
    if (cat && r.category !== cat) return false;
    const d = r.doc_date ? new Date(r.doc_date) : null;
    return d && d >= prevStart && d < cutoff;
  }) : [];
  const prevTotal = sum(prevF);
  const volDelta = prevTotal > 0 ? (total - prevTotal) / prevTotal * 100 : null;
  const cntDelta = prevF.length ? f.length - prevF.length : null;
  const bookedPct = total > 0 ? Math.round(sum(booked) / total * 100) : 0;

  // currency breakdown (original + EUR)
  const byCur = {};
  f.forEach((r) => { const c = r.currency || "EUR"; (byCur[c] ||= { count: 0, orig: 0, eur: 0 }); byCur[c].count++; byCur[c].orig += Number(r.gross || 0); byCur[c].eur += eurOf(r) ?? 0; });
  const curs = Object.entries(byCur).sort((a, b) => b[1].eur - a[1].eur);

  const agg = (keyFn) => { const m = {}; f.forEach((r) => { const k = keyFn(r); if (k == null) return; m[k] = (m[k] || 0) + (eurOf(r) ?? 0); }); return m; };
  const byCat = agg((r) => (CATS[r.category] || CATS.other).label);
  const byCc = agg((r) => (r.cost_center_id ? (ccMap[r.cost_center_id]?.code || "—") : "—"));
  const byMerch = agg((r) => r.merchant || "—");
  const byEmp = agg((r) => profiles[r.user_id] || r.creator_name || "—");
  const byMonth = agg((r) => (r.doc_date ? r.doc_date.slice(0, 7) : null));
  const byPay = agg((r) => (r.payment_method === "private" ? "Privat verauslagt" : "Firmenkarte"));

  const sorted = (m) => Object.entries(m).sort((a, b) => b[1] - a[1]);
  const months = Object.keys(byMonth).sort();
  const rampClass = (i) => (i === 0 ? "f1" : i <= 2 ? "f2" : "f3");
  const Bars = ({ map, label, limit }) => {
    const items = sorted(map).slice(0, limit || 99);
    const mx = Math.max(1, ...items.map((i) => i[1]));
    const tot = items.reduce((s, i) => s + i[1], 0) || 1;
    return (<div className="panel"><div className="pw">{t(label)}<span className="pw-hint">{t("Anteil am Volumen")}</span></div>
      {items.length === 0 && <div className="empty"><Icon name="banknote" size={26} /><p>{t("Keine Daten im Filter.")}</p></div>}
      {items.map(([k, v], i) => (
        <div className="rrow" key={k}>
          <div className="rmain">
            <div className="rlab" title={k}>{t(k)}</div>
            <div className="rtrack"><i className={rampClass(i)} style={{ width: (v / mx) * 100 + "%" }} /></div>
          </div>
          <div className="rrgt"><span className="rv">{eur(v)}</span><span className="rpct">{Math.round(v / tot * 100)}%</span></div>
        </div>))}
    </div>);
  };

  function exportCsv() {
    const head = ["Datum", "Händler", "Kategorie", "Kostenstelle", "Mitarbeiter", "Status", "Währung", "Brutto", "Brutto_EUR", "MwSt"];
    const lines = f.map((r) => [r.doc_date || "", (r.merchant || "").replace(/;/g, ","), (CATS[r.category] || CATS.other).label,
      r.cost_center_id ? (ccMap[r.cost_center_id]?.code || "") : "", profiles[r.user_id] || r.creator_name || "", STATUS[r.status] || r.status,
      r.currency || "EUR", Number(r.gross || 0).toFixed(2), (eurOf(r) != null ? eurOf(r).toFixed(2) : ""), Number(r.vat_amount || 0).toFixed(2)].join(";"));
    const blob = new Blob(["﻿" + [head.join(";"), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `snap-auswertung-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
  }

  function exportPdf() {
    const esc = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
    const periodLabel = { "1m": t("Monat"), "3m": t("3 Monate"), "12m": t("12 Monate"), all: t("Alle") }[period];
    const ccLabel = cc ? (ccMap[cc]?.code + " · " + ccMap[cc]?.name) : t("Alle Kostenstellen");
    const catLabel = cat ? t((CATS[cat] || CATS.other).label) : t("Alle Kategorien");
    const kpiHtml = [[t("Volumen"), eur(total)], [t("Belege"), String(f.length)], [t("Ø Betrag"), eur(avg)], [t("Vorsteuer"), eur(vat)], [t("Offene Erstattung"), eur(sum(openReimb))], [t("Gebucht"), eur(sum(booked))]]
      .map(([l, v]) => `<div class="k"><div class="kl">${esc(l)}</div><div class="kv">${esc(v)}</div></div>`).join("");
    const barTable = (title, entries, fmt) => `<h2>${esc(title)}</h2><table class="dist">${entries.map(([k, v]) => `<tr><td>${esc(k)}</td><td class="r">${fmt(v)}</td></tr>`).join("") || `<tr><td>${t("Keine Daten.")}</td><td></td></tr>`}</table>`;
    const sortedE = (m) => Object.entries(m).sort((a, b) => b[1] - a[1]);
    const rowsHtml = f.slice().sort((a, b) => (b.doc_date || "").localeCompare(a.doc_date || "")).map((r) => `<tr>
      <td>${esc(r.doc_date || "")}</td><td>${esc(r.merchant || "")}</td><td>${esc(t((CATS[r.category] || CATS.other).label))}</td>
      <td>${esc(r.cost_center_id ? (ccMap[r.cost_center_id]?.code || "") : "")}</td><td>${esc(t(STATUS[r.status] || r.status))}</td>
      <td class="r">${esc(money(r.gross, r.currency))}</td><td class="r">${eurOf(r) != null ? eur(eurOf(r)) : "—"}</td></tr>`).join("");
    const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>NEOS Snap — ${t("Auswertungen")}</title>
<style>
@page{margin:18mm 14mm}
*{box-sizing:border-box} body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;color:#111827;margin:0}
.head{display:flex;align-items:center;gap:12px;border-bottom:3px solid #2C3C2B;padding-bottom:12px;margin-bottom:6px}
.logo{width:34px;height:34px;border-radius:9px;background:#FAD201;display:flex;align-items:center;justify-content:center;font-weight:800;color:#2C3C2B;font-size:18px}
.head h1{font-size:20px;margin:0;color:#2C3C2B} .head .sub{color:#6b7280;font-size:12px;margin-top:2px}
.meta{color:#6b7280;font-size:11.5px;margin:8px 0 16px}
.kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:18px}
.k{border:1px solid #e5e7eb;border-radius:10px;padding:10px 12px} .kl{font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:.4px} .kv{font-size:18px;font-weight:800;margin-top:3px}
h2{font-size:13px;color:#2C3C2B;margin:16px 0 6px}
table{width:100%;border-collapse:collapse;font-size:11.5px} .dist td{padding:5px 4px;border-bottom:1px solid #eef0f2}
.list th{background:#f9fafb;text-align:left;padding:6px 5px;font-size:9.5px;text-transform:uppercase;letter-spacing:.3px;color:#6b7280;border-bottom:1px solid #e5e7eb}
.list td{padding:6px 5px;border-bottom:1px solid #f1f2f4} td.r{text-align:right;white-space:nowrap}
.foot{margin-top:18px;color:#9ca3af;font-size:10px;border-top:1px solid #e5e7eb;padding-top:8px}
.two{display:grid;grid-template-columns:1fr 1fr;gap:0 24px}
</style></head><body>
<div class="head"><div class="logo">S</div><div><h1>NEOS Snap — ${t("Auswertungen")}</h1><div class="sub">Neoterra · The Vegetable Company</div></div></div>
<div class="meta">${t("Zeitraum")}: ${esc(periodLabel)} · ${t("Kostenstelle")}: ${esc(ccLabel)} · ${t("Kategorie")}: ${esc(catLabel)} · ${f.length} ${t("Belege")} · ${t("Erstellt")}: ${new Date().toLocaleString("de-DE")}</div>
<div class="kpis">${kpiHtml}</div>
<div class="two"><div>${barTable(t("Nach Kategorie"), sortedE(byCat), eur)}${barTable(t("Nach Kostenstelle"), sortedE(byCc), eur)}</div>
<div>${barTable(t("Top-Lieferanten"), sortedE(byMerch).slice(0, 8), eur)}${barTable(t("Nach Währung"), curs.map(([c, v]) => [c, v.eur]), eur)}</div></div>
<h2>${t("Belege")}</h2>
<table class="list"><thead><tr><th>${t("Datum")}</th><th>${t("Händler")}</th><th>${t("Kategorie")}</th><th>KSt</th><th>${t("Status")}</th><th class="r">${t("Betrag")}</th><th class="r">EUR</th></tr></thead><tbody>${rowsHtml}</tbody></table>
<div class="foot">${t("Beträge in EUR · EZB-Kurs zum Belegdatum")} · NEOS Snap</div>
</body></html>`;
    const ifr = document.createElement("iframe");
    ifr.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
    document.body.appendChild(ifr);
    const d = ifr.contentWindow.document; d.open(); d.write(html); d.close();
    ifr.onload = () => { try { ifr.contentWindow.focus(); ifr.contentWindow.print(); } catch {} setTimeout(() => ifr.remove(), 1500); };
  }

  return (
    <>
      <div className="ahead">
        <h1 className="title">{t("Auswertungen")}</h1>
        <div className="ahead-actions">
          <button className="btn ghost" onClick={exportPdf}><Icon name="filetext" size={15} /> PDF</button>
          <button className="btn ghost" onClick={exportCsv}><Icon name="upload" size={15} /> {t("CSV-Export")}</button>
        </div>
      </div>
      <div className="filterbar">
        <div className="fseg">
          {[["1m", "Monat"], ["3m", "3 Monate"], ["12m", "12 Monate"], ["all", "Alle"]].map(([k, l]) => (
            <button key={k} className={"fs" + (period === k ? " on" : "")} onClick={() => setPeriod(k)}>{t(l)}</button>))}
        </div>
        <select value={cc} onChange={(e) => setCc(e.target.value)}>
          <option value="">{t("Alle Kostenstellen")}</option>
          {ccs.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
        </select>
        <select value={cat} onChange={(e) => setCat(e.target.value)}>
          <option value="">{t("Alle Kategorien")}</option>
          {Object.entries(CATS).map(([k, v]) => <option key={k} value={k}>{t(v.label)}</option>)}
        </select>
        <span className="shown">{f.length} {t("Belege")}</span>
      </div>

      <div className="kpis kx">
        <div className="kpi">
          <div className="kt"><Icon name="banknote" />{t("Volumen")}</div><div className="n mono">{eur(total)}</div>
          {volDelta == null
            ? <div className="ksub neu">{t("Gesamtzeitraum")}</div>
            : <div className={"ksub " + (volDelta >= 0 ? "pos" : "neg")}><Icon name={volDelta >= 0 ? "trendup" : "trenddown"} size={12} />{(volDelta >= 0 ? "+" : "") + volDelta.toFixed(1)}% {t("ggü. Vorperiode")}</div>}
        </div>
        <div className="kpi">
          <div className="kt"><Icon name="receipt" />{t("Belege")}</div><div className="n mono">{f.length}</div>
          <div className="ksub neu">{cntDelta == null ? t("Gesamtzeitraum") : `${cntDelta >= 0 ? "+" : ""}${cntDelta} ${t("ggü. Vorperiode")}`}</div>
        </div>
        <div className="kpi">
          <div className="kt"><Icon name="layers" />{t("Ø Betrag")}</div><div className="n mono">{eur(avg)}</div>
          <div className="ksub neu">{t("pro Beleg")}</div>
        </div>
        <div className="kpi">
          <div className="kt"><Icon name="checkcheck" />{t("Gebucht")}</div><div className="n mono">{eur(sum(booked))}</div>
          <div className="ksub neu">{bookedPct}% {t("des Volumens")}</div>
        </div>
      </div>
      <div className="kpis kx" style={{ marginTop: 14 }}>
        <div className="kpi">
          <div className="kt"><Icon name="wallet" />{t("Offene Erstattung")}</div><div className="n mono">{eur(sum(openReimb))}</div>
          <div className={"ksub " + (openReimb.length ? "warn" : "neu")}>{openReimb.length} {t("Belege offen")}</div>
        </div>
        <div className="kpi">
          <div className="kt"><Icon name="layers" />{t("Vorsteuer")}</div><div className="n mono">{eur(vat)}</div>
          <div className="ksub neu">{t("abziehbar (EUR)")}</div>
        </div>
        <div className="kpi">
          <div className="kt"><Icon name="clock" />{t("In Prüfung")}</div><div className="n mono">{inReview.length}</div>
          <div className={"ksub " + (inReview.length ? "warn" : "neu")}>{t("Belege zur Freigabe")}</div>
        </div>
        <div className="kpi">
          <div className="kt"><Icon name="trend" />{t("Ø pro Monat")}</div><div className="n mono">{eur(total / (months.length || 1))}</div>
          <div className="ksub neu">{months.length} {t("Monate")}</div>
        </div>
      </div>

      <div className="fxnote"><Icon name="banknote" size={12} /> {t("Beträge in EUR · EZB-Kurs zum Belegdatum")}{unconverted > 0 ? ` · ${unconverted} ${t("ohne Kurs")}` : ""}</div>

      {curs.length > 1 && (
        <div className="panel">
          <div className="pw"><Icon name="wallet" /> {t("Nach Währung")}<span className="pw-hint">{t("Anteil am Volumen")}</span></div>
          {curs.map(([c, v], i) => (
            <div className="rrow" key={c}>
              <div className="rmain">
                <div className="rlab">{c === "RON" ? "RON (Lei)" : c}</div>
                <div className="rtrack"><i className={rampClass(i)} style={{ width: (v.eur / (total || 1)) * 100 + "%" }} /></div>
              </div>
              <div className="rrgt"><span className="rv">{eur(v.eur)}</span><span className="rpct">{money(v.orig, c)}</span></div>
            </div>))}
        </div>
      )}

      <div className="panel">
        <div className="pw">{t("Ausgaben pro Monat")}<span className="pw-hint">Ø {eur(total / (months.length || 1))} · {t("Beträge in EUR")}</span></div>
        {months.length === 0
          ? <div className="empty"><Icon name="trend" size={26} /><p>{t("Keine Daten im Filter.")}</p></div>
          : <MonthlyChart months={months} data={byMonth} />}
      </div>

      <div className="agrid">
        <Bars map={byCat} label="Nach Kategorie" />
        <Bars map={byCc} label="Nach Kostenstelle" />
        <Bars map={byEmp} label="Nach Mitarbeiter" />
        <Bars map={byMerch} label="Top-Lieferanten" limit={6} />
      </div>

      <div className="panel">
        <div className="pw"><Icon name="wallet" /> {t("Zahlart")}<span className="pw-hint">{t("Anteil am Volumen")}</span></div>
        {sorted(byPay).map(([k, v], i) => { const mx = total || 1; return (
          <div className="rrow" key={k}>
            <div className="rmain">
              <div className="rlab">{t(k)}</div>
              <div className="rtrack"><i className={rampClass(i)} style={{ width: (v / mx) * 100 + "%" }} /></div>
            </div>
            <div className="rrgt"><span className="rv">{eur(v)}</span><span className="rpct">{Math.round(v / mx * 100)}%</span></div>
          </div>); })}
      </div>
    </>
  );
}

const ROLE_LABELS = { employee: "Mitarbeiter", approver: "Genehmiger", accounting: "Buchhaltung", admin: "Administrator" };

function Admin({ session }) {
  const { t } = useT();
  const [users, setUsers] = useState(null);
  const [form, setForm] = useState({ email: "", first_name: "", last_name: "", role: "employee" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [created, setCreated] = useState(null);
  const token = session.access_token;
  const auth = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  const load = useCallback(() => {
    fetch("/api/admin/users", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json()).then((j) => { if (j.error) setErr(j.error); setUsers(j.users || []); });
  }, [token]);
  useEffect(() => { load(); }, [load]);

  // ---- Kostenstellen ----
  const [ccList, setCcList] = useState(null);
  const [ccForm, setCcForm] = useState({ code: "", name: "" });
  const [ccBusy, setCcBusy] = useState(false);
  const loadCc = useCallback(() => {
    supabase.from("cost_centers").select("id,code,name,active").order("code").then(({ data }) => setCcList(data || []));
  }, []);
  useEffect(() => { loadCc(); }, [loadCc]);
  async function addCc(e) {
    e.preventDefault(); setCcBusy(true);
    const res = await fetch("/api/admin/cost-centers", { method: "POST", headers: auth, body: JSON.stringify(ccForm) });
    const j = await res.json().catch(() => ({}));
    setCcBusy(false);
    if (j.error) { toast(j.error, "err"); return; }
    setCcForm({ code: "", name: "" }); toast(t("Kostenstelle angelegt")); loadCc();
  }
  async function toggleCc(cc) {
    await fetch("/api/admin/cost-centers", { method: "PATCH", headers: auth, body: JSON.stringify({ id: cc.id, active: !cc.active }) });
    loadCc();
  }
  async function delCc(cc) {
    const res = await fetch("/api/admin/cost-centers", { method: "DELETE", headers: auth, body: JSON.stringify({ id: cc.id }) });
    const j = await res.json().catch(() => ({}));
    if (j.error) { toast(j.error, "err"); return; }
    toast(j.deactivated ? t("Kostenstelle deaktiviert (in Belegen verwendet)") : t("Kostenstelle gelöscht"));
    loadCc();
  }
  const [ccEdit, setCcEdit] = useState(null); // { id, code, name }
  async function saveCcEdit() {
    if (!ccEdit) return;
    if (!ccEdit.name.trim()) { toast(t("Bezeichnung erforderlich."), "err"); return; }
    const res = await fetch("/api/admin/cost-centers", { method: "PATCH", headers: auth, body: JSON.stringify({ id: ccEdit.id, code: ccEdit.code, name: ccEdit.name }) });
    const j = await res.json().catch(() => ({}));
    if (j.error) { toast(j.error, "err"); return; }
    setCcEdit(null); toast(t("Gespeichert")); loadCc();
  }

  async function createUser(e) {
    e.preventDefault(); setBusy(true); setErr(""); setCreated(null);
    try {
      const res = await fetch("/api/admin/users", { method: "POST", headers: auth, body: JSON.stringify(form) });
      const j = await res.json();
      if (j.error) throw new Error(j.error);
      setCreated({ email: j.user.email, password: j.password });
      setForm({ email: "", full_name: "", role: "employee" });
      load();
    } catch (e2) { setErr(e2.message); } finally { setBusy(false); }
  }
  async function changeRole(id, role) {
    await fetch("/api/admin/users", { method: "PATCH", headers: auth, body: JSON.stringify({ id, role }) });
    load();
  }
  const adminCount = (users || []).filter((u) => u.role === "admin").length;
  const [confirmUser, setConfirmUser] = useState(null);
  const [delBusy, setDelBusy] = useState(false);
  const [resetTarget, setResetTarget] = useState(null);
  const [resetBusy, setResetBusy] = useState(false);
  const [resetPw, setResetPw] = useState("");
  function askReset(u) { setResetPw(""); setResetTarget(u); }
  async function doReset() {
    if (!resetTarget) return;
    setResetBusy(true);
    const res = await fetch("/api/admin/users/reset", { method: "POST", headers: auth, body: JSON.stringify({ id: resetTarget.id }) });
    const j = await res.json().catch(() => ({}));
    setResetBusy(false);
    if (j.error) { toast(j.error, "err"); return; }
    setResetPw(j.password);
  }
  function delUser(u) {
    if (u.id === session.user.id) { toast(t("Du kannst dich nicht selbst löschen."), "err"); return; }
    if (u.role === "admin" && adminCount <= 1) { toast(t("Der letzte Administrator kann nicht gelöscht werden."), "err"); return; }
    setConfirmUser(u);
  }
  async function doDelete() {
    if (!confirmUser) return;
    setDelBusy(true);
    const res = await fetch("/api/admin/users", { method: "DELETE", headers: auth, body: JSON.stringify({ id: confirmUser.id }) });
    const j = await res.json().catch(() => ({}));
    setDelBusy(false);
    if (j.error) { toast(j.error, "err"); return; }
    setConfirmUser(null);
    toast(t("Nutzer gelöscht")); load();
  }

  const [drive, setDrive] = useState("");
  const [driveBusy, setDriveBusy] = useState(false);
  useEffect(() => {
    supabase.from("app_settings").select("value").eq("key", "gdrive_inbox_folder_id").maybeSingle().then(({ data }) => setDrive(data?.value || ""));
  }, []);
  async function saveDrive() {
    setDriveBusy(true);
    const { error } = await supabase.from("app_settings").upsert({ key: "gdrive_inbox_folder_id", value: drive.trim() || null, updated_at: new Date().toISOString() }, { onConflict: "key" });
    setDriveBusy(false);
    if (error) toast(error.message, "err"); else toast(t("Gespeichert"));
  }

  const [g, setG] = useState(null);
  useEffect(() => {
    fetch("/api/google", { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json()).then(setG).catch(() => {});
    try {
      const p = new URLSearchParams(window.location.search); const s = p.get("gdrive");
      if (s === "ok") toast(t("Google-Konto verbunden"));
      else if (s) toast(t("Google-Verbindung fehlgeschlagen"), "err");
      if (s) window.history.replaceState({}, "", window.location.pathname);
    } catch {}
  }, [token]);
  async function connectGoogle() {
    const r = await fetch("/api/google", { method: "POST", headers: auth, body: JSON.stringify({ action: "start" }) });
    const j = await r.json();
    if (j.url) window.location.href = j.url; else toast(j.error || "Fehler", "err");
  }
  async function disconnectGoogle() {
    await fetch("/api/google", { method: "POST", headers: auth, body: JSON.stringify({ action: "disconnect" }) });
    setG({ connected: false, email: null }); toast(t("Verbindung getrennt"));
  }

  return (
    <>
      <h1 className="title">{t("Nutzerverwaltung")}</h1>
      <p className="lead">{t("Nutzer & Rollen verwalten und die Beleg-Ablage konfigurieren.")}</p>
      {err && <div className="err" style={{ marginBottom: 12 }}>{err}</div>}

      <div className="card">
        <div className="pw"><Icon name="user" /> {t("Nutzer anlegen")}</div>
        <form onSubmit={createUser}>
          <div className="row2">
            <div className="field"><label>{t("E-Mail")}</label>
              <input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="name@neoterra.ag" /></div>
            <div className="field"><label>{t("Name")}</label>
              <input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} placeholder="Vor- Nachname" /></div>
          </div>
          <div className="field"><label>{t("Rolle")}</label>
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              {Object.keys(ROLE_LABELS).map((r) => <option key={r} value={r}>{t(ROLE_LABELS[r])}</option>)}
            </select></div>
          <button className="btn" disabled={busy} style={{ width: "auto", padding: "12px 18px" }}>{busy ? <span className="spin" /> : <Icon name="plus" />} {t("Anlegen")}</button>
        </form>
        {created && (
          <div className="ok" style={{ marginTop: 12 }}>
            <b>{t("Nutzer angelegt")}:</b> {created.email}<br />
            {t("Passwort (einmalig anzeigen):")} <span className="mono">{created.password}</span>
          </div>
        )}
      </div>

      <div className="card">
        <div className="pw"><Icon name="layers" /> {t("Beleg-Ablage (Google Drive)")}</div>
        <div className="kv" style={{ borderBottom: "1px solid var(--line2)", paddingBottom: 12, marginBottom: 12 }}>
          <span className="k">{t("Google-Konto")}</span>
          <span className="v">{g?.connected
            ? <><Icon name="check" size={13} style={{ color: "var(--emerald)", verticalAlign: "-2px" }} /> {g.email || t("verbunden")} · <button className="linkbtn" onClick={disconnectGoogle}>{t("Trennen")}</button></>
            : <button className="linkbtn" style={{ color: "var(--green)" }} onClick={connectGoogle}><Icon name="link" size={13} /> {t("Mit Google verbinden")}</button>}</span>
        </div>
        <div className="field"><label>{t("Inbox-Ordner-ID (Shared Drive)")}</label>
          <input value={drive} onChange={(e) => setDrive(e.target.value)} placeholder="z. B. 1Sx7gRp7-…" className="mono" /></div>
        <p className="hint" style={{ margin: "2px 0 12px" }}>{t("ID aus der Drive-URL …/folders/<ID>. Pro Mitarbeiter wird darunter automatisch ein Unterordner angelegt. Das verbundene Google-Konto muss Zugriff auf den Ordner haben.")}</p>
        <button type="button" className="btn" disabled={driveBusy} onClick={saveDrive} style={{ width: "auto", padding: "11px 18px" }}>{driveBusy ? <span className="spin" /> : <Icon name="check" size={15} />} {t("Speichern")}</button>
      </div>

      <div className="card">
        <div className="pw"><Icon name="layers" /> {t("Kostenstellen")}</div>
        <form onSubmit={addCc}>
          <div className="row2">
            <div className="field"><label>{t("Code")} <span className="mut" style={{ fontWeight: 400 }}>({t("optional")})</span></label>
              <input value={ccForm.code} onChange={(e) => setCcForm({ ...ccForm, code: e.target.value })} placeholder={t("wird sonst generiert")} className="mono" /></div>
            <div className="field"><label>{t("Bezeichnung")}</label>
              <input value={ccForm.name} onChange={(e) => setCcForm({ ...ccForm, name: e.target.value })} placeholder={t("z. B. Vertrieb")} required /></div>
          </div>
          <button className="btn" disabled={ccBusy} style={{ width: "auto", padding: "11px 18px" }}>{ccBusy ? <span className="spin" /> : <Icon name="plus" size={15} />} {t("Anlegen")}</button>
        </form>
        {ccList === null ? <div className="center" style={{ minHeight: 60 }}><span className="spin" /></div> : ccList.length === 0 ? (
          <p className="hint" style={{ marginTop: 12 }}>{t("Noch keine Kostenstellen — lege oben die erste an.")}</p>
        ) : (
          <table className="utable" style={{ marginTop: 14 }}>
            <thead><tr><th>{t("Code")}</th><th>{t("Bezeichnung")}</th><th>{t("Status")}</th><th aria-label={t("Aktionen")} /></tr></thead>
            <tbody>
              {ccList.map((cc) => {
                const editing = ccEdit?.id === cc.id;
                return (
                <tr key={cc.id} style={cc.active ? undefined : { opacity: 0.5 }}>
                  {editing ? (
                    <>
                      <td><input className="mono" value={ccEdit.code} onChange={(e) => setCcEdit({ ...ccEdit, code: e.target.value })} placeholder={t("wird sonst generiert")} style={{ padding: "7px 9px" }} /></td>
                      <td><input value={ccEdit.name} onChange={(e) => setCcEdit({ ...ccEdit, name: e.target.value })} style={{ padding: "7px 9px" }} /></td>
                      <td><button type="button" className="fchip" onClick={() => toggleCc(cc)}>{cc.active ? t("Aktiv") : t("Inaktiv")}</button></td>
                      <td style={{ textAlign: "right", whiteSpace: "nowrap", width: 80 }}>
                        <button type="button" className="brem" onClick={saveCcEdit} title={t("Speichern")} style={{ marginRight: 6, color: "var(--green)" }}><Icon name="check" size={15} /></button>
                        <button type="button" className="brem" onClick={() => setCcEdit(null)} title={t("Abbrechen")}><Icon name="x" size={15} /></button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="mono">{cc.code}</td>
                      <td>{cc.name}</td>
                      <td><button type="button" className="fchip" onClick={() => toggleCc(cc)} title={t("Status umschalten")}>{cc.active ? t("Aktiv") : t("Inaktiv")}</button></td>
                      <td style={{ textAlign: "right", whiteSpace: "nowrap", width: 80 }}>
                        <button type="button" className="brem" onClick={() => setCcEdit({ id: cc.id, code: cc.code || "", name: cc.name || "" })} title={t("Bearbeiten")} style={{ marginRight: 6 }}><Icon name="pencil" size={15} /></button>
                        <button type="button" className="brem" onClick={() => delCc(cc)} title={t("Löschen")}><Icon name="trash" size={15} /></button>
                      </td>
                    </>
                  )}
                </tr>
              );})}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <div className="pw"><Icon name="user" /> {t("Nutzer")} {users ? `(${users.length})` : ""}</div>
        {!users ? <div className="center" style={{ minHeight: 80 }}><span className="spin" /></div> : (
          <table className="utable">
            <thead><tr><th>{t("Name")}</th><th>{t("E-Mail")}</th><th>{t("Rolle")}</th><th aria-label={t("Aktionen")} /></tr></thead>
            <tbody>
              {users.map((u) => {
                const isSelf = u.id === session.user.id;
                const lastAdmin = u.role === "admin" && adminCount <= 1;
                const blocked = isSelf || lastAdmin;
                return (
                <tr key={u.id}>
                  <td>{u.full_name || "—"}</td>
                  <td className="muted">{u.email}</td>
                  <td><select value={u.role} onChange={(e) => changeRole(u.id, e.target.value)}>
                    {Object.keys(ROLE_LABELS).map((r) => <option key={r} value={r}>{t(ROLE_LABELS[r])}</option>)}
                  </select></td>
                  <td style={{ textAlign: "right", width: 84, whiteSpace: "nowrap" }}>
                    <button type="button" className="brem" onClick={() => askReset(u)}
                      title={t("Passwort zurücksetzen")} style={{ marginRight: 6 }}>
                      <Icon name="key" size={15} />
                    </button>
                    <button type="button" className="brem" onClick={() => delUser(u)} disabled={blocked}
                      title={isSelf ? t("Du kannst dich nicht selbst löschen.") : lastAdmin ? t("Der letzte Administrator kann nicht gelöscht werden.") : t("Nutzer löschen")}
                      style={blocked ? { opacity: 0.35, cursor: "not-allowed" } : undefined}>
                      <Icon name="trash" size={15} />
                    </button>
                  </td>
                </tr>
              );})}
            </tbody>
          </table>
        )}
      </div>

      {confirmUser && (
        <div className="modal-wrap" onClick={() => { if (!delBusy) setConfirmUser(null); }}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-ic"><Icon name="trash" size={20} /></div>
            <h3>{t("Nutzer löschen")}</h3>
            <p>{t("«{name}» wirklich löschen? Die erfassten Belege bleiben erhalten.").replace("{name}", confirmUser.full_name || confirmUser.email || "?")}</p>
            <div className="modal-actions">
              <button type="button" className="modal-btn ghost" disabled={delBusy} onClick={() => setConfirmUser(null)}>{t("Abbrechen")}</button>
              <button type="button" className="modal-btn danger" disabled={delBusy} onClick={doDelete}>{delBusy ? <span className="spin" /> : <Icon name="trash" size={14} />} {t("Löschen")}</button>
            </div>
          </div>
        </div>
      )}

      {resetTarget && (
        <div className="modal-wrap" onClick={() => { if (!resetBusy) setResetTarget(null); }}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-ic" style={{ background: "rgba(44,60,43,.1)", color: "var(--green)" }}><Icon name="key" size={20} /></div>
            {!resetPw ? (
              <>
                <h3>{t("Passwort zurücksetzen")}</h3>
                <p>{t("Für «{name}» ein neues Temp-Passwort erzeugen? Der Nutzer muss es beim nächsten Login ändern.").replace("{name}", resetTarget.full_name || resetTarget.email || "?")}</p>
                <div className="modal-actions">
                  <button type="button" className="modal-btn ghost" disabled={resetBusy} onClick={() => setResetTarget(null)}>{t("Abbrechen")}</button>
                  <button type="button" className="modal-btn" style={{ background: "var(--green)", color: "#fff" }} disabled={resetBusy} onClick={doReset}>{resetBusy ? <span className="spin" /> : <Icon name="key" size={14} />} {t("Zurücksetzen")}</button>
                </div>
              </>
            ) : (
              <>
                <h3>{t("Neues Passwort")}</h3>
                <p>{t("Temp-Passwort für")} <b>{resetTarget.full_name || resetTarget.email}</b> — {t("nur jetzt sichtbar:")}</p>
                <div className="ok" style={{ marginBottom: 16 }}><span className="mono" style={{ fontSize: 15 }}>{resetPw}</span></div>
                <div className="modal-actions">
                  <button type="button" className="modal-btn ghost" onClick={() => setResetTarget(null)}>{t("Fertig")}</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

