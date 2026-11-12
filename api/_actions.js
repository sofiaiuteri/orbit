// Every change to a person goes through applyAction, whether it comes from a button or a typed command.
import { sql, today, addDays, RULES, logEvent } from "./_lib.js";

export const FIELDS = ["name", "company", "role", "context", "email", "linkedin", "phone", "ask", "notes", "priority"];
const clean = (v) => (v ?? "").toString().trim() || null;
const isDate = (d) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d);

export async function applyAction(b) {
  const t = today();
  const id = Number(b.id) || null;
  let person = null;
  if (id) [person] = await sql`SELECT * FROM nudge.people WHERE id = ${id}`;
  if (id && !person) throw new Error("Person not found");
  const d = isDate(b.date) ? b.date : t;

  switch (b.action) {
    case "add": {
      const f = Object.fromEntries(FIELDS.map((k) => [k, clean(b[k])]));
      if (!f.name) throw new Error("Name is required.");
      const out = b.reachedOut ? d : null;
      const [p] = await sql`INSERT INTO nudge.people (name, company, role, context, email, linkedin, phone, ask, notes, priority, status, last_outreach, followups_sent, next_due, stage)
        VALUES (${f.name}, ${f.company}, ${f.role}, ${f.context}, ${f.email}, ${f.linkedin}, ${f.phone}, ${f.ask}, ${f.notes}, ${f.priority || "normal"},
                ${out ? "waiting" : "to_contact"}, ${out}, 0, ${out ? addDays(out, RULES.first) : null}, ${out ? "followup" : null}) RETURNING id`;
      await logEvent(p.id, "added", out ? `Added. Reached out ${out}.` : "Added.");
      return p.id;
    }
    case "edit": {
      const f = Object.fromEntries(FIELDS.map((k) => [k, b[k] === undefined || b[k] === null ? person[k] : clean(b[k])]));
      await sql`UPDATE nudge.people SET name=${f.name}, company=${f.company}, role=${f.role}, context=${f.context}, email=${f.email}, linkedin=${f.linkedin},
        phone=${f.phone}, ask=${f.ask}, notes=${f.notes}, priority=${f.priority || "normal"}, updated_at=now() WHERE id=${id}`;
      return id;
    }
    case "reached_out":
      await sql`UPDATE nudge.people SET status='waiting', last_outreach=${d}, followups_sent=0, next_due=${addDays(d, RULES.first)}, stage='followup', hold_reason=NULL, updated_at=now() WHERE id=${id}`;
      await logEvent(id, "outreach", `Reached out${b.channel ? " by " + b.channel : ""}.`);
      return id;
    case "followed_up": {
      const n = (person.followups_sent || 0) + 1;
      const last = n >= RULES.maxFollowups;
      await sql`UPDATE nudge.people SET status='waiting', last_outreach=${d}, followups_sent=${n}, next_due=${addDays(d, last ? RULES.closeAfter : RULES.second)},
        stage=${last ? "close" : "followup"}, hold_reason=NULL, updated_at=now() WHERE id=${id}`;
      await logEvent(id, "followup", `Sent follow-up #${n}.`);
      return id;
    }
    case "replied":
      await sql`UPDATE nudge.people SET status='replied', next_due=${addDays(t, 2)}, stage='schedule', hold_reason=NULL, updated_at=now() WHERE id=${id}`;
      await logEvent(id, "replied", "They replied.");
      return id;
    case "meeting_set": {
      // A call or coffee is on the calendar: ask how it went the day after.
      const on = isDate(b.date) ? b.date : addDays(t, 7);
      await sql`UPDATE nudge.people SET status='replied', stage='meeting', meeting_on=${on}, next_due=${addDays(on, 1)}, hold_reason=NULL, updated_at=now() WHERE id=${id}`;
      await logEvent(id, "meeting", `Chat set for ${on}.${b.reason ? " " + b.reason : ""}`);
      return id;
    }
    case "met":
      await sql`UPDATE nudge.people SET status='keep_warm', last_met=${d}, next_due=${addDays(d, RULES.thanks)}, stage='thanks', hold_reason=NULL, updated_at=now() WHERE id=${id}`;
      await logEvent(id, "met", "Had the chat.");
      return id;
    case "thanked":
    case "checked_in":
      await sql`UPDATE nudge.people SET status='keep_warm', last_outreach=${d}, next_due=${addDays(d, RULES.checkin)}, stage='checkin', hold_reason=NULL, updated_at=now() WHERE id=${id}`;
      await logEvent(id, b.action, b.action === "thanked" ? "Sent a thank-you." : "Checked in.");
      return id;
    case "snooze": {
      const days = Math.min(Math.max(Number(b.days) || 2, 1), 120);
      await sql`UPDATE nudge.people SET next_due=${addDays(t, days)}, updated_at=now() WHERE id=${id}`;
      await logEvent(id, "snooze", `Snoozed ${days} days.`);
      return id;
    }
    case "remind_on":
      if (!isDate(b.date)) throw new Error("Need a date");
      await sql`UPDATE nudge.people SET next_due=${b.date},
        status = CASE WHEN status = 'no_reply' THEN 'keep_warm' ELSE status END,
        stage = CASE WHEN status = 'to_contact' THEN NULL WHEN status = 'no_reply' THEN 'checkin' WHEN stage = 'hold' THEN stage ELSE COALESCE(stage, 'checkin') END,
        updated_at=now() WHERE id=${id}`;
      await logEvent(id, "remind", `Reminder set for ${b.date}.${b.reason ? " " + b.reason : ""}`);
      return id;
    case "hold": {
      // Waiting on ME (e.g. "after I finish my AI certification"). Check back on a date, or every 3 weeks.
      const reason = clean(b.reason) || "something you're finishing first";
      const due = isDate(b.date) ? b.date : addDays(t, Number(b.days) || 21);
      await sql`UPDATE nudge.people SET stage='hold', hold_reason=${reason}, next_due=${due},
        status = CASE WHEN status IN ('no_reply','archived') THEN 'keep_warm' ELSE status END, updated_at=now() WHERE id=${id}`;
      await logEvent(id, "hold", `On hold until: ${reason}. Checking back ${due}.`);
      return id;
    }
    case "hold_done": {
      // The thing they were waiting on is done: put the follow-up on today's list.
      const stage = person.status === "to_contact" ? null : person.status === "waiting" ? "followup" : "checkin";
      await sql`UPDATE nudge.people SET stage=${stage}, hold_reason=NULL, next_due=${t}, updated_at=now() WHERE id=${id}`;
      await logEvent(id, "hold_done", `Done: ${person.hold_reason || "ready"}. Time to reach out.`);
      return id;
    }
    case "no_reply":
      await sql`UPDATE nudge.people SET status='no_reply', next_due=NULL, stage=NULL, hold_reason=NULL, updated_at=now() WHERE id=${id}`;
      await logEvent(id, "no_reply", "Marked no reply. Stopped reminders.");
      return id;
    case "note":
      if (b.text) {
        await logEvent(id, "note", String(b.text).slice(0, 2000));
        if (b.saveToNotes) await sql`UPDATE nudge.people SET notes = CONCAT_WS(E'\n\n', NULLIF(notes, ''), ${String(b.text)}), updated_at=now() WHERE id=${id}`;
      }
      return id;
    case "archive":
      await sql`UPDATE nudge.people SET status='archived', next_due=NULL, updated_at=now() WHERE id=${id}`;
      await logEvent(id, "archive", "Removed.");
      return id;
    default:
      throw new Error("Unknown action: " + b.action);
  }
}
