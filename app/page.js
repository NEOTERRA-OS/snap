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
const dDE = (s) => (s ? new Date(s).toLocaleDateString("de-DE", { day: "numeric", month: "long", year: "numeric" }) : "—");
const fileToBase64 = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(",")[1] || "");
  r.onerror = reject;
  r.readAsDataURL(file);
});

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

function Capture({ uid, onDone }) {
  const { t } = useT();
  const [stage, setStage] = useState("pick"); // pick | review
  const [preview, setPreview] = useState(null);
  const [filePath, setFilePath] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ccs, setCcs] = useState([]);
  const [form, setForm] = useState(null);
  const [drag, setDrag] = useState(false);

  useEffect(() => { supabase.from("cost_centers").select("id,code,name").order("code").then(({ data }) => setCcs(data || [])); }, []);

  function onFile(e) { const file = e.target.files?.[0]; if (file) handleFile(file); }
  function onDrop(e) {
    e.preventDefault(); setDrag(false);
    const file = e.dataTransfer?.files?.[0]; if (file) handleFile(file);
  }
  async function handleFile(file) {
    if (busy) return;
    setErr(""); setBusy(true);
    try {
      if (file.type.startsWith("image/")) setPreview(URL.createObjectURL(file));
      const path = `${uid}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.\-_]/g, "_")}`;
      const { error } = await supabase.storage.from("receipts").upload(path, file, { upsert: false });
      if (error) throw error;
      setFilePath(path);
      // Real OCR via Claude (server route); falls back to demo extraction if no API key.
      let ocr;
      try {
        const b64 = await fileToBase64(file);
        const res = await fetch("/api/ocr", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data: b64, mediaType: file.type, filename: file.name }),
        });
        const j = await res.json();
        ocr = j.fields || mockOcr(file.name);
      } catch { ocr = mockOcr(file.name); }
      setForm({ ...ocr, source: file.type.includes("pdf") ? "upload" : "photo", payment_method: "company_card", cost_center_id: ocr.cost_center_id || "" });
      setStage("review");
    } catch (e2) { setErr(e2.message); } finally { setBusy(false); }
  }

  async function save() {
    setBusy(true); setErr("");
    try {
      const vat_amount = form.gross && form.vat_rate ? +(form.gross - form.gross / (1 + form.vat_rate / 100)).toFixed(2) : null;
      const { error } = await supabase.from("receipts").insert({
        user_id: uid, status: "submitted", source: form.source, file_path: filePath,
        merchant: form.merchant, doc_date: form.doc_date, gross: form.gross, vat_rate: form.vat_rate,
        vat_amount, category: form.category, payment_method: form.payment_method,
        reimbursable: form.payment_method === "private", confidence: form.confidence,
        cost_center_id: form.cost_center_id || null,
      });
      if (error) throw error;
      onDone();
    } catch (e2) { setErr(e2.message); } finally { setBusy(false); }
  }

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
          <span className="dz-h">{t("Beleg hierher ziehen oder auswählen")}</span>
          <span className="dz-p">{t("JPG, PNG oder PDF · mehrseitige Belege werden zusammengeführt")}</span>
          <span className="dz-btn">{busy ? <span className="spin" /> : <Icon name="camera" size={15} />} {busy ? t("Lade hoch & erkenne …") : t("Datei auswählen")}</span>
          <input type="file" accept="image/*,application/pdf" capture="environment" hidden onChange={onFile} disabled={busy} />
        </label>
        <div className="tip"><Icon name="scan" size={14} /> {t("OCR startet automatisch nach dem Hochladen — du prüfst nur die markierten Felder.")}</div>
        {err && <div className="err">{err}</div>}
      </div>
    </>
  );

  return (
    <>
      <h1 className="title">{t("Prüfen & ergänzen")}</h1>
      <p className="lead" style={{ color: "var(--emerald)" }}><Icon name="check" size={13} /> {t("Beleg erkannt · Confidence ")}{form.confidence}%</p>
      {preview && <img className="preview" src={preview} alt="Beleg" style={{ marginBottom: 12 }} />}
      <div className="card">
        <div className="field"><label>{t("Händler")}</label><input value={form.merchant} onChange={(e) => setForm({ ...form, merchant: e.target.value })} /></div>
        <div className="row2">
          <div className="field"><label>{t("Datum")}</label><input type="date" value={form.doc_date} onChange={(e) => setForm({ ...form, doc_date: e.target.value })} /></div>
          <div className="field"><label>{t("Betrag brutto (€)")}</label><input type="number" step="0.01" value={form.gross} onChange={(e) => setForm({ ...form, gross: parseFloat(e.target.value) })} /></div>
        </div>
        <div className="field"><label>{t("MwSt-Satz (%)")}</label>
          <select value={form.vat_rate} onChange={(e) => setForm({ ...form, vat_rate: parseFloat(e.target.value) })}>
            <option value="19">19 %</option><option value="7">7 %</option><option value="0">0 %</option></select></div>
        <div className="field"><label>{t("Kategorie")}</label>
          <div className="chips">{Object.entries(CATS).map(([k, v]) => (
            <button key={k} className={"chip" + (form.category === k ? " on" : "")} onClick={() => setForm({ ...form, category: k })}>
              <Icon name={v.icon} size={14} /> {t(v.label)}</button>))}</div></div>
        <div className="field"><label>{t("Kostenstelle / Projekt")}</label>
          <select value={form.cost_center_id} onChange={(e) => setForm({ ...form, cost_center_id: e.target.value })}>
            <option value="">{t("— wählen —")}</option>{ccs.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</select></div>
        <div className="field"><label>{t("Zahlart")}</label>
          <div className="chips">
            <button className={"chip" + (form.payment_method === "company_card" ? " on" : "")} onClick={() => setForm({ ...form, payment_method: "company_card" })}><Icon name="wallet" size={14} /> {t("Firmenkarte")}</button>
            <button className={"chip" + (form.payment_method === "private" ? " on" : "")} onClick={() => setForm({ ...form, payment_method: "private" })}>{t("Privat verauslagt")}</button>
          </div></div>
      </div>
      {err && <div className="err">{err}</div>}
      <button className="btn" disabled={busy} onClick={save}>{busy ? <span className="spin" /> : <Icon name="arrowright" />} {t("Einreichen")}</button>
      <button className="btn ghost" style={{ marginTop: 10 }} onClick={() => { setStage("pick"); setForm(null); setPreview(null); }}>{t("Abbrechen")}</button>
    </>
  );
}

function Receipts({ uid, onOpen }) {
  const { t } = useT();
  const [rows, setRows] = useState(null);
  const [tab, setTab] = useState("all");
  const load = useCallback(() => {
    supabase.from("receipts").select("id,merchant,doc_date,gross,status,category").order("doc_date", { ascending: false })
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
          <div className="amt">{eur(r.gross)}</div>
        </div>
      ))}
    </>
  );
}

function Detail({ id, onBack }) {
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
      setMsg(`Übergeben an ERPNext: ${j.doctype} ${j.docname}`);
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
      <button className="linkbtn" onClick={onBack} style={{ marginBottom: 10 }}><Icon name="chevronleft" size={16} /> Zurück</button>
      <div className="lcard" style={{ cursor: "default" }}>
        <div className="lthumb"><Icon name={(CATS[r.category] || CATS.other).icon} size={19} /></div>
        <div className="meta"><div className="t">{r.merchant}</div><div className="d">{(CATS[r.category] || CATS.other).label} · {r.payment_method === "private" ? "Privat verauslagt" : "Firmenkarte"}</div></div>
        <div className="amt">{eur(r.gross)}</div>
      </div>
      <div className="card">
        <div className="kv"><span className="k">Datum</span><span className="v">{dDE(r.doc_date)}</span></div>
        <div className="kv"><span className="k">MwSt</span><span className="v">{r.vat_rate}% · {eur(r.vat_amount)}</span></div>
        <div className="kv"><span className="k">Status</span><span className="v">{STATUS[r.status]}</span></div>
        {r.erp_docname && <div className="kv"><span className="k">ERPNext</span><span className="v">{r.erp_doctype} · {r.erp_docname}</span></div>}
      </div>
      <div className="card">
        <div className="pw"><Icon name="filetext" /> Verlauf (Audit-Trail)</div>
        {steps.map((s, i) => (
          <div className="tl" key={i}><div className={"mk " + (s.done ? "done" : "pending")}><Icon name={s.done ? "check" : "clock"} size={12} /></div>
            <div><b>{s.label}</b></div></div>
        ))}
      </div>
      {["submitted", "approved"].includes(r.status) && (
        <button className="btn" disabled={busy} onClick={handoff}>{busy ? <span className="spin" /> : <Icon name="link" />} An ERPNext übergeben</button>
      )}
      {msg && <div className="ok">{msg}</div>}
    </>
  );
}

const MONTHS_DE = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
const monthLabel = (k) => { const [y, m] = k.split("-"); return `${MONTHS_DE[(+m) - 1]} ${y.slice(2)}`; };

function Dashboard() {
  const [rows, setRows] = useState(null);
  const [ccs, setCcs] = useState([]);
  const [profiles, setProfiles] = useState({});
  const [period, setPeriod] = useState("12m");
  const [cc, setCc] = useState("");
  const [cat, setCat] = useState("");

  useEffect(() => {
    supabase.from("receipts").select("id,merchant,doc_date,gross,net,vat_amount,category,status,payment_method,cost_center_id,user_id").then(({ data }) => setRows(data || []));
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

  const sum = (a) => a.reduce((s, r) => s + Number(r.gross || 0), 0);
  const total = sum(f);
  const vat = f.reduce((s, r) => s + Number(r.vat_amount || 0), 0);
  const avg = f.length ? total / f.length : 0;
  const openR = f.filter((r) => ["review", "submitted", "approved"].includes(r.status));
  const openReimb = openR.filter((r) => r.payment_method === "private");
  const booked = f.filter((r) => r.status === "booked");

  const agg = (keyFn) => { const m = {}; f.forEach((r) => { const k = keyFn(r); if (k == null) return; m[k] = (m[k] || 0) + Number(r.gross || 0); }); return m; };
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
    return (<div className="panel"><div className="pw"><Icon name="banknote" /> {label}</div>
      {items.length === 0 && <p className="lead">Keine Daten im Filter.</p>}
      {items.map(([k, v]) => (<div className="bar" key={k}><div className="lab" title={k}>{k}</div>
        <div className="track"><div className="fill" style={{ width: (v / mx) * 100 + "%" }} /></div>
        <div className="v">{eur(v)}</div></div>))}
    </div>);
  };

  function exportCsv() {
    const head = ["Datum", "Händler", "Kategorie", "Kostenstelle", "Mitarbeiter", "Status", "Brutto", "MwSt"];
    const lines = f.map((r) => [r.doc_date || "", (r.merchant || "").replace(/;/g, ","), (CATS[r.category] || CATS.other).label,
      r.cost_center_id ? (ccMap[r.cost_center_id]?.code || "") : "", profiles[r.user_id] || "", STATUS[r.status] || r.status,
      Number(r.gross || 0).toFixed(2), Number(r.vat_amount || 0).toFixed(2)].join(";"));
    const blob = new Blob(["﻿" + [head.join(";"), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `snap-auswertung-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
  }

  return (
    <>
      <div className="ahead">
        <h1 className="title">Auswertungen</h1>
        <button className="btn ghost csv" onClick={exportCsv}><Icon name="upload" size={15} /> CSV-Export</button>
      </div>
      <div className="filterbar">
        <div className="fseg">
          {[["1m", "Monat"], ["3m", "3 Monate"], ["12m", "12 Monate"], ["all", "Alle"]].map(([k, l]) => (
            <button key={k} className={"fs" + (period === k ? " on" : "")} onClick={() => setPeriod(k)}>{l}</button>))}
        </div>
        <select value={cc} onChange={(e) => setCc(e.target.value)}>
          <option value="">Alle Kostenstellen</option>
          {ccs.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
        </select>
        <select value={cat} onChange={(e) => setCat(e.target.value)}>
          <option value="">Alle Kategorien</option>
          {Object.entries(CATS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <span className="shown">{f.length} Belege</span>
      </div>

      <div className="kpis kx">
        <div className="kpi"><div className="kt"><Icon name="banknote" />Volumen</div><div className="n">{eur(total)}</div></div>
        <div className="kpi"><div className="kt"><Icon name="receipt" />Belege</div><div className="n">{f.length}</div></div>
        <div className="kpi"><div className="kt"><Icon name="layers" />Ø Betrag</div><div className="n">{eur(avg)}</div></div>
        <div className="kpi"><div className="kt"><Icon name="receipt" />Vorsteuer</div><div className="n">{eur(vat)}</div></div>
        <div className="kpi"><div className="kt"><Icon name="wallet" />Offene Erstattung</div><div className="n">{eur(sum(openReimb))}</div></div>
        <div className="kpi"><div className="kt"><Icon name="checkcheck" />Gebucht</div><div className="n">{eur(sum(booked))}</div></div>
      </div>

      <div className="panel">
        <div className="pw"><Icon name="trend" /> Ausgaben pro Monat</div>
        {months.length === 0 ? <p className="lead">Keine Daten im Filter.</p> : (
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
        <div className="pw"><Icon name="wallet" /> Zahlart</div>
        {sorted(byPay).map(([k, v]) => { const mx = total || 1; return (
          <div className="bar" key={k}><div className="lab">{k}</div><div className="track"><div className="fill" style={{ width: (v / mx) * 100 + "%" }} /></div><div className="v">{eur(v)}</div></div>); })}
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

