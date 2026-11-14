// GET: everyone + recent history. POST: one action on a person (button taps go here).
import { sql, isAuthed, unauthorized, readBody, today, RULES } from "./_lib.js";
import { applyAny } from "./_actions.js";

export async function loadState() {
  const [people, log] = await Promise.all([
    sql`SELECT id, name, company, role, context, email, linkedin, phone, ask, notes, priority, status, followups_sent, stage, hold_reason,
          last_outreach::text AS last_outreach, last_met::text AS last_met, meeting_on::text AS meeting_on, next_due::text AS next_due
        FROM nudge.people WHERE status <> 'archived' ORDER BY name`,
    sql`SELECT person_id, at, kind, text FROM nudge.log ORDER BY at DESC LIMIT 500`,
  ]);
  const [jobs, projects, tasks] = await Promise.all([
    sql`SELECT id, firm, role, category, status, link, notes, next_action, deadline,
          deadline_date::text AS deadline_date, applied_date::text AS applied_date, next_action_date::text AS next_action_date
        FROM career.applications ORDER BY updated_at DESC`,
    sql`SELECT id, name, status, notes, link, sort FROM career.projects WHERE status <> 'Done' ORDER BY sort, id`,
    sql`SELECT id, project_id, title, done, due_date::text AS due_date, done_at::text AS done_at FROM career.tasks
        WHERE done = false OR done_at >= (now() - interval '14 days')::date ORDER BY due_date NULLS LAST, id`,
  ]);
  return { people, log, jobs, projects, tasks, today: today(), rules: RULES };
}

export async function GET(req) {
  if (!isAuthed(req)) return unauthorized();
  return Response.json(await loadState());
}

export async function POST(req) {
  if (!isAuthed(req)) return unauthorized();
  try { await applyAny(await readBody(req)); }
  catch (e) { return Response.json({ error: e.message }, { status: 400 }); }
  return Response.json(await loadState());
}
