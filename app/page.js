"use client";
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabaseClient";
import Icon, { Logo } from "@/components/Icon";

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
        setOk("Konto erstellt. Bitte E-Mail bestätigen, dann anmelden.");
      }
    } catch (e2) { setErr(e2.message || "Fehler"); } finally { setBusy(false); }
  }
  return (
    <div className="auth">
      <div className="auth-hero">
        <div className="auth-glow" />
        <Logo size={46} />
        <div className="ah-name">NEOS <span>Snap</span></div>
        <div className="ah-tag">Belege &amp; Spesen — erfasst, geprüft, gebucht.</div>
      </div>
      <div className="auth-card">
        <div className="panel-card">
          <h3 className="auth-h">{mode === "signin" ? "Anmelden" : "Konto erstellen"}</h3>
          <p className="auth-sub">{mode === "signin" ? "Melde dich an, um Belege zu erfassen und freizugeben." : "Lege ein Konto für die Belegerfassung an."}</p>
          <form onSubmit={submit}>
            <div className="field"><label>E-Mail</label>
              <div className="inp"><Icon name="mail" /><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="name@neoterra.ag" /></div></div>
            <div className="field"><label>Passwort</label>
              <div className="inp"><Icon name="lock" /><input type={show ? "text" : "password"} value={pw} onChange={(e) => setPw(e.target.value)} required placeholder="••••••••" />
                <button type="button" className="eye" onClick={() => setShow(!show)} aria-label="Passwort anzeigen"><Icon name="eye" /></button></div></div>
            <button className="btn" disabled={busy}>{busy ? <span className="spin" /> : <Icon name="arrowright" />} {mode === "signin" ? "Anmelden" : "Registrieren"}</button>
          </form>
          {err && <div className="err">{err}</div>}
          {ok && <div className="ok">{ok}</div>}
          <p className="switch">{mode === "signin" ? "Noch kein Konto? " : "Bereits registriert? "}
            <button className="linkbtn" onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setErr(""); setOk(""); }}>
              {mode === "signin" ? "Registrieren" : "Anmelden"}</button></p>
          <div className="demo"><Icon name="check" size={15} /><div><b>Demo-Zugang</b><br /><span className="mono">demo@belegflow.neoterra.ag</span> · <span className="mono">belegflow2026</span></div></div>
          <div className="trust"><Icon name="shield" size={13} /> GoBD-konform · Daten in der EU</div>
        </div>
      </div>
    </div>
  );
}

function Shell({ session }) {
  const [view, setView] = useState("capture");
  const [detail, setDetail] = useState(null);
  const uid = session.user.id;
  const who = session.user.user_metadata?.full_name || session.user.email;
  const signOut = () => supabase.auth.signOut();
  return (
    <div className="app">
      <div className="topbar">
        <span className="brand"><Logo size={20} /> NEOS <b>Snap</b></span>
        <span className="spacer" />
        <span className="who">{who}</span>
        <button className="linkbtn" onClick={signOut}><Icon name="logout" size={14} /></button>
      </div>
      <div className="content">
        {detail
          ? <Detail id={detail} onBack={() => setDetail(null)} />
          : view === "capture" ? <Capture uid={uid} onDone={() => setView("receipts")} />
          : view === "receipts" ? <Receipts uid={uid} onOpen={setDetail} />
          : <Dashboard />}
      </div>
      <div className="bottomnav">
        <button className={"bnav" + (view === "capture" && !detail ? " active" : "")} onClick={() => { setDetail(null); setView("capture"); }}><Icon name="plus" size={20} />Erfassen</button>
        <button className={"bnav" + (view === "receipts" && !detail ? " active" : "")} onClick={() => { setDetail(null); setView("receipts"); }}><Icon name="receipt" size={20} />Belege</button>
        <button className={"bnav" + (view === "dashboard" && !detail ? " active" : "")} onClick={() => { setDetail(null); setView("dashboard"); }}><Icon name="dashboard" size={20} />Übersicht</button>
      </div>
    </div>
  );
}

function Capture({ uid, onDone }) {
  const [stage, setStage] = useState("pick"); // pick | review
  const [preview, setPreview] = useState(null);
  const [filePath, setFilePath] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ccs, setCcs] = useState([]);
  const [form, setForm] = useState(null);

  useEffect(() => { supabase.from("cost_centers").select("id,code,name").order("code").then(({ data }) => setCcs(data || [])); }, []);

  async function onFile(e) {
    const file = e.target.files?.[0]; if (!file) return;
    setErr(""); setBusy(true);
    try {
      if (file.type.startsWith("image/")) setPreview(URL.createObjectURL(file));
      const path = `${uid}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.\-_]/g, "_")}`;
      const { error } = await supabase.storage.from("receipts").upload(path, file, { upsert: false });
      if (error) throw error;
      setFilePath(path);
      const ocr = mockOcr(file.name);
      setForm({ ...ocr, source: file.type.includes("pdf") ? "upload" : "photo", payment_method: "company_card", cost_center_id: "" });
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
      <h1 className="title">Beleg erfassen</h1>
      <p className="lead">Foto, Scan oder PDF hochladen — OCR füllt die Felder automatisch.</p>
      <label className="dropzone">
        <Icon name="camera" /><div style={{ fontWeight: 700, color: "var(--ink)" }}>Beleg auswählen</div>
        <div style={{ fontSize: 12, marginTop: 4 }}>Foto · Scan · PDF · JPG/PNG</div>
        <input type="file" accept="image/*,application/pdf" capture="environment" hidden onChange={onFile} />
      </label>
      {busy && <p className="hint"><span className="spin" /> Lade hoch &amp; erkenne …</p>}
      {err && <div className="err">{err}</div>}
      <p className="hint">Tipp: Dateinamen mit „aral", „hotel", „aws", „restaurant" liefern passende Demo-Extraktion.</p>
    </>
  );

  return (
    <>
      <h1 className="title">Prüfen &amp; ergänzen</h1>
      <p className="lead" style={{ color: "var(--emerald)" }}><Icon name="check" size={13} /> Beleg erkannt · Confidence {form.confidence}%</p>
      {preview && <img className="preview" src={preview} alt="Beleg" style={{ marginBottom: 12 }} />}
      <div className="card">
        <div className="field"><label>Händler</label><input value={form.merchant} onChange={(e) => setForm({ ...form, merchant: e.target.value })} /></div>
        <div className="row2">
          <div className="field"><label>Datum</label><input type="date" value={form.doc_date} onChange={(e) => setForm({ ...form, doc_date: e.target.value })} /></div>
          <div className="field"><label>Betrag brutto (€)</label><input type="number" step="0.01" value={form.gross} onChange={(e) => setForm({ ...form, gross: parseFloat(e.target.value) })} /></div>
        </div>
        <div className="field"><label>MwSt-Satz (%)</label>
          <select value={form.vat_rate} onChange={(e) => setForm({ ...form, vat_rate: parseFloat(e.target.value) })}>
            <option value="19">19 %</option><option value="7">7 %</option><option value="0">0 %</option></select></div>
        <div className="field"><label>Kategorie</label>
          <div className="chips">{Object.entries(CATS).map(([k, v]) => (
            <button key={k} className={"chip" + (form.category === k ? " on" : "")} onClick={() => setForm({ ...form, category: k })}>
              <Icon name={v.icon} size={14} /> {v.label}</button>))}</div></div>
        <div className="field"><label>Kostenstelle / Projekt</label>
          <select value={form.cost_center_id} onChange={(e) => setForm({ ...form, cost_center_id: e.target.value })}>
            <option value="">— wählen —</option>{ccs.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</select></div>
        <div className="field"><label>Zahlart</label>
          <div className="chips">
            <button className={"chip" + (form.payment_method === "company_card" ? " on" : "")} onClick={() => setForm({ ...form, payment_method: "company_card" })}><Icon name="wallet" size={14} /> Firmenkarte</button>
            <button className={"chip" + (form.payment_method === "private" ? " on" : "")} onClick={() => setForm({ ...form, payment_method: "private" })}>Privat verauslagt</button>
          </div></div>
      </div>
      {err && <div className="err">{err}</div>}
      <button className="btn" disabled={busy} onClick={save}>{busy ? <span className="spin" /> : <Icon name="arrowright" />} Einreichen</button>
      <button className="btn ghost" style={{ marginTop: 10 }} onClick={() => { setStage("pick"); setForm(null); setPreview(null); }}>Abbrechen</button>
    </>
  );
}

function Receipts({ uid, onOpen }) {
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
      <h1 className="title">Meine Belege</h1>
      <div className="kpis">
        <div className="kpi"><div className="kt"><Icon name="receipt" />Offen</div><div className="n">{open.length}</div></div>
        <div className="kpi"><div className="kt"><Icon name="wallet" />Offenes Volumen</div><div className="n">{eur(openSum)}</div></div>
      </div>
      <div className="seg">
        {[["all", "Alle"], ["open", "In Prüfung"], ["booked", "Gebucht"]].map(([k, l]) => (
          <button key={k} className={"s" + (tab === k ? " on" : "")} onClick={() => setTab(k)}>{l}</button>))}
      </div>
      {filtered.length === 0 && <p className="lead">Keine Belege in dieser Ansicht.</p>}
      {filtered.map((r) => (
        <div key={r.id} className="lcard" onClick={() => onOpen(r.id)}>
          <div className="lthumb"><Icon name={(CATS[r.category] || CATS.other).icon} size={19} /></div>
          <div className="meta"><div className="t">{r.merchant}</div>
            <div className="d">{dDE(r.doc_date)} · {(CATS[r.category] || CATS.other).label}</div>
            <span className={"badge b-" + r.status} style={{ marginTop: 6 }}><span className="dot" />{STATUS[r.status]}</span></div>
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

function Dashboard() {
  const [rows, setRows] = useState(null);
  useEffect(() => { supabase.from("receipts").select("gross,category,status").then(({ data }) => setRows(data || [])); }, []);
  if (!rows) return <div className="center"><span className="spin" /></div>;
  const total = rows.reduce((s, r) => s + Number(r.gross || 0), 0);
  const booked = rows.filter((r) => r.status === "booked");
  const open = rows.filter((r) => ["review", "submitted", "approved"].includes(r.status));
  const byCat = {};
  rows.forEach((r) => { byCat[r.category] = (byCat[r.category] || 0) + Number(r.gross || 0); });
  const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...cats.map((c) => c[1]));
  return (
    <>
      <h1 className="title">Übersicht</h1>
      <div className="kpis">
        <div className="kpi"><div className="kt"><Icon name="receipt" />Belege gesamt</div><div className="n">{rows.length}</div></div>
        <div className="kpi"><div className="kt"><Icon name="banknote" />Volumen</div><div className="n">{eur(total)}</div></div>
        <div className="kpi"><div className="kt"><Icon name="clock" />Offen</div><div className="n">{open.length}</div></div>
        <div className="kpi"><div className="kt"><Icon name="checkcheck" />Gebucht</div><div className="n">{booked.length}</div></div>
      </div>
      <div className="card">
        <div className="pw"><Icon name="banknote" /> Ausgaben nach Kategorie</div>
        {cats.length === 0 && <p className="lead">Noch keine Daten.</p>}
        {cats.map(([k, v]) => (
          <div className="bar" key={k}><div className="lab">{(CATS[k] || CATS.other).label}</div>
            <div className="track"><div className="fill" style={{ width: (v / max) * 100 + "%" }} /></div>
            <div className="v">{eur(v)}</div></div>
        ))}
      </div>
    </>
  );
}
