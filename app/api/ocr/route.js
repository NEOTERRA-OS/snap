import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 30;

const CATS = ["fuel", "travel", "hospitality", "it", "lodging", "office", "other"];
const MODEL = process.env.OCR_MODEL || "claude-sonnet-4-6";

// Fallback if no API key is configured — keeps the app usable (demo extraction).
function mockFields(filename) {
  const f = (filename || "").toLowerCase();
  const today = new Date().toISOString().slice(0, 10);
  if (/aral|shell|tank|fuel/.test(f)) return { merchant: "ARAL Tankstelle", doc_date: today, gross: 77.16, vat_rate: 19, currency: "EUR", category: "fuel", confidence: 90 };
  if (/hotel|steigen|lodg/.test(f)) return { merchant: "Steigenberger Hotel", doc_date: today, gross: 149, vat_rate: 7, currency: "EUR", category: "lodging", confidence: 90 };
  if (/aws|micro|saas|it/.test(f)) return { merchant: "Microsoft 365", doc_date: today, gross: 42.84, vat_rate: 19, currency: "EUR", category: "it", confidence: 90 };
  if (/rest|adler|food/.test(f)) return { merchant: "Restaurant Adler", doc_date: today, gross: 86.5, vat_rate: 19, currency: "EUR", category: "hospitality", confidence: 90 };
  return { merchant: "", doc_date: today, gross: null, vat_rate: 19, currency: "EUR", category: "other", confidence: 60 };
}

const PROMPT = `Du bist ein Beleg-/Rechnungs-Extraktor. Lies den beigefügten Beleg (Foto/Scan/PDF, häufig deutsch oder rumänisch) und gib AUSSCHLIESSLICH ein JSON-Objekt zurück, ohne weiteren Text, mit genau diesen Feldern:
{
 "merchant": string,            // Händler/Lieferant
 "doc_date": "YYYY-MM-DD",      // Belegdatum
 "gross": number,               // Bruttobetrag (Summe), Punkt als Dezimaltrenner
 "net": number|null,            // Nettobetrag falls erkennbar
 "vat_rate": number,            // MwSt-Satz in Prozent (z. B. 19, 7, 0)
 "vat_amount": number|null,     // MwSt-Betrag falls erkennbar
 "currency": string,            // ISO-Code: meist "EUR", "USD" oder "RON" (rumänische Lei = RON)
 "invoice_no": string|null,     // Beleg-/Rechnungsnummer
 "category": "fuel|travel|hospitality|it|lodging|office|other",
 "confidence": number           // 0-100, deine Gesamtsicherheit
}
Regeln: Beträge als Zahl ohne Währungssymbol. Wenn ein Feld nicht lesbar ist, sinnvoll null bzw. leeren String setzen. Kategorie anhand des Händlers/Inhalts wählen (Tankstelle=fuel, Hotel=lodging, Restaurant=hospitality, Software/Cloud=it, Bahn/Flug/Parken=travel, Büromaterial=office, sonst other).`;

export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const { data, mediaType, filename } = body;
  const key = process.env.ANTHROPIC_API_KEY;

  // No key or no image → graceful fallback (keeps the app usable)
  if (!key || !data) {
    return NextResponse.json({ source: "mock", fields: mockFields(filename) });
  }

  try {
    const isPdf = (mediaType || "").includes("pdf");
    const block = isPdf
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data } }
      : { type: "image", source: { type: "base64", media_type: mediaType || "image/jpeg", data } };

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 700,
        messages: [{ role: "user", content: [block, { type: "text", text: PROMPT }] }],
      }),
    });

    if (!resp.ok) {
      const detail = await resp.text();
      console.error("[/api/ocr] Anthropic error:", resp.status, detail.slice(0, 300));
      return NextResponse.json({ source: "mock", error: `OCR ${resp.status}`, fields: mockFields(filename) });
    }

    const json = await resp.json();
    const text = (json.content || []).map((c) => c.text || "").join("").trim();
    const m = text.match(/\{[\s\S]*\}/);
    const parsed = m ? JSON.parse(m[0]) : {};

    // Normalize
    const num = (v) => (v === null || v === undefined || v === "" || isNaN(Number(v)) ? null : Number(v));
    const normCur = (c) => { let x = (c || "EUR").toString().toUpperCase().trim(); if (x === "LEI" || x === "RON LEI") x = "RON"; if (x === "$" || x === "USD$") x = "USD"; if (x === "€") x = "EUR"; return ["EUR", "USD", "RON"].includes(x) ? x : x; };
    const fields = {
      merchant: parsed.merchant || "",
      doc_date: /^\d{4}-\d{2}-\d{2}$/.test(parsed.doc_date) ? parsed.doc_date : new Date().toISOString().slice(0, 10),
      gross: num(parsed.gross),
      net: num(parsed.net),
      vat_rate: num(parsed.vat_rate) ?? 19,
      vat_amount: num(parsed.vat_amount),
      currency: normCur(parsed.currency),
      invoice_no: parsed.invoice_no || null,
      category: CATS.includes(parsed.category) ? parsed.category : "other",
      confidence: num(parsed.confidence) ?? 80,
    };
    return NextResponse.json({ source: "claude", model: MODEL, fields });
  } catch (e) {
    console.error("[/api/ocr] Error:", e?.message);
    return NextResponse.json({ source: "mock", error: e?.message, fields: mockFields(filename) });
  }
}
