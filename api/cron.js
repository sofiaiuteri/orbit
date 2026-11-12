// Runs every morning (see vercel.json). Closes out people who never replied after 2 follow-ups,
// then sends one phone notification listing who to follow up with today.
import { sql, today, logEvent } from "./_lib.js";
import { notifyAll } from "./push.js";

export async function GET(req) {
  const auth = req.headers.get("authorization") || "";
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) return new Response("Unauthorized", { status: 401 });
  const t = today();

  const closed = await sql`UPDATE nudge.people SET status='no_reply', next_due=NULL, stage=NULL, updated_at=now()
    WHERE status='waiting' AND stage='close' AND next_due <= ${t} RETURNING id, name`;
  for (const p of closed) await logEvent(p.id, "no_reply", "No reply after 2 follow-ups. Stopped nudging.");

  const due = await sql`SELECT name, stage, followups_sent FROM nudge.people
    WHERE next_due <= ${t} AND status IN ('waiting','replied','keep_warm','to_contact') ORDER BY (priority = 'high') DESC, next_due, name`;
  if (!due.length) return Response.json({ due: 0, closed: closed.length });

  const label = (p) => p.stage === "thanks" ? `${p.name} (thank-you)` : p.stage === "checkin" ? `${p.name} (check in)` : p.stage === "schedule" ? `${p.name} (set a time)` : p.name;
  const names = due.slice(0, 4).map(label).join(", ") + (due.length > 4 ? ` +${due.length - 4} more` : "");
  const body = due.length === 1 ? `Time to follow up with ${names}.` : `${due.length} follow-ups today: ${names}.`;
  const sent = await notifyAll({ title: "Nudge", body, url: "/", tag: "daily" });
  return Response.json({ due: due.length, closed: closed.length, sent });
}
