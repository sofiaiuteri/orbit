// Shared helpers. Files starting with "_" are not routes on Vercel.
import { neon } from "@neondatabase/serverless";
import crypto from "node:crypto";

export const sql = neon(process.env.DATABASE_URL);
const TZ = "America/New_York";

// Follow-up rhythm (days). First nudge 3 days after reaching out (window is day 3 to 4),
// second nudge a week after that, then stop after 2 follow-ups.
export const RULES = { first: 3, second: 7, closeAfter: 7, maxFollowups: 2, thanks: 1, checkin: 60 };

export function today() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
export function addDays(iso, n) {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// One password, signed cookie.
const COOKIE = "nudge_session";
const sign = () => crypto.createHmac("sha256", process.env.SESSION_SECRET || "dev").update("nudge-v1").digest("hex");
export function isAuthed(req) {
  const m = (req.headers.get("cookie") || "").match(new RegExp(`${COOKIE}=([a-f0-9]{64})`));
  return !!m && crypto.timingSafeEqual(Buffer.from(m[1]), Buffer.from(sign()));
}
export function sessionCookie() {
  const secure = process.env.VERCEL ? " Secure;" : "";
  return `${COOKIE}=${sign()}; Path=/; HttpOnly;${secure} SameSite=Lax; Max-Age=${60 * 60 * 24 * 365}`;
}
export const unauthorized = () => Response.json({ error: "Please log in." }, { status: 401 });
export async function readBody(req) {
  try { return await req.json(); } catch { return {}; }
}

export async function logEvent(personId, kind, text) {
  await sql`INSERT INTO nudge.log (person_id, kind, text) VALUES (${personId}, ${kind}, ${text})`;
}
