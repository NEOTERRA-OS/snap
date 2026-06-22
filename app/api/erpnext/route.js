import { NextResponse } from "next/server";

// STUB for the ERPNext (Frappe) integration seam.
// In production this would POST to {FRAPPE_URL}/api/resource/{DocType}
// with token auth (api_key:api_secret), attach the original receipt via
// /api/method/upload_file, and be idempotent + retry-safe.
export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const reimbursable = body.payment_method === "private";
  const doctype = reimbursable ? "Expense Claim" : "Purchase Invoice";
  const prefix = reimbursable ? "EXP" : "PINV";
  const year = new Date().getFullYear();
  const seq = String(Math.floor(1000 + Math.random() * 8999));
  return NextResponse.json({
    ok: true,
    doctype,
    docname: `${prefix}-${year}-${seq}`,
    note: "Stub-Übergabe — produktiv via Frappe REST /api/resource",
  });
}
