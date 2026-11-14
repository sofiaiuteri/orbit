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

  const due = await sql`SELECT name, stage, hold_reason, followups_sent FROM nudge.people
    WHERE next_due <= ${t} AND status IN ('waiting','replied','keep_warm','to_contact') ORDER BY (priority = 'high') DESC, next_due, name`;
  const jobs = await sql`SELECT firm, next_action FROM career.applications WHERE status NOT IN ('Closed','Withdrawn','Rejected')
    AND (next_action_date <= ${t} OR (deadline_date BETWEEN ${t} AND (${t}::date + 3) AND status IN ('Idea','Not started')))`;
  const tasks = await sql`SELECT title FROM career.tasks WHERE done = false AND due_date <= ${t}`;
  if (!due.length && !jobs.length && !tasks.length) return Response.json({ due: 0, closed: closed.length });

  const label = (p) => p.stage === "hold" ? `${p.name} (done with ${p.hold_reason || "it"} yet?)` : p.stage === "meeting" ? `${p.name} (how did it go?)` : p.stage === "thanks" ? `${p.name} (thank-you)` : p.stage === "checkin" ? `${p.name} (check in)` : p.stage === "schedule" ? `${p.name} (set a time)` : p.name;
  const parts = [];
  if (due.length) parts.push(`${due.length} ${due.length === 1 ? "follow-up" : "follow-ups"}: ${due.slice(0, 3).map(label).join(", ")}${due.length > 3 ? ` +${due.length - 3}` : ""}`);
  if (jobs.length) parts.push(`${jobs.length} job ${jobs.length === 1 ? "step" : "steps"}: ${jobs.slice(0, 2).map((j) => j.firm).join(", ")}${jobs.length > 2 ? ` +${jobs.length - 2}` : ""}`);
  if (tasks.length) parts.push(`${tasks.length} ${tasks.length === 1 ? "task" : "tasks"} due`);
  const body = parts.join(" · ") + ".";
  const sent = await notifyAll({ title: "Orbit", body, url: "/", tag: "daily" });
  return Response.json({ due: due.length, jobs: jobs.length, tasks: tasks.length, closed: closed.length, sent });
}
