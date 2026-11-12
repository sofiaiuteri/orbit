// GET: everyone + recent history. POST: one action on a person (button taps go here).
import { sql, isAuthed, unauthorized, readBody, today, RULES } from "./_lib.js";
import { applyAction } from "./_actions.js";

export async function loadState() {
  const [people, log] = await Promise.all([
    sql`SELECT id, name, company, role, context, email, linkedin, phone, ask, notes, priority, status, followups_sent, stage, hold_reason,
          last_outreach::text AS last_outreach, last_met::text AS last_met, meeting_on::text AS meeting_on, next_due::text AS next_due
        FROM nudge.people WHERE status <> 'archived' ORDER BY name`,
    sql`SELECT person_id, at, kind, text FROM nudge.log ORDER BY at DESC LIMIT 500`,
  ]);
  return { people, log, today: today(), rules: RULES };
}

export async function GET(req) {
  if (!isAuthed(req)) return unauthorized();
  return Response.json(await loadState());
}

export async function POST(req) {
  if (!isAuthed(req)) return unauthorized();
  try { await applyAction(await readBody(req)); }
  catch (e) { return Response.json({ error: e.message }, { status: 400 }); }
  return Response.json(await loadState());
}
