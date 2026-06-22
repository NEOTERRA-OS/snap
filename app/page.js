"use client";
import { useEffect, useState, useCallback } from "react";
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

function Shell({ session }) {
  const { t, lang, setLang } = useT();
  const [view, setView] = useState("capture");
  const [detail, setDetail] = useState(null);
  const [role, setRole] = useState(null);
  const uid = session.user.id;
  const who = session.user.user_metadata?.full_name || session.user.email;
  const signOut = () => supabase.auth.signOut();
  const initials = (who || "?").split(/[ @.]/).filter(Boolean).slice(0, 2).map((s) => s[0]?.toUpperCase()).join("");
  useEffect(() => { supabase.from("profiles").select("role").eq("id", uid).single().then(({ data }) => setRole(data?.role || "employee")); }, [uid]);
  const nav = (v, ic, label) => (
    <button className={"snav" + (view === v && !detail ? " on" : "")} onClick={() => { setDetail(null); setView(v); }}>
      <Icon name={ic} size={18} /> <span>{t(label)}</span>
    </button>
  );
  const bnav = (v, ic, label) => (
    <button className={"bnav" + (view === v && !detail ? " active" : "")} onClick={() => { setDetail(null); setView(v); }}><Icon name={ic} size={20} />{t(label)}</button>
  );
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="sb-brand"><Logo size={28} /> <span className="pn">NEOS <b>Snap</b></span></div>
        <div className="sb-grp">{t("Arbeiten")}</div>
        {nav("capture", "camera", "Erfassen")}
        {nav("receipts", "receipt", "Belege")}
        <div className="sb-grp">{t("Auswerten")}</div>
        {nav("dashboard", "dashboard", "Auswertungen")}
        {role === "admin" && nav("admin", "user", "Admin")}
        <button className="sb-cta" onClick={() => { setDetail(null); setView("capture"); }}><Icon name="plus" size={15} /> {t("Neuer Beleg")}</button>
        <div className="sb-foot">Neoterra · The Vegetable Company<br />NEOS Snap v0.1</div>
      </aside>
      <div className="maincol">
        <div className="topbar">
          <span className="brand mob-only"><Logo size={22} /> NEOS <b>Snap</b></span>
          <span className="spacer" />
          <span className="langtog">
            <button className={lang === "de" ? "on" : ""} onClick={() => setLang("de")}>DE</button>
            <button className={lang === "en" ? "on" : ""} onClick={() => setLang("en")}>EN</button>
          </span>
          <span className="who">{who}</span>
          <span className="avatar">{initials}</span>
          <button className="linkbtn" onClick={signOut} title={t("Abmelden")}><Icon name="logout" size={15} /></button>
        </div>
        <div className="content">
          <div className="container">
            {detail
              ? <Detail id={detail} onBack={() => setDetail(null)} />
              : view === "capture" ? <Capture uid={uid} onDone={() => setView("receipts")} />
              : view === "receipts" ? <Receipts uid={uid} onOpen={setDetail} />
              : view === "admin" ? <Admin session={session} />
              : <Dashboard />}
          </div>
        </div>
      </div>
      <div className="bottomnav">
        {bnav("capture", "plus", "Erfassen")}
        {bnav("receipts", "receipt", "Belege")}
        {bnav("dashboard", "dashboard", "Auswertungen")}
      </div>
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

  useEffect(() => { supabase.from("cost_centers").select("id,code,name").order("code").then(({ data }) => setCcs(data || [])); }, []);

  const upd = (id, patch) => setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));

  function onPick(e) { addFiles(Array.from(e.target.files || [])); e.target.value = ""; }
  function onDrop(e) { e.preventDefault(); setDrag(false); addFiles(Array.from(e.dataTransfer?.files || [])); }

  function addFiles(files) {
    if (!files.length) return;
    setErr(""); setStage("review");
    const newItems = files.map((file) => ({
      id: ++_seq, name: file.name, loading: true,
      preview: file.type.startsWith("image/") ? URL.createObjectURL(file) : null,
      filePath: null, file_hash: null, file_size: null, merchant: "", doc_date: new Date().toISOString().slice(0, 10),
      gross: null, currency: "EUR", vat_rate: null, category: "other",
      payment_method: "company_card", cost_center_id: "", confidence: null,
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
    } catch (e) { upd(id, { loading: false, error: e.message }); }
  }

  async function submitAll() {
    const ready = items.filter((it) => !it.loading);
    if (!ready.length) return;
    setBusy(true); setErr("");
    try {
      const rows = [];
      for (const it of ready) {
        const { eur, rate } = await fxToEur(it.gross, it.currency, it.doc_date);
        rows.push({
          user_id: uid, status: "submitted", source: it.source, file_path: it.filePath,
          merchant: it.merchant, doc_date: it.doc_date, gross: it.gross, vat_rate: it.vat_rate,
          currency: it.currency || "EUR", gross_eur: eur, fx_rate: rate,
          file_hash: it.file_hash, file_size: it.file_size,
          vat_amount: it.gross && it.vat_rate ? +(it.gross - it.gross / (1 + it.vat_rate / 100)).toFixed(2) : null,
          category: it.category, payment_method: it.payment_method,
          reimbursable: it.payment_method === "private", confidence: it.confidence,
          cost_center_id: it.cost_center_id || null,
        });
      }
      const { error } = await supabase.from("receipts").insert(rows);
      if (error) throw error;
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
          <div className="src on"><Icon name="camera" size={20} /> {t("Foto")}</div>
          <div className="src"><Icon name="scan" size={20} /> {t("Scan")}</div>
          <div className="src"><Icon name="upload" size={20} /> {t("Upload")}</div>
          <div className="src"><Icon name="mail" size={20} /> {t("E-Mail-Inbox")}</div>
        </div>
        <label className={"dropzone" + (drag ? " over" : "")}
          onDragOver={(e) => { e.preventDefault(); if (!drag) setDrag(true); }}
          onDragLeave={(e) => { e.preventDefault(); setDrag(false); }}
          onDrop={onDrop}>
          <span className="dz-ic"><Icon name="upload" size={30} /></span>
          <span className="dz-h">{t("Belege hierher ziehen oder auswählen")}</span>
          <span className="dz-p">{t("Mehrere Dateien möglich · JPG, PNG oder PDF")}</span>
          <span className="dz-btn"><Icon name="camera" size={15} /> {t("Dateien auswählen")}</span>
          <input type="file" accept="image/*,application/pdf" capture="environment" multiple hidden onChange={onPick} />
        </label>
        <div className="tip"><Icon name="scan" size={14} /> {t("OCR startet automatisch — du prüfst nur die markierten Felder.")}</div>
        {err && <div className="err">{err}</div>}
      </div>
    </>
  );

  return (
    <>
      <div className="ahead">
        <h1 className="title">{t("Prüfen & ergänzen")} ({items.length})</h1>
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
              : <span className="bstat ok"><Icon name="check" size={12} /> {it.confidence ?? "—"}%</span>}
            <button className="brem" onClick={() => setItems((p) => p.filter((x) => x.id !== it.id))} title={t("Entfernen")}>✕</button>
          </div>
          {!it.loading && (
            <div className="bgrid">
              <div className="field"><label>{t("Händler")}</label><input value={it.merchant} onChange={(e) => upd(it.id, { merchant: e.target.value })} /></div>
              <div className="field"><label>{t("Datum")}</label><input type="date" value={it.doc_date || ""} onChange={(e) => upd(it.id, { doc_date: e.target.value })} /></div>
              <div className="field"><label>{t("Betrag brutto")}</label><input type="number" step="0.01" value={it.gross ?? ""} onChange={(e) => upd(it.id, { gross: parseFloat(e.target.value) })} /></div>
              <div className="field"><label>{t("Währung")}</label>
                <select value={it.currency || "EUR"} onChange={(e) => upd(it.id, { currency: e.target.value })}>
                  {Array.from(new Set([it.currency || "EUR", "EUR", "USD", "RON"])).map((c) => <option key={c} value={c}>{c === "RON" ? "RON (Lei)" : c}</option>)}
                </select></div>
              <div className="field"><label>{t("MwSt-Satz (%)")}</label><input type="number" step="0.1" min="0" value={it.vat_rate ?? ""} onChange={(e) => upd(it.id, { vat_rate: e.target.value === "" ? null : parseFloat(e.target.value) })} /></div>
              <div className="field"><label>{t("Kategorie")}</label>
                <select value={it.category} onChange={(e) => upd(it.id, { category: e.target.value })}>
                  {Object.entries(CATS).map(([k, v]) => <option key={k} value={k}>{t(v.label)}</option>)}</select></div>
              <div className="field"><label>{t("Kostenstelle / Projekt")}</label>
                <select value={it.cost_center_id} onChange={(e) => upd(it.id, { cost_center_id: e.target.value })}>
                  <option value="">{t("— wählen —")}</option>{ccs.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</select></div>
              <div className="field"><label>{t("Zahlart")}</label>
                <select value={it.payment_method} onChange={(e) => upd(it.id, { payment_method: e.target.value })}>
                  <option value="company_card">{t("Firmenkarte")}</option><option value="private">{t("Privat verauslagt")}</option></select></div>
            </div>
          )}
        </div>
      ))}
      {err && <div className="err">{err}</div>}
      <button className="btn" disabled={busy || anyLoading || !items.length} onClick={submitAll}>
        {busy ? <span className="spin" /> : <Icon name="arrowright" />} {anyLoading ? t("OCR läuft …") : `${t("Alle einreichen")} (${items.filter((i) => !i.loading).length})`}
      </button>
      <button className="btn ghost" style={{ marginTop: 10 }} onClick={() => { setItems([]); setStage("pick"); }}>{t("Abbrechen")}</button>
    </>
  );
}

function Receipts({ uid, onOpen }) {
  const { t } = useT();
  const [rows, setRows] = useState(null);
  const [tab, setTab] = useState("all");
  const load = useCallback(() => {
    supabase.from("receipts").select("id,merchant,doc_date,gross,status,category,currency").order("doc_date", { ascending: false })
      .then(({ data }) => setRows(data || []));
  }, []);
  useEffect(() => { load(); }, [load]);
  if (!rows) return <div className="center"><span className="spin" /></div>;
  const filtered = rows.filter((r) => tab === "all" ? true : tab === "open" ? ["review", "submitted", "approved"].includes(r.status) : r.status === "booked");
  const open = rows.filter((r) => ["review", "submitted", "approved"].includes(r.status));
  const openSum = open.reduce((s, r) => s + Number(r.gross || 0), 0);
  return (
    <>
      <h1 className="title">{t("Meine Belege")}</h1>
      <div className="kpis">
        <div className="kpi"><div className="kt"><Icon name="receipt" />{t("Offen")}</div><div className="n">{open.length}</div></div>
        <div className="kpi"><div className="kt"><Icon name="wallet" />{t("Offenes Volumen")}</div><div className="n">{eur(openSum)}</div></div>
      </div>
      <div className="seg">
        {[["all", "Alle"], ["open", "In Prüfung"], ["booked", "Gebucht"]].map(([k, l]) => (
          <button key={k} className={"s" + (tab === k ? " on" : "")} onClick={() => setTab(k)}>{t(l)}</button>))}
      </div>
      {filtered.length === 0 && <p className="lead">{t("Keine Belege in dieser Ansicht.")}</p>}
      {filtered.map((r) => (
        <div key={r.id} className="lcard" onClick={() => onOpen(r.id)}>
          <div className="lthumb"><Icon name={(CATS[r.category] || CATS.other).icon} size={19} /></div>
          <div className="meta"><div className="t">{r.merchant}</div>
            <div className="d">{dDE(r.doc_date)} · {t((CATS[r.category] || CATS.other).label)}</div>
            <span className={"badge b-" + r.status} style={{ marginTop: 6 }}><span className="dot" />{t(STATUS[r.status])}</span></div>
          <div className="amt">{money(r.gross, r.currency)}</div>
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
  const load = useCallback(() => {
    supabase.from("receipts").select("*").eq("id", id).single().then(({ data }) => setR(data));
    supabase.from("audit_log").select("action,detail,created_at").eq("receipt_id", id).order("created_at").then(({ data }) => setLog(data || []));
  }, [id]);
  useEffect(() => { load(); }, [load]);
  if (!r) return <div className="center"><span className="spin" /></div>;

  async function openOriginal() {
    if (!r.file_path) return;
    const { data, error } = await supabase.storage.from("receipts").createSignedUrl(r.file_path, 120);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank"); else setMsg(error?.message || "—");
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
      load();
    } catch (e) { setMsg(e.message); } finally { setBusy(false); }
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
      <div className="card">
        <div className="kv"><span className="k">{t("Datum")}</span><span className="v">{dDE(r.doc_date)}</span></div>
        <div className="kv"><span className="k">{t("Währung")}</span><span className="v">{r.currency || "EUR"}</span></div>
        <div className="kv"><span className="k">{t("MwSt")}</span><span className="v">{r.vat_rate}% · {money(r.vat_amount, r.currency)}</span></div>
        <div className="kv"><span className="k">{t("Status")}</span><span className="v">{t(STATUS[r.status])}</span></div>
        {r.erp_docname && <div className="kv"><span className="k">ERPNext</span><span className="v">{r.erp_doctype} · {r.erp_docname}</span></div>}
        <div className="kv"><span className="k">{t("Originalbeleg")}</span>
          <span className="v">{r.file_path ? <button className="linkbtn" style={{ color: "var(--green)" }} onClick={openOriginal}><Icon name="filetext" size={13} /> {t("Öffnen")}</button> : "—"}</span></div>
        {r.file_hash && <div className="kv"><span className="k">SHA-256</span><span className="v mono" style={{ fontSize: 11 }} title={r.file_hash}>{r.file_hash.slice(0, 20)}…</span></div>}
      </div>
      <div className="card">
        <div className="pw"><Icon name="filetext" /> {t("Verlauf (Audit-Trail)")}</div>
        {steps.map((s, i) => (
          <div className="tl" key={i}><div className={"mk " + (s.done ? "done" : "pending")}><Icon name={s.done ? "check" : "clock"} size={12} /></div>
            <div><b>{t(s.label)}</b></div></div>
        ))}
      </div>
      {["submitted", "approved"].includes(r.status) && (
        <button className="btn" disabled={busy} onClick={handoff}>{busy ? <span className="spin" /> : <Icon name="link" />} {t("An ERPNext übergeben")}</button>
      )}
      {msg && <div className="ok">{msg}</div>}
    </>
  );
}

const MONTHS_DE = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
const monthLabel = (k) => { const [y, m] = k.split("-"); return `${MONTHS_DE[(+m) - 1]} ${y.slice(2)}`; };

function Dashboard() {
  const { t } = useT();
  const [rows, setRows] = useState(null);
  const [ccs, setCcs] = useState([]);
  const [profiles, setProfiles] = useState({});
  const [period, setPeriod] = useState("12m");
  const [cc, setCc] = useState("");
  const [cat, setCat] = useState("");

  useEffect(() => {
    supabase.from("receipts").select("id,merchant,doc_date,gross,net,vat_amount,category,status,payment_method,cost_center_id,user_id,currency,gross_eur,fx_rate").then(({ data }) => setRows(data || []));
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

  // currency breakdown (original + EUR)
  const byCur = {};
  f.forEach((r) => { const c = r.currency || "EUR"; (byCur[c] ||= { count: 0, orig: 0, eur: 0 }); byCur[c].count++; byCur[c].orig += Number(r.gross || 0); byCur[c].eur += eurOf(r) ?? 0; });
  const curs = Object.entries(byCur).sort((a, b) => b[1].eur - a[1].eur);

  const agg = (keyFn) => { const m = {}; f.forEach((r) => { const k = keyFn(r); if (k == null) return; m[k] = (m[k] || 0) + (eurOf(r) ?? 0); }); return m; };
  const byCat = agg((r) => (CATS[r.category] || CATS.other).label);
  const byCc = agg((r) => (r.cost_center_id ? (ccMap[r.cost_center_id]?.code || "—") : "—"));
  const byMerch = agg((r) => r.merchant || "—");
  const byEmp = agg((r) => profiles[r.user_id] || "—");
  const byMonth = agg((r) => (r.doc_date ? r.doc_date.slice(0, 7) : null));
  const byPay = agg((r) => (r.payment_method === "private" ? "Privat verauslagt" : "Firmenkarte"));

  const sorted = (m) => Object.entries(m).sort((a, b) => b[1] - a[1]);
  const months = Object.keys(byMonth).sort();
  const mMax = Math.max(1, ...Object.values(byMonth));
  const Bars = ({ map, label, limit }) => {
    const items = sorted(map).slice(0, limit || 99); const mx = Math.max(1, ...items.map((i) => i[1]));
    return (<div className="panel"><div className="pw"><Icon name="banknote" /> {t(label)}</div>
      {items.length === 0 && <p className="lead">{t("Keine Daten im Filter.")}</p>}
      {items.map(([k, v]) => (<div className="bar" key={k}><div className="lab" title={k}>{t(k)}</div>
        <div className="track"><div className="fill" style={{ width: (v / mx) * 100 + "%" }} /></div>
        <div className="v">{eur(v)}</div></div>))}
    </div>);
  };

  function exportCsv() {
    const head = ["Datum", "Händler", "Kategorie", "Kostenstelle", "Mitarbeiter", "Status", "Währung", "Brutto", "Brutto_EUR", "MwSt"];
    const lines = f.map((r) => [r.doc_date || "", (r.merchant || "").replace(/;/g, ","), (CATS[r.category] || CATS.other).label,
      r.cost_center_id ? (ccMap[r.cost_center_id]?.code || "") : "", profiles[r.user_id] || "", STATUS[r.status] || r.status,
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
        <div className="kpi"><div className="kt"><Icon name="banknote" />{t("Volumen")}</div><div className="n">{eur(total)}</div></div>
        <div className="kpi"><div className="kt"><Icon name="receipt" />{t("Belege")}</div><div className="n">{f.length}</div></div>
        <div className="kpi"><div className="kt"><Icon name="layers" />{t("Ø Betrag")}</div><div className="n">{eur(avg)}</div></div>
        <div className="kpi"><div className="kt"><Icon name="receipt" />{t("Vorsteuer")}</div><div className="n">{eur(vat)}</div></div>
        <div className="kpi"><div className="kt"><Icon name="wallet" />{t("Offene Erstattung")}</div><div className="n">{eur(sum(openReimb))}</div></div>
        <div className="kpi"><div className="kt"><Icon name="checkcheck" />{t("Gebucht")}</div><div className="n">{eur(sum(booked))}</div></div>
      </div>

      <div className="fxnote"><Icon name="banknote" size={12} /> {t("Beträge in EUR · EZB-Kurs zum Belegdatum")}{unconverted > 0 ? ` · ${unconverted} ${t("ohne Kurs")}` : ""}</div>

      {curs.length > 1 && (
        <div className="panel">
          <div className="pw"><Icon name="wallet" /> {t("Nach Währung")}</div>
          {curs.map(([c, v]) => (
            <div className="bar" key={c}><div className="lab">{c === "RON" ? "RON (Lei)" : c}</div>
              <div className="track"><div className="fill" style={{ width: (v.eur / (total || 1)) * 100 + "%" }} /></div>
              <div className="v" style={{ width: "auto", whiteSpace: "nowrap" }}>{money(v.orig, c)} · {eur(v.eur)}</div></div>))}
        </div>
      )}

      <div className="panel">
        <div className="pw"><Icon name="trend" /> {t("Ausgaben pro Monat")}</div>
        {months.length === 0 ? <p className="lead">{t("Keine Daten im Filter.")}</p> : (
          <div className="vbars">
            {months.map((k) => (
              <div className="vbar" key={k} title={`${monthLabel(k)}: ${eur(byMonth[k])}`}>
                <div className="vbval">{Math.round(byMonth[k] / 1000) >= 1 ? Math.round(byMonth[k] / 1000) + "k" : Math.round(byMonth[k])}</div>
                <div className="vbtrack"><div className="vbfill" style={{ height: (byMonth[k] / mMax) * 100 + "%" }} /></div>
                <div className="vblab">{monthLabel(k)}</div>
              </div>))}
          </div>)}
      </div>

      <div className="agrid">
        <Bars map={byCat} label="Nach Kategorie" />
        <Bars map={byCc} label="Nach Kostenstelle" />
        <Bars map={byEmp} label="Nach Mitarbeiter" />
        <Bars map={byMerch} label="Top-Lieferanten" limit={6} />
      </div>

      <div className="panel">
        <div className="pw"><Icon name="wallet" /> {t("Zahlart")}</div>
        {sorted(byPay).map(([k, v]) => { const mx = total || 1; return (
          <div className="bar" key={k}><div className="lab">{t(k)}</div><div className="track"><div className="fill" style={{ width: (v / mx) * 100 + "%" }} /></div><div className="v">{eur(v)}</div></div>); })}
      </div>
    </>
  );
}

const ROLE_LABELS = { employee: "Mitarbeiter", approver: "Genehmiger", accounting: "Buchhaltung", admin: "Administrator" };

function Admin({ session }) {
  const { t } = useT();
  const [users, setUsers] = useState(null);
  const [form, setForm] = useState({ email: "", full_name: "", role: "employee" });
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

  return (
    <>
      <h1 className="title">{t("Nutzerverwaltung")}</h1>
      <p className="lead">{t("Nutzer anlegen")} · {t("Rolle")}</p>
      {err && <div className="err" style={{ marginBottom: 12 }}>{err}</div>}

      <div className="panel">
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

      <div className="panel">
        <div className="pw"><Icon name="user" /> {t("Nutzer")} {users ? `(${users.length})` : ""}</div>
        {!users ? <div className="center" style={{ minHeight: 80 }}><span className="spin" /></div> : (
          <table className="utable">
            <thead><tr><th>{t("Name")}</th><th>{t("E-Mail")}</th><th>{t("Rolle")}</th></tr></thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>{u.full_name || "—"}</td>
                  <td className="muted">{u.email}</td>
                  <td><select value={u.role} onChange={(e) => changeRole(u.id, e.target.value)}>
                    {Object.keys(ROLE_LABELS).map((r) => <option key={r} value={r}>{t(ROLE_LABELS[r])}</option>)}
                  </select></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

