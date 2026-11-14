// Type what happened in plain English ("Ted: follow up after I finish my AI certification")
// and Claude turns it into tracker actions, which are then applied.
import Anthropic from "@anthropic-ai/sdk";
import { sql, isAuthed, unauthorized, readBody, today, RULES, logEvent } from "./_lib.js";
import { applyAny, FIELDS, JOB_STATUSES } from "./_actions.js";
import { loadState } from "./data.js";

const client = new Anthropic();
const ACTIONS = ["add", "edit", "reached_out", "followed_up", "replied", "meeting_set", "met", "thanked", "checked_in", "snooze", "remind_on", "hold", "hold_done", "no_reply", "note", "archive",
  "job_add", "job_status", "job_next", "job_note", "task_add", "task_done", "task_move", "project_add"];
const str = { type: ["string", "null"] };

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["actions", "reply", "question"],
  properties: {
    actions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["action", "person_id", "job_id", "task_id", "project_id", "status", "title", "date", "days", "reason", "text", "fields", "job"],
        properties: {
          action: { type: "string", enum: ACTIONS },
          person_id: { type: ["integer", "null"] },
          job_id: { type: ["integer", "null"] },
          task_id: { type: ["integer", "null"] },
          project_id: { type: ["integer", "null"] },
          status: { type: ["string", "null"] },
          title: str,
          job: { type: ["object", "null"], additionalProperties: false, required: ["firm", "role", "link"], properties: { firm: str, role: str, link: str } },
          date: str,
          days: { type: ["integer", "null"] },
          reason: str,
          text: str,
          fields: {
            type: ["object", "null"],
            additionalProperties: false,
            required: [...FIELDS, "reachedOut"],
            properties: { ...Object.fromEntries(FIELDS.map((k) => [k, str])), reachedOut: { type: ["boolean", "null"] } },
          },
        },
      },
    },
    reply: { type: "string" },
    question: str,
  },
};

const SYSTEM = `You update Orbit, Sofia's tracker for people (networking), job applications and projects, from short notes she types. Turn her note into actions.

Actions (person_id is the id from the people list; date is YYYY-MM-DD):
- add: new person. Put details in fields (name required; use null for unknown fields). fields.reachedOut true if she already contacted them (date = when, default today).
- edit: change details (fields: only the ones that change, others null). Also use for new email/LinkedIn/company.
- reached_out: she sent a first message (date = when, default today). Starts the follow-up clock (first follow-up after ${RULES.first} days).
- followed_up: she sent a follow-up.
- replied: they replied.
- meeting_set: a call or coffee is scheduled (date = the day of it; reason = short detail like "coffee in Greenwich"). Orbit asks how it went the day after. Use with replied if they also just replied.
- met: they already had a call or coffee (date = when). A thank-you reminder follows the next day.
- thanked / checked_in: she sent a thank-you / a check-in.
- snooze: push the reminder back (days).
- remind_on: remind her on a specific date (date; reason = what to do then, short).
- hold: she wants to wait until SHE finishes something with no fixed date (reason = the thing, e.g. "finish the AI certification"). Orbit will ask her every 3 weeks if it's done. If she gives a date, also set date.
- hold_done: the thing she was waiting on is finished, so the follow-up is due now.
- no_reply: stop reminding her about someone.
- note: save a fact about the person (text). Use this alongside other actions for useful details (what they said, how they met, intros offered).
- archive: remove someone (only if she clearly asks).

Jobs (job_id from the jobs list):
- job_status: set status (status one of: ${JOB_STATUSES.join(", ")}; date = when, e.g. the day she applied). "Applied to X" = job_status Applied.
- job_next: set the next step for a job (text = the step, date = when).
- job_note: save a note on a job (text).
- job_add: a job not in the list (job.firm, job.role, job.link if given; status, default "Not started", or "Applied" if she applied).
Projects (project_id and task_id from the projects list):
- task_add: add a to-do to a project (project_id, title, date = due date if given).
- task_done: she finished a task (task_id).
- task_move: move a task's due date (task_id, date).
- project_add: start a new project (title = name).
Use null for every field an action doesn't use.

Rules:
- Match names loosely (first name, typos, company). If two or more people could match and you can't tell which, return no actions and ask a short question.
- If the person isn't in the list and she describes a new contact, use add.
- Relative dates are relative to today. "Next week" means the coming Monday. Use the people list's dates for context.
- One note can mean several actions (e.g. "Ted replied and we're meeting Friday" = replied + remind_on Friday).
- reply: one short, friendly sentence confirming what you did, in plain words, no em dashes. question: null unless you need to ask.`;

export async function POST(req) {
  if (!isAuthed(req)) return unauthorized();
  const { text = "", dryRun = false } = await readBody(req);
  const note = String(text).trim().slice(0, 2000);
  if (!note) return Response.json({ error: "Type something first." }, { status: 400 });

  const people = await sql`SELECT id, name, company, role, status, stage, hold_reason, followups_sent, next_due::text AS next_due, last_outreach::text AS last_outreach
    FROM nudge.people WHERE status <> 'archived' ORDER BY name`;
  const jobs = await sql`SELECT id, firm, role, status FROM career.applications WHERE status NOT IN ('Closed','Withdrawn','Rejected') ORDER BY firm`;
  const projects = await sql`SELECT id, name FROM career.projects WHERE status <> 'Done' ORDER BY sort, id`;
  const tasks = await sql`SELECT id, project_id, title, due_date::text AS due FROM career.tasks WHERE done = false ORDER BY project_id, id`;
  const jobList = jobs.map((j) => `${j.id} | ${j.firm} | ${j.role || ""} | ${j.status}`).join("\n");
  const projList = projects.map((p) => `Project ${p.id}: ${p.name}\n` + tasks.filter((t) => t.project_id === p.id).map((t) => `  task ${t.id}: ${t.title}${t.due ? " (due " + t.due + ")" : ""}`).join("\n")).join("\n");
  const list = people.map((p) => [p.id, p.name, p.company || "", p.role || "", p.status, p.stage || "", p.hold_reason || "", `due ${p.next_due || "-"}`, `last ${p.last_outreach || "-"}`, `followups ${p.followups_sent}`].join(" | ")).join("\n");
  const t = today();
  const weekday = new Date(t + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });

  const request = {
    model: "claude-opus-5-5",
    max_tokens: 4000,
    system: SYSTEM,
    output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
    messages: [{ role: "user", content: `Today is ${weekday}, ${t}.\n\nPeople (id | name | company | role | status | stage | on hold for | next due | last outreach | follow-ups sent):\n${list}\n\nJobs (id | company | role | status):\n${jobList}\n\nProjects and open tasks:\n${projList}\n\nSofia's note:\n${note}` }],
  };

  let msg;
  try {
    // Server-side fallback: if the model declines, the API retries on a fallback model in the same call.
    msg = await client.beta.messages.create({ ...request, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" });
  } catch (e) {
    if (e instanceof Anthropic.BadRequestError) msg = await client.messages.create(request);
    else return Response.json({ error: "Couldn't reach Claude. Try again in a moment." }, { status: 502 });
  }
  if (msg.stop_reason === "refusal") return Response.json({ error: "Claude couldn't process that note." }, { status: 400 });
  const textBlock = msg.content.find((b) => b.type === "text");
  let plan;
  try { plan = JSON.parse(textBlock?.text || ""); } catch { return Response.json({ error: "Didn't understand that. Try rephrasing." }, { status: 400 }); }

  if (dryRun || plan.question) return Response.json({ plan, applied: [], ...(dryRun ? {} : await loadState()) });

  const ids = new Set(people.map((p) => p.id));
  const applied = [], errors = [];
  for (const a of plan.actions) {
    if (/^(job_|task_|project_)/.test(a.action)) {
      const jb = { action: a.action, id: a.job_id || a.task_id || a.project_id, project_id: a.project_id, status: a.status, date: a.date, days: a.days, text: a.text,
        next_action: a.text, title: a.title, name: a.title, firm: a.job?.firm, role: a.job?.role, link: a.job?.link };
      try { await applyAny(jb); applied.push({ action: a.action }); } catch (e) { errors.push(`${a.action}: ${e.message}`); }
      continue;
    }
    if (a.action !== "add" && !ids.has(a.person_id)) { errors.push(`Skipped ${a.action}: unknown person`); continue; }
    const f = a.fields || {};
    const body = { action: a.action, id: a.person_id, date: a.date, days: a.days, reason: a.reason, text: a.text, saveToNotes: true };
    for (const k of FIELDS) if (f[k] !== null && f[k] !== undefined) body[k] = f[k];
    if (a.action === "add") body.reachedOut = !!f.reachedOut;
    try {
      const id = await applyAny(body);
      applied.push({ action: a.action, id });
      if (a.action !== "note") ids.add(id);
    } catch (e) { errors.push(`${a.action}: ${e.message}`); }
  }
  for (const id of new Set(applied.filter((a) => a.id).map((a) => a.id))) await logEvent(id, "command", `You told Orbit: "${note.slice(0, 300)}"`);
  return Response.json({ plan, applied, errors, ...(await loadState()) });
}
