// GET: everyone + recent log. POST: one action on a person (reached out, followed up, replied, etc).
import { sql, isAuthed, unauthorized, readBody, today, addDays, RULES, logEvent } from "./_lib.js";

const FIELDS = ["name", "company", "role", "context", "email", "linkedin", "phone", "ask", "notes", "priority"];

export async function GET(req) {
  if (!isAuthed(req)) return unauthorized();
  const [people, log] = await Promise.all([
    sql`SELECT * FROM nudge.people WHERE status <> 'archived' ORDER BY name`,
    sql`SELECT * FROM nudge.log ORDER BY at DESC LIMIT 400`,
  ]);
  return Response.json({ people, log, today: today(), rules: RULES });
}

export async function POST(req) {
  if (!isAuthed(req)) return unauthorized();
  const b = await readBody(req);
  const t = today();
  const id = Number(b.id) || null;
  let person = null;
  if (id) [person] = await sql`SELECT * FROM nudge.people WHERE id = ${id}`;
  if (id && !person) return Response.json({ error: "Not found" }, { status: 404 });

  switch (b.action) {
    case "add": {
      const f = Object.fromEntries(FIELDS.map((k) => [k, (b[k] ?? "").toString().trim() || null]));
      if (!f.name) return Response.json({ error: "Name is required." }, { status: 400 });
      const out = b.reachedOut ? (b.date || t) : null;
      const [p] = await sql`INSERT INTO nudge.people (name, company, role, context, email, linkedin, phone, ask, notes, priority, status, last_outreach, followups_sent, next_due, stage)
        VALUES (${f.name}, ${f.company}, ${f.role}, ${f.context}, ${f.email}, ${f.linkedin}, ${f.phone}, ${f.ask}, ${f.notes}, ${f.priority || "normal"},
                ${out ? "waiting" : "to_contact"}, ${out}, 0, ${out ? addDays(out, RULES.first) : null}, ${out ? "followup" : null}) RETURNING *`;
      await logEvent(p.id, "added", out ? `Added. Reached out ${out}.` : "Added.");
      break;
    }
    case "edit": {
      const f = Object.fromEntries(FIELDS.map((k) => [k, b[k] === undefined ? person[k] : (b[k] ?? "").toString().trim() || null]));
      await sql`UPDATE nudge.people SET name=${f.name}, company=${f.company}, role=${f.role}, context=${f.context}, email=${f.email}, linkedin=${f.linkedin},
        phone=${f.phone}, ask=${f.ask}, notes=${f.notes}, priority=${f.priority || "normal"}, updated_at=now() WHERE id=${id}`;
      break;
    }
    case "reached_out": {
      const d = b.date || t;
      await sql`UPDATE nudge.people SET status='waiting', last_outreach=${d}, followups_sent=0, next_due=${addDays(d, RULES.first)}, stage='followup', updated_at=now() WHERE id=${id}`;
      await logEvent(id, "outreach", `Reached out${b.channel ? " by " + b.channel : ""}.`);
      break;
    }
    case "followed_up": {
      const n = (person.followups_sent || 0) + 1;
      const next = n >= RULES.maxFollowups ? addDays(t, RULES.closeAfter) : addDays(t, RULES.second);
      await sql`UPDATE nudge.people SET status='waiting', last_outreach=${t}, followups_sent=${n}, next_due=${next}, stage=${n >= RULES.maxFollowups ? "close" : "followup"}, updated_at=now() WHERE id=${id}`;
      await logEvent(id, "followup", `Sent follow-up #${n}.`);
      break;
    }
    case "replied": {
      await sql`UPDATE nudge.people SET status='replied', next_due=${addDays(t, 2)}, stage='schedule', updated_at=now() WHERE id=${id}`;
      await logEvent(id, "replied", "They replied.");
      break;
    }
    case "met": {
      await sql`UPDATE nudge.people SET status='keep_warm', last_met=${b.date || t}, next_due=${addDays(b.date || t, RULES.thanks)}, stage='thanks', updated_at=now() WHERE id=${id}`;
      await logEvent(id, "met", "Had the chat.");
      break;
    }
    case "thanked":
    case "checked_in": {
      await sql`UPDATE nudge.people SET status='keep_warm', last_outreach=${t}, next_due=${addDays(t, RULES.checkin)}, stage='checkin', updated_at=now() WHERE id=${id}`;
      await logEvent(id, b.action, b.action === "thanked" ? "Sent a thank-you." : "Checked in.");
      break;
    }
    case "snooze": {
      const days = Math.min(Math.max(Number(b.days) || 2, 1), 60);
      await sql`UPDATE nudge.people SET next_due=${addDays(t, days)}, updated_at=now() WHERE id=${id}`;
      await logEvent(id, "snooze", `Snoozed ${days} days.`);
      break;
    }
    case "no_reply": {
      await sql`UPDATE nudge.people SET status='no_reply', next_due=NULL, stage=NULL, updated_at=now() WHERE id=${id}`;
      await logEvent(id, "no_reply", "Marked no reply. Stopped nudging.");
      break;
    }
    case "remind_on": {
      await sql`UPDATE nudge.people SET next_due=${b.date},
        status = CASE WHEN status = 'no_reply' THEN 'keep_warm' ELSE status END,
        stage = CASE WHEN status = 'to_contact' THEN NULL WHEN status = 'no_reply' THEN 'checkin' ELSE COALESCE(stage, 'checkin') END, updated_at=now() WHERE id=${id}`;
      await logEvent(id, "remind", `Reminder set for ${b.date}.`);
      break;
    }
    case "note": {
      if (b.text) await logEvent(id, "note", String(b.text).slice(0, 2000));
      break;
    }
    case "archive": {
      await sql`UPDATE nudge.people SET status='archived', next_due=NULL, updated_at=now() WHERE id=${id}`;
      break;
    }
    default:
      return Response.json({ error: "Unknown action" }, { status: 400 });
  }
  return GET(req);
}
