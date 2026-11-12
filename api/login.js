import crypto from "node:crypto";
import { readBody, sessionCookie } from "./_lib.js";

export async function POST(req) {
  const { password = "" } = await readBody(req);
  const want = process.env.NUDGE_PASSWORD || "";
  const ok = want && password.length === want.length && crypto.timingSafeEqual(Buffer.from(password), Buffer.from(want));
  if (!ok) return Response.json({ error: "Wrong password." }, { status: 401 });
  return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json", "Set-Cookie": sessionCookie() } });
}
