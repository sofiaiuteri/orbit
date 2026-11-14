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

// ---------- jobs (career.applications) and projects (career.projects / career.tasks) ----------
export const JOB_STATUSES = ["Idea", "Not started", "Applied", "Interviewing", "Offer", "Rejected", "Closed", "Withdrawn"];
async function jobLog(appId, text) { await sql`INSERT INTO career.activity (kind, text, app_id) VALUES ('orbit', ${text}, ${appId})`; }

export async function applyJobAction(b) {
  const t = today();
  const id = Number(b.id) || null;
  const d = isDate(b.date) ? b.date : null;
  if (b.action === "job_add") {
    if (!clean(b.firm)) throw new Error("Company is required.");
    const status = JOB_STATUSES.includes(b.status) ? b.status : "Not started";
    const [r] = await sql`INSERT INTO career.applications (firm, role, category, status, link, notes, deadline_date, applied_date, next_action, next_action_date)
      VALUES (${clean(b.firm)}, ${clean(b.role)}, ${clean(b.category)}, ${status}, ${clean(b.link)}, ${clean(b.notes)}, ${isDate(b.deadline_date) ? b.deadline_date : null},
              ${status === "Applied" ? (d || t) : null}, ${status === "Applied" ? "Follow up if no reply" : clean(b.next_action)}, ${status === "Applied" ? addDays(d || t, 10) : (isDate(b.next_action_date) ? b.next_action_date : null)}) RETURNING id`;
    await jobLog(r.id, `Added ${clean(b.firm)}${b.role ? ", " + b.role : ""}.`);
    return r.id;
  }
  const [job] = id ? await sql`SELECT * FROM career.applications WHERE id = ${id}` : [null];
  if (!job) throw new Error("Job not found");
  switch (b.action) {
    case "job_status": {
      const st = JOB_STATUSES.includes(b.status) ? b.status : null;
      if (!st) throw new Error("Unknown status");
      const applied = st === "Applied" ? (d || job.applied_date || t) : job.applied_date;
      const na = st === "Applied" ? "Follow up if no reply" : st === "Interviewing" ? "Prep for the interview" : ["Rejected", "Closed", "Withdrawn"].includes(st) ? null : job.next_action;
      const nad = st === "Applied" ? addDays(d || t, 10) : ["Rejected", "Closed", "Withdrawn"].includes(st) ? null : job.next_action_date;
      await sql`UPDATE career.applications SET status=${st}, applied_date=${applied}, next_action=${na}, next_action_date=${nad}, updated_at=now() WHERE id=${id}`;
      await jobLog(id, `Status: ${st}.`);
      return id;
    }
    case "job_next":
      await sql`UPDATE career.applications SET next_action=${clean(b.next_action)}, next_action_date=${d}, updated_at=now() WHERE id=${id}`;
      await jobLog(id, `Next: ${clean(b.next_action) || "none"}${d ? " on " + d : ""}.`);
      return id;
    case "job_edit":
      await sql`UPDATE career.applications SET firm=${clean(b.firm) || job.firm}, role=${b.role === undefined ? job.role : clean(b.role)}, link=${b.link === undefined ? job.link : clean(b.link)},
        deadline_date=${b.deadline_date === undefined ? job.deadline_date : (isDate(b.deadline_date) ? b.deadline_date : null)}, category=${b.category === undefined ? job.category : clean(b.category)},
        notes=${b.notes === undefined ? job.notes : clean(b.notes)}, updated_at=now() WHERE id=${id}`;
      return id;
    case "job_note":
      if (b.text) await sql`UPDATE career.applications SET notes = CONCAT_WS(E'\n', NULLIF(notes,''), ${t + ": " + String(b.text).slice(0, 1000)}), updated_at=now() WHERE id=${id}`;
      return id;
    default: throw new Error("Unknown job action");
  }
}

export async function applyTaskAction(b) {
  const t = today();
  const id = Number(b.id) || null;
  switch (b.action) {
    case "project_add": {
      if (!clean(b.name)) throw new Error("Project name is required.");
      const [r] = await sql`INSERT INTO career.projects (name, status, notes, link, sort) VALUES (${clean(b.name)}, 'Active', ${clean(b.notes)}, ${clean(b.link)}, 99) RETURNING id`;
      return r.id;
    }
    case "project_edit":
      await sql`UPDATE career.projects SET name=COALESCE(${clean(b.name)}, name), notes=${clean(b.notes)}, link=${clean(b.link)}, updated_at=now() WHERE id=${id}`;
      return id;
    case "project_done":
      await sql`UPDATE career.projects SET status='Done', updated_at=now() WHERE id=${id}`;
      return id;
    case "task_add": {
      const pid = Number(b.project_id) || null;
      if (!pid || !clean(b.title)) throw new Error("Need a project and a task.");
      const [r] = await sql`INSERT INTO career.tasks (project_id, title, due_date, done) VALUES (${pid}, ${clean(b.title)}, ${isDate(b.date) ? b.date : null}, false) RETURNING id`;
      return r.id;
    }
    case "task_done":
      await sql`UPDATE career.tasks SET done=true, done_at=${t} WHERE id=${id}`;
      return id;
    case "task_undo":
      await sql`UPDATE career.tasks SET done=false, done_at=NULL WHERE id=${id}`;
      return id;
    case "task_move":
      await sql`UPDATE career.tasks SET due_date=${isDate(b.date) ? b.date : addDays(t, Number(b.days) || 1)} WHERE id=${id}`;
      return id;
    case "task_delete":
      await sql`DELETE FROM career.tasks WHERE id=${id}`;
      return id;
    default: throw new Error("Unknown task action");
  }
}

export async function applyAny(b) {
  if (String(b.action || "").startsWith("job_")) return applyJobAction(b);
  if (/^(task_|project_)/.test(String(b.action || ""))) return applyTaskAction(b);
  return applyAction(b);
}
