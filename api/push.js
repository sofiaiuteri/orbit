// Save a phone's push subscription (POST), or send a test notification (POST {test:true}).
import webpush from "web-push";
import { sql, isAuthed, unauthorized, readBody } from "./_lib.js";

export function setup() {
  webpush.setVapidDetails("mailto:noreply@sponsorflowhq.com", process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
}

export async function notifyAll(payload) {
  setup();
  const subs = await sql`SELECT endpoint, sub FROM nudge.push_subs`;
  let sent = 0;
  for (const s of subs) {
    try { await webpush.sendNotification(s.sub, JSON.stringify(payload)); sent++; }
    catch (e) { if (e.statusCode === 404 || e.statusCode === 410) await sql`DELETE FROM nudge.push_subs WHERE endpoint = ${s.endpoint}`; }
  }
  return sent;
}

export async function GET(req) {
  if (!isAuthed(req)) return unauthorized();
  return Response.json({ key: process.env.VAPID_PUBLIC_KEY || "" });
}

export async function POST(req) {
  if (!isAuthed(req)) return unauthorized();
  const b = await readBody(req);
  if (b.sub?.endpoint) {
    await sql`INSERT INTO nudge.push_subs (endpoint, sub) VALUES (${b.sub.endpoint}, ${JSON.stringify(b.sub)}::jsonb)
      ON CONFLICT (endpoint) DO UPDATE SET sub = EXCLUDED.sub`;
  }
  if (b.test) {
    const sent = await notifyAll({ title: "Orbit", body: "Notifications are on. I'll ping you when it's time to follow up.", url: "/" });
    return Response.json({ sent });
  }
  return Response.json({ ok: true });
}
