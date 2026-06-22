import { NextResponse } from "next/server";

export const runtime = "nodejs";

// Returns the EUR value of 1 unit of `from` on `date` (ECB rates via Frankfurter).
// e.g. /api/fx?from=USD&date=2026-06-02  -> { rate: 0.91, ... }  (1 USD = 0.91 EUR)
export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const from = (searchParams.get("from") || "EUR").toUpperCase();
  const date = searchParams.get("date") || "latest";
  if (from === "EUR") return NextResponse.json({ from, date, rate: 1, base: "EUR" });
  try {
    const valid = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "latest";
    const url = `https://api.frankfurter.app/${valid}?from=${from}&to=EUR`;
    const r = await fetch(url, { next: { revalidate: 86400 } });
    if (!r.ok) throw new Error("fx " + r.status);
    const j = await r.json();
    const rate = j?.rates?.EUR;
    if (!rate) throw new Error("no rate");
    return NextResponse.json({ from, date: j.date || valid, rate, base: "EUR" });
  } catch (e) {
    return NextResponse.json({ from, date, rate: null, error: e.message }, { status: 200 });
  }
}
