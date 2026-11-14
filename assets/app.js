// Orbit: who to follow up with today. Vanilla JS, no build step.
const DEMO = new URLSearchParams(location.search).has("demo");
const SIGNATURE = "Sofia";
const CALENDAR = "https://calendly.com/experienceexchangemag/30min";
const COLONNADE = "https://advancement.wlu.edu/portal/directory?tab=home";
const liSearch = (p) => "https://www.linkedin.com/search/results/people/?keywords=" + encodeURIComponent([p.name, p.company].filter(Boolean).join(" "));
let S = { people: [], log: [], today: "", rules: {} };
let tab = "today", filter = "all", query = "";

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const first = (n) => String(n || "").trim().split(/\s+/)[0];
const days = (a, b) => Math.round((new Date(b + "T12:00:00Z") - new Date(a + "T12:00:00Z")) / 86400000);
const addDays = (iso, n) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const nice = (iso) => iso ? new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : "";
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("show"), 1800); }

// ---------- data ----------
async function load() {
  if (DEMO) { S = structuredClone(window.NUDGE_DEMO); return showApp(); }
  const r = await fetch("/api/data");
  if (r.status === 401) return showLogin();
  S = await r.json(); showApp();
}
async function act(body, msg) {
  if (DEMO) { demoAct(body); render(); if (msg) toast(msg); return; }
  const r = await fetch("/api/data", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) return toast(j.error || "Something went wrong");
  S = j; render(); if (msg) toast(msg);
}
// Same rules as the server, for the demo only.
function demoAct(b) {
  const t = S.today, R = S.rules, p = S.people.find((x) => x.id === b.id);
  const set = (o) => Object.assign(p, o);
  const log = (text) => S.log.unshift({ person_id: b.id || 0, at: new Date().toISOString(), kind: b.action, text });
  if (b.action === "add") { const id = Math.max(0, ...S.people.map((x) => x.id)) + 1; const out = b.reachedOut ? (b.date || t) : null;
    S.people.push({ ...b, id, status: out ? "waiting" : "to_contact", last_outreach: out, followups_sent: 0, next_due: out ? addDays(out, R.first) : null, stage: out ? "followup" : null }); return; }
  if (b.action === "edit") return set(b);
  if (b.action === "reached_out") { set({ status: "waiting", last_outreach: b.date || t, followups_sent: 0, next_due: addDays(b.date || t, R.first), stage: "followup" }); return log("Reached out."); }
  if (b.action === "followed_up") { const n = (p.followups_sent || 0) + 1; set({ status: "waiting", last_outreach: t, followups_sent: n, next_due: addDays(t, n >= R.maxFollowups ? R.closeAfter : R.second), stage: n >= R.maxFollowups ? "close" : "followup" }); return log(`Sent follow-up #${n}.`); }
  if (b.action === "replied") { set({ status: "replied", next_due: addDays(t, 2), stage: "schedule" }); return log("They replied."); }
  if (b.action === "met") { set({ status: "keep_warm", last_met: t, next_due: addDays(t, R.thanks), stage: "thanks" }); return log("Had the chat."); }
  if (b.action === "thanked" || b.action === "checked_in") { set({ status: "keep_warm", last_outreach: t, next_due: addDays(t, R.checkin), stage: "checkin" }); return log("Done."); }
  if (b.action === "snooze") { set({ next_due: addDays(t, b.days || 2) }); return; }
  if (b.action === "no_reply") { set({ status: "no_reply", next_due: null, stage: null }); return; }
  if (b.action === "remind_on") { set({ next_due: b.date, stage: p.stage || "checkin" }); return; }
  if (b.action === "hold_done") { set({ stage: p.status === "to_contact" ? null : p.status === "waiting" ? "followup" : "checkin", hold_reason: null, next_due: t }); return; }
  if (/^(job_|task_|project_)/.test(b.action)) {
    const j = S.jobs.find((x) => x.id === b.id), tk = S.tasks.find((x) => x.id === b.id);
    if (b.action === "job_status" && j) Object.assign(j, { status: b.status, ...(b.status === "Applied" ? { applied_date: t, next_action: "Follow up if no reply", next_action_date: addDays(t, 10) } : {}) });
    if (b.action === "job_next" && j) Object.assign(j, { next_action: b.next_action, next_action_date: b.date || null });
    if (b.action === "job_add") S.jobs.push({ id: Date.now(), firm: b.firm, role: b.role, status: b.status || "Not started", link: b.link, deadline_date: b.deadline_date || null });
    if (b.action === "task_done" && tk) Object.assign(tk, { done: true, done_at: t });
    if (b.action === "task_undo" && tk) Object.assign(tk, { done: false });
    if (b.action === "task_add") S.tasks.push({ id: Date.now(), project_id: b.project_id, title: b.title, due_date: b.date || null, done: false });
    if (b.action === "project_add") S.projects.push({ id: Date.now(), name: b.name, notes: b.notes });
    if (b.action === "project_done") S.projects = S.projects.filter((x) => x.id !== b.id);
    return;
  }
  if (b.action === "archive") { S.people = S.people.filter((x) => x.id !== b.id); }
}

// ---------- what's due ----------
const ACTIVE = ["waiting", "replied", "keep_warm", "to_contact"];
const isDue = (p) => p.next_due && p.next_due <= S.today && ACTIVE.includes(p.status);
function dueInfo(p) {
  const since = p.last_outreach ? days(p.last_outreach, S.today) : null;
  if (p.stage === "hold") return { kind: "hold", pill: "Waiting on you", why: `You wanted to ${p.hold_reason || "finish something"} before reaching out to ${first(p.name)}. Is it done?` };
  if (p.stage === "meeting") return { kind: "meeting", pill: "How did it go?", why: `You had a chat set with ${first(p.name)}${p.meeting_on ? " on " + nice(p.meeting_on) : ""}. Did it happen?` };
  if (p.stage === "close") return { kind: "close", pill: "No reply after 2 follow-ups", why: `You've followed up twice and haven't heard back. Time to let this one go, or try a different channel.` };
  if (p.stage === "schedule") return { kind: "schedule", pill: "They replied", why: `${first(p.name)} got back to you. Lock in a time while it's fresh.` };
  if (p.stage === "thanks") return { kind: "thanks", pill: "Send a thank-you", why: `You talked ${p.last_met ? "on " + nice(p.last_met) : "recently"}. A quick thank-you with one thing you'll act on goes a long way.` };
  if (p.status === "to_contact") return { kind: "reach", pill: "Reach out", why: `You planned to reach out to ${first(p.name)} today.` };
  if (p.stage === "checkin") return { kind: "checkin", pill: "Check in", why: `It's been a while. Share a quick update so ${first(p.name)} remembers you.` };
  const n = p.followups_sent || 0;
  return { kind: "followup", pill: n === 0 ? `Follow-up #1 · day ${since}` : `Last follow-up · day ${since}`, why: n === 0 ? `No reply yet ${since} days after you reached out. A short, friendly bump is normal.` : `Still no reply. One last short note, then Orbit will stop reminding you.` };
}
function draft(p, kind) {
  const f = first(p.name), ask = p.ask || "find a time to chat";
  if (kind === "followup" && !(p.followups_sent > 0)) return `Hi ${f},\n\nJust bumping this up in case it got buried. I'd still love to ${ask}. Totally understand if things are busy right now!\n\nBest,\n${SIGNATURE}`;
  if (kind === "followup") return `Hi ${f},\n\nOne last note in case the timing works better now. I'd love to ${ask}, but no worries at all if not. Thanks either way!\n\nBest,\n${SIGNATURE}`;
  if (kind === "schedule") return `Hi ${f},\n\nThanks so much for getting back to me! Here's my calendar if that's easiest: ${CALENDAR}. Happy to work around your schedule too.\n\nBest,\n${SIGNATURE}`;
  if (kind === "thanks") return `Hi ${f},\n\nThank you again for taking the time to talk. I really appreciated your advice on [one thing], and I'm going to [what you'll do]. I'll keep you posted!\n\nBest,\n${SIGNATURE}`;
  if (kind === "checkin") return `Hi ${f},\n\nHope you're doing well! Quick update from my end: [one update]. I thought of you because [reason]. Would love to hear how things are going${p.company ? " at " + p.company : ""}.\n\nBest,\n${SIGNATURE}`;
  return "";
}

const nextStep = (p) => { const m = (p.notes || "").match(/^Next step: (.*)$/m); return m ? `<div class="note">📝 ${esc(m[1])}</div>` : ""; };

// ---------- views ----------
function render() {
  document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
  document.body.classList.toggle("wide", tab === "overview" || tab === "jobs");
  S.jobs ||= []; S.projects ||= []; S.tasks ||= [];
  $("#view").innerHTML = commandBar() + (tab === "today" ? viewToday() : tab === "jobs" ? viewJobs() : tab === "projects" ? viewProjects() : tab === "waiting" ? viewWaiting() : viewOverview());
}

function viewToday() {
  const due = S.people.filter(isDue).sort((a, b) => (b.priority === "high") - (a.priority === "high") || a.next_due.localeCompare(b.next_due));
  const soon = S.people.filter((p) => p.next_due && p.next_due > S.today && p.next_due <= addDays(S.today, 7) && ACTIVE.includes(p.status)).sort((a, b) => a.next_due.localeCompare(b.next_due));
  const dateLabel = new Date(S.today + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
  let h = notifBanner();
  const nWork = dueJobs().length + dueTasks().filter((t) => t.due_date >= addDays(S.today, -3)).length;
  h += `<h1 class="title">${due.length + nWork ? `${due.length + nWork} to do today` : "You're all caught up"}</h1><p class="sub">${dateLabel}</p>`;
  if (due.length) h += `<h2>People</h2>`;
  for (const p of due) {
    const d = dueInfo(p), msg = draft(p, d.kind);
    h += `<div class="card due-card ${d.kind === "close" ? "close" : ""}">
      <div class="who"><div><div class="name">${esc(p.name)}${p.priority === "high" ? " ★" : ""}</div><div class="meta">${esc([p.role, p.company].filter(Boolean).join(", "))}</div></div>
      <span class="pill ${d.kind === "close" ? "warn" : ""}">${esc(d.pill)}</span></div>
      <div class="why">${esc(d.why)}</div>${nextStep(p)}
      ${msg ? `<details class="draft"><summary>See the draft message</summary><div class="msg" id="msg${p.id}">${esc(msg)}</div></details>` : ""}
      <div class="actions">${actionsFor(p, d.kind, !!msg)}</div></div>`;
  }
  h += todayWork();
  const wk = addDays(S.today, 7);
  const items = [
    ...soon.map((p) => ({ d: p.next_due, html: rowHTML(p, nice(p.next_due)) })),
    ...S.tasks.filter((t) => !t.done && t.due_date && t.due_date > S.today && t.due_date <= wk).map((t) => ({ d: t.due_date, html: taskRow(t, true) })),
    ...activeJobs().filter((j) => (j.next_action_date && j.next_action_date > S.today && j.next_action_date <= wk) || (j.deadline_date && j.deadline_date > S.today && j.deadline_date <= wk))
      .map((j) => ({ d: [j.next_action_date, j.deadline_date].filter((x) => x && x > S.today).sort()[0], html: jobRow(j) })),
  ].sort((a, b) => a.d.localeCompare(b.d));
  if (items.length) h += `<h2>Coming up this week</h2>` + items.map((i) => i.html).join("");
  return h;
}
function actionsFor(p, kind, hasMsg) {
  const id = p.id, b = (a, label, cls = "") => `<button class="btn small ${cls}" onclick="${a}">${label}</button>`;
  const copy = hasMsg ? b(`copyMsg(${id})`, "Copy message") : "";
  const mail = hasMsg && p.email ? b(`mailMsg(${id})`, "Open in email") : "";
  const snooze = b(`act({action:'snooze',id:${id},days:2},'Snoozed 2 days')`, "Snooze", "ghost");
  const open = b(`openPerson(${id})`, "Details", "ghost");
  if (kind === "followup") return copy + mail + b(`act({action:'followed_up',id:${id}},'Nice. Logged your follow-up.')`, "I sent it", "primary") + b(`act({action:'replied',id:${id}},'Great news!')`, "They replied") + snooze + open;
  if (kind === "close") return b(`act({action:'no_reply',id:${id}},'Closed. No more reminders.')`, "Stop reminding me", "primary") + b(`act({action:'replied',id:${id}},'Great news!')`, "They replied") + b(`act({action:'snooze',id:${id},days:14},'Okay, back in 2 weeks')`, "Try again in 2 weeks", "ghost") + open;
  if (kind === "schedule") return copy + mail + b(`act({action:'met',id:${id}},'Logged. Thank-you due tomorrow.')`, "We had the chat", "primary") + b(`act({action:'snooze',id:${id},days:3},'Snoozed 3 days')`, "Time is set, remind me later", "ghost") + open;
  if (kind === "thanks") return copy + mail + b(`act({action:'thanked',id:${id}},'Thank-you logged. Check-in in 2 months.')`, "I sent it", "primary") + snooze + open;
  if (kind === "checkin") return copy + mail + b(`act({action:'checked_in',id:${id}},'Logged. Next check-in in 2 months.')`, "I checked in", "primary") + b(`act({action:'snooze',id:${id},days:14},'Back in 2 weeks')`, "Later", "ghost") + open;
  if (kind === "hold") return b(`act({action:'hold_done',id:${id}},'Nice work! Follow-up is on today.')`, "It's done, follow up now", "primary") + b(`act({action:'snooze',id:${id},days:21},'Okay, I'll ask again in 3 weeks')`, "Not yet") + open;
  if (kind === "meeting") return b(`act({action:'met',id:${id}},'Logged. Thank-you due tomorrow.')`, "We talked", "primary") + b(`act({action:'snooze',id:${id},days:3},'Snoozed 3 days')`, "It moved", "ghost") + open;
  if (kind === "reach") return `<button class="btn small primary" onclick="openDraft(${id})">✉️ Draft email</button>` + (p.email ? "" : `<a class="btn small" href="${COLONNADE}" target="_blank">Find email ↗</a>`) + b(`act({action:'reached_out',id:${id}},'Logged. Follow-up in 3 days.')`, "I reached out") + snooze + open;
  return open;
}

function viewWaiting() {
  const w = S.people.filter((p) => p.status === "waiting" || p.status === "replied").sort((a, b) => (a.next_due || "9").localeCompare(b.next_due || "9"));
  let h = `<h1>Waiting to hear back</h1><p class="sub">Follow-up #1 on day 3 to 4, then one more a week later, then Orbit stops.</p>`;
  if (!w.length) h += `<div class="empty"><b>No one's waiting on a reply.</b>When you reach out to someone, mark it and Orbit starts the clock.</div>`;
  for (const p of w) {
    const since = p.last_outreach ? days(p.last_outreach, S.today) : 0;
    const label = p.status === "replied" ? "replied" : `day ${since} · ${p.followups_sent || 0}/2 follow-ups`;
    h += rowHTML(p, label, p.next_due ? `next ${p.next_due <= S.today ? "today" : nice(p.next_due)}` : "");
  }
  return h;
}

const STATUS = { to_contact: "To reach out", waiting: "Waiting", replied: "Replied", keep_warm: "Keep warm", no_reply: "No reply" };

// ---------- jobs ----------
const CLOSED = ["Rejected", "Closed", "Withdrawn"];
const activeJobs = () => S.jobs.filter((j) => !CLOSED.includes(j.status));
const fitOf = (j) => +((j.notes || "").match(/Fit (\d)\/5/) || [0, 0])[1];
const dueJobs = () => activeJobs().filter((j) => (j.next_action_date && j.next_action_date <= S.today) || (j.deadline_date && j.deadline_date >= S.today && j.deadline_date <= addDays(S.today, 3) && !["Applied", "Interviewing", "Offer"].includes(j.status)));
const dueTasks = () => S.tasks.filter((t) => !t.done && t.due_date && t.due_date <= S.today);
const projName = (id) => (S.projects.find((p) => p.id === id) || {}).name || "";
function jobRow(j) {
  const when = j.next_action_date ? `${j.next_action || "Next step"} · ${nice(j.next_action_date)}` : j.deadline_date ? `Deadline ${nice(j.deadline_date)}` : j.status;
  return `<div class="row" onclick="openJob(${j.id})"><div class="grow"><div class="name">💼 ${esc(j.firm)}</div><div class="meta">${esc(j.role || "")}</div></div><div class="count">${esc(when)}</div></div>`;
}
function taskRow(t, showProject) {
  const late = t.due_date && t.due_date < S.today;
  return `<div class="row task ${t.done ? "done" : ""}"><input type="checkbox" ${t.done ? "checked" : ""} onclick="event.stopPropagation();act({action:'${t.done ? "task_undo" : "task_done"}',id:${t.id}},'${t.done ? "Reopened" : "Done ✓"}')">
    <div class="grow"><div class="name">${esc(t.title)}</div>${showProject ? `<div class="meta">${esc(projName(t.project_id))}</div>` : ""}</div>
    <div class="count ${late ? "late" : ""}">${t.due_date ? (t.due_date === S.today ? "today" : nice(t.due_date)) : ""}</div></div>`;
}
function todayWork() {
  let h = "";
  const jd = dueJobs(), td = dueTasks();
  if (jd.length) {
    h += `<h2>Applications</h2>`;
    for (const j of jd) {
      const late = j.next_action_date && j.next_action_date < S.today;
      h += `<div class="card due-card"><div class="who"><div><div class="name">💼 ${esc(j.firm)}</div><div class="meta">${esc(j.role || "")}</div></div>
        <span class="pill ${late ? "warn" : ""}">${j.next_action_date ? (late ? "Overdue" : "Today") : "Deadline " + nice(j.deadline_date)}</span></div>
        <div class="why">${esc(j.next_action || (j.status === "Not started" || j.status === "Idea" ? "Apply before the deadline." : "Next step"))}</div>
        <div class="actions">${j.link ? `<a class="btn small" href="${esc(j.link)}" target="_blank">Open posting</a>` : ""}
        ${["Idea", "Not started"].includes(j.status) ? `<button class="btn small primary" onclick="act({action:'job_status',id:${j.id},status:'Applied'},'Marked applied. Follow-up in 10 days.')">I applied</button>` : `<button class="btn small primary" onclick="act({action:'job_next',id:${j.id},next_action:null,date:null},'Done ✓')">Done</button>`}
        <button class="btn small ghost" onclick="act({action:'job_next',id:${j.id},next_action:${esc(JSON.stringify(j.next_action || "Next step"))},date:addDays(S.today,3)},'Moved 3 days')">Later</button>
        <button class="btn small ghost" onclick="openJob(${j.id})">Details</button></div></div>`;
    }
  }
  const cutoff = addDays(S.today, -3);
  const recent = td.filter((t) => t.due_date >= cutoff), older = td.filter((t) => t.due_date < cutoff);
  if (recent.length) { h += `<h2>Project tasks</h2>`; h += recent.map((t) => taskRow(t, true)).join(""); }
  if (older.length) h += `<details class="catchup"><summary>Catch up: ${older.length} older ${older.length === 1 ? "task" : "tasks"} (tick off or ignore)</summary>${older.map((t) => taskRow(t, true)).join("")}</details>`;
  return h;
}
function viewJobs() {
  const q = query.toLowerCase();
  const m = (j) => !q || [j.firm, j.role, j.category, j.notes].join(" ").toLowerCase().includes(q);
  const js = S.jobs.filter(m);
  const cols = [
    { key: "due", title: "Next step due", list: js.filter((j) => dueJobs().includes(j)), meta: (j) => j.next_action_date ? nice(j.next_action_date) : "deadline " + nice(j.deadline_date) },
    { key: "applied", title: "Applied", list: js.filter((j) => j.status === "Applied"), meta: (j) => j.applied_date ? nice(j.applied_date) : "" },
    { key: "interview", title: "Interviewing", list: js.filter((j) => j.status === "Interviewing"), meta: (j) => j.next_action_date ? nice(j.next_action_date) : "" },
    { key: "offer", title: "Offers", list: js.filter((j) => j.status === "Offer"), meta: () => "" },
    { key: "todo", title: "To apply", list: js.filter((j) => j.status === "Not started"), meta: (j) => j.deadline_date ? "due " + nice(j.deadline_date) : (j.deadline || "") },
    { key: "idea", title: "Ideas (best fit first)", list: js.filter((j) => j.status === "Idea").sort((a, b) => fitOf(b) - fitOf(a)), meta: (j) => fitOf(j) ? "fit " + fitOf(j) + "/5" : "" },
  ];
  const closed = js.filter((j) => CLOSED.includes(j.status)).length;
  let h = `<div class="ov-head"><h1 class="title">Jobs</h1><span class="sub">${activeJobs().length} open · ${S.jobs.filter((j) => j.status === "Applied").length} applied</span>
    <input class="search small" placeholder="Search company or role…" value="${esc(query)}" oninput="query=this.value;const c=this.selectionStart;render();const s=$('.ov-head .search');s.focus();s.setSelectionRange(c,c)"></div><div class="board">`;
  for (const c of cols) {
    h += `<section class="col col-${c.key}"><header>${c.title}<span>${c.list.length}</span></header>${c.list.map((j) =>
      `<div class="mini" onclick="openJob(${j.id})" title="${esc([j.firm, j.role].filter(Boolean).join(" · "))}"><span class="nm">${esc(j.firm)}</span><span class="co">${esc(j.role || "")}</span><span class="mt">${esc(c.meta(j))}</span></div>`).join("") || `<div class="none">None</div>`}</section>`;
  }
  return h + `</div><p class="sub" style="margin-top:12px;font-size:13px">${closed} closed or rejected roles are hidden. Search to find one.</p>`;
}
function openJob(id) {
  const j = S.jobs.find((x) => x.id === id); if (!j) return;
  const sb = (st) => `<button class="btn small ${j.status === st ? "primary" : ""}" onclick="act({action:'job_status',id:${id},status:'${st}'},'${st}');closeSheet()">${st}</button>`;
  openSheet(`<div class="who"><div><h3>${esc(j.firm)}</h3><div class="meta">${esc(j.role || "")}${j.category ? " · " + esc(j.category) : ""}</div></div><span class="pill gray">${esc(j.status)}</span></div>
    <div class="actions" style="margin:12px 0">${j.link ? `<a class="btn small primary" href="${esc(j.link)}" target="_blank">Open posting ↗</a>` : ""}</div>
    <div class="field"><label>Status</label><div class="actions">${["Idea", "Not started", "Applied", "Interviewing", "Offer", "Rejected", "Closed"].map(sb).join("")}</div></div>
    <div class="field"><label>Next step</label><div style="display:flex;gap:8px"><input id="j_na" value="${esc(j.next_action || "")}" placeholder="e.g. Ask Lucy for a referral"><input id="j_nad" type="date" value="${j.next_action_date || ""}" style="max-width:160px"></div></div>
    <div class="two"><div class="field"><label>Deadline</label><input id="j_dl" type="date" value="${j.deadline_date || ""}"></div><div class="field"><label>Posting link</label><input id="j_link" value="${esc(j.link || "")}"></div></div>
    <div class="field"><label>Notes</label><textarea id="j_notes">${esc(j.notes || "")}</textarea></div>
    <div class="actions"><button class="btn primary" onclick="saveJob(${id})">Save</button><button class="btn ghost" onclick="closeSheet()">Close</button></div>`);
}
async function saveJob(id) {
  await act({ action: "job_edit", id, link: $("#j_link").value, deadline_date: $("#j_dl").value, notes: $("#j_notes").value });
  await act({ action: "job_next", id, next_action: $("#j_na").value, date: $("#j_nad").value }, "Saved");
  closeSheet();
}
function openAddJob() {
  openSheet(`<h3>Add a job</h3><div class="two"><div class="field"><label>Company</label><input id="aj_firm"></div><div class="field"><label>Role</label><input id="aj_role"></div></div>
    <div class="field"><label>Posting link</label><input id="aj_link"></div>
    <div class="two"><div class="field"><label>Status</label><select id="aj_st"><option>Not started</option><option>Applied</option><option>Idea</option></select></div><div class="field"><label>Deadline</label><input id="aj_dl" type="date"></div></div>
    <div class="actions"><button class="btn primary" onclick="act({action:'job_add',firm:$('#aj_firm').value,role:$('#aj_role').value,link:$('#aj_link').value,status:$('#aj_st').value,deadline_date:$('#aj_dl').value},'Job added');closeSheet()">Add</button><button class="btn ghost" onclick="closeSheet()">Cancel</button></div>`);
  setTimeout(() => $("#aj_firm").focus(), 50);
}

// ---------- projects ----------
function viewProjects() {
  let h = `<h1 class="title">Projects</h1><p class="sub">${S.projects.length} active · tick tasks off as you go</p>`;
  for (const p of S.projects) {
    const ts = S.tasks.filter((t) => t.project_id === p.id);
    const open = ts.filter((t) => !t.done), done = ts.filter((t) => t.done);
    h += `<div class="card proj"><div class="who"><div><div class="name">${esc(p.name)}</div>${p.notes ? `<div class="meta">${esc(p.notes.length > 160 ? p.notes.slice(0, 160) + "…" : p.notes)}</div>` : ""}</div>
      <span class="pill gray">${open.length} open</span></div>
      ${open.map((t) => taskRow(t)).join("")}
      ${done.length ? `<details><summary class="sub" style="margin:6px 0;cursor:pointer;font-size:13px">${done.length} done recently</summary>${done.map((t) => taskRow(t)).join("")}</details>` : ""}
      <div class="addtask"><input id="nt${p.id}" placeholder="Add a task…" onkeydown="if(event.key==='Enter')addTask(${p.id})"><input id="nd${p.id}" type="date"><button class="btn small" onclick="addTask(${p.id})">Add</button></div>
      <div class="actions" style="margin-top:6px">${p.link ? `<a class="btn small ghost" href="${esc(p.link)}" target="_blank">Open link ↗</a>` : ""}<button class="btn small ghost" onclick="if(confirm('Mark this project finished?'))act({action:'project_done',id:${p.id}},'Project finished 🎉')">Finish project</button></div></div>`;
  }
  return h || `<div class="empty"><b>No projects yet.</b>Tap + Add to start one.</div>`;
}
function addTask(pid) { const t = $("#nt" + pid).value.trim(); if (!t) return; act({ action: "task_add", project_id: pid, title: t, date: $("#nd" + pid).value }, "Task added"); }
function openAddProject() {
  openSheet(`<h3>New project</h3><div class="field"><label>Name</label><input id="ap_name"></div><div class="field"><label>Notes</label><textarea id="ap_notes"></textarea></div>
    <div class="actions"><button class="btn primary" onclick="act({action:'project_add',name:$('#ap_name').value,notes:$('#ap_notes').value},'Project added');closeSheet()">Add</button><button class="btn ghost" onclick="closeSheet()">Cancel</button></div>`);
  setTimeout(() => $("#ap_name").focus(), 50);
}

// ---------- command bar ----------
let lastResult = null;
function commandBar() {
  return `<form class="cmd" onsubmit="runCommand(event)">
    <textarea id="cmdText" rows="1" placeholder="Tell Orbit what happened… (people, jobs or projects)" oninput="this.style.height='auto';this.style.height=this.scrollHeight+'px'" onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();runCommand(event)}"></textarea>
    <button class="btn primary" id="cmdBtn">Do it</button></form>
    ${!lastResult ? `<div class="hint">Try: “Ivan replied, coffee Wednesday” · “Applied to Microsoft FRP” · “Add a task to Edition 2: email Walkabout by Friday”</div>` : ""}
    ${lastResult ? `<div class="result ${lastResult.ok ? "" : "warn"}"><span>${esc(lastResult.text)}</span><button class="x" onclick="lastResult=null;render()">×</button></div>` : ""}`;
}
async function runCommand(e) {
  e.preventDefault();
  const text = $("#cmdText").value.trim(); if (!text) return;
  if (DEMO) { lastResult = { ok: false, text: "Typing commands works in your real Orbit. In the demo, use the buttons." }; return render(); }
  const btn = $("#cmdBtn"); btn.disabled = true; btn.textContent = "Working…";
  try {
    const r = await fetch("/api/command", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
    const j = await r.json();
    if (!r.ok) { lastResult = { ok: false, text: j.error || "Something went wrong" }; return render(); }
    if (j.people) { S.people = j.people; S.log = j.log; S.today = j.today; }
    if (j.plan?.question) lastResult = { ok: false, text: j.plan.question };
    else lastResult = { ok: !(j.errors || []).length, text: (j.plan?.reply || "Done.") + ((j.errors || []).length ? " (Some steps failed: " + j.errors.join("; ") + ")" : "") };
    render();
    if (j.plan?.question) { $("#cmdText").value = text + " "; $("#cmdText").focus(); }
  } catch { lastResult = { ok: false, text: "Couldn't reach Orbit. Check your connection." }; render(); }
}

// ---------- overview board ----------
function viewOverview() {
  const q = query.toLowerCase();
  const match = (p) => !q || [p.name, p.company, p.role, p.context, p.notes, p.hold_reason].join(" ").toLowerCase().includes(q);
  const ppl = S.people.filter(match);
  const since = (p) => p.last_outreach ? days(p.last_outreach, S.today) : null;
  const cols = [
    { key: "due", title: "Due today", list: ppl.filter(isDue), meta: (p) => dueInfo(p).pill },
    { key: "them", title: "Waiting on them", list: ppl.filter((p) => p.status === "waiting" && p.stage !== "hold" && !isDue(p)), meta: (p) => `day ${since(p) ?? "?"} · ${p.followups_sent || 0}/2` },
    { key: "you", title: "Waiting on you", list: ppl.filter((p) => p.stage === "hold" && !isDue(p)), meta: (p) => p.hold_reason || "" },
    { key: "replied", title: "Replied / chat set", list: ppl.filter((p) => p.status === "replied" && !isDue(p)), meta: (p) => p.meeting_on ? "chat " + nice(p.meeting_on) : "replied" },
    { key: "reach", title: "To reach out", list: ppl.filter((p) => p.status === "to_contact" && p.stage !== "hold" && !isDue(p)), meta: (p) => p.next_due ? nice(p.next_due) : "" },
    { key: "warm", title: "Keep warm", list: ppl.filter((p) => p.status === "keep_warm" && p.stage !== "hold" && !isDue(p)), meta: (p) => p.next_due ? "next " + nice(p.next_due) : "" },
    { key: "noreply", title: "No reply", list: ppl.filter((p) => p.status === "no_reply"), meta: () => "" },
  ];
  const sortBy = { due: (a, b) => (a.next_due || "").localeCompare(b.next_due || ""), them: (a, b) => (a.last_outreach || "").localeCompare(b.last_outreach || "") };
  let h = `<div class="ov-head"><h1 class="title">Overview</h1><span class="sub">${S.people.length} people</span>
    <input class="search small" placeholder="Search…" value="${esc(query)}" oninput="query=this.value;const c=this.selectionStart;render();const s=$('.ov-head .search');s.focus();s.setSelectionRange(c,c)"></div><div class="board">`;
  for (const c of cols) {
    const list = c.list.slice().sort(sortBy[c.key] || ((a, b) => a.name.localeCompare(b.name)));
    h += `<section class="col col-${c.key}"><header>${c.title}<span>${list.length}</span></header>${list.map((p) =>
      `<div class="mini" onclick="openPerson(${p.id})" title="${esc([p.name, p.role, p.company].filter(Boolean).join(" · "))}"><span class="nm">${esc(p.name)}${p.priority === "high" ? " ★" : ""}</span><span class="co">${esc(p.company || p.context || "")}</span><span class="mt">${esc(c.meta(p))}</span></div>`).join("") || `<div class="none">None</div>`}</section>`;
  }
  return h + `</div>`;
}
function viewPeople() {
  let list = S.people.filter((p) => filter === "all" || p.status === filter);
  if (query) { const q = query.toLowerCase(); list = list.filter((p) => [p.name, p.company, p.role, p.context, p.notes].join(" ").toLowerCase().includes(q)); }
  let h = `<h1>People</h1><p class="sub">${S.people.length} people</p>
    <input class="search" placeholder="Search name, company, how you met" value="${esc(query)}" oninput="query=this.value;rerenderList()">
    <div class="filters">${["all", ...Object.keys(STATUS)].map((k) => `<button class="${filter === k ? "on" : ""}" onclick="filter='${k}';render()">${k === "all" ? "All" : STATUS[k]} (${k === "all" ? S.people.length : S.people.filter((p) => p.status === k).length})</button>`).join("")}</div>
    <div id="plist">${listHTML(list)}</div>`;
  return h;
}
function listHTML(list) { return list.length ? list.map((p) => rowHTML(p, STATUS[p.status] || p.status)).join("") : `<div class="empty">No matches.</div>`; }
function rerenderList() {
  let list = S.people.filter((p) => filter === "all" || p.status === filter);
  const q = query.toLowerCase(); if (q) list = list.filter((p) => [p.name, p.company, p.role, p.context, p.notes].join(" ").toLowerCase().includes(q));
  $("#plist").innerHTML = listHTML(list);
}
function rowHTML(p, right, right2 = "") {
  return `<div class="row" onclick="openPerson(${p.id})"><div class="grow"><div class="name">${esc(p.name)}${p.priority === "high" ? " ★" : ""}</div>
    <div class="meta">${esc([p.role, p.company].filter(Boolean).join(", ") || p.context || "")}</div></div>
    <div class="count">${esc(right)}${right2 ? `<br><span style="font-weight:500">${esc(right2)}</span>` : ""}</div></div>`;
}

// ---------- person sheet ----------
function openSheet(html) { $("#sheetCard").innerHTML = html; $("#sheet").classList.remove("hidden"); }
function closeSheet() { $("#sheet").classList.add("hidden"); }
$("#sheet").addEventListener("click", (e) => { if (e.target.id === "sheet") closeSheet(); });

function openPerson(id) {
  const p = S.people.find((x) => x.id === id); if (!p) return;
  const log = S.log.filter((l) => l.person_id === id);
  const b = (a, label, cls = "") => `<button class="btn small ${cls}" onclick="${a};closeSheet()">${label}</button>`;
  openSheet(`
    <div class="who"><div><h3>${esc(p.name)}</h3><div class="meta">${esc([p.role, p.company].filter(Boolean).join(", "))}</div></div><span class="pill gray">${esc(STATUS[p.status] || p.status)}</span></div>
    <div class="links" style="margin:10px 0 14px">${p.email ? `<a href="mailto:${esc(p.email)}">Email</a>` : `<a href="${COLONNADE}" target="_blank">Find email on Colonnade ↗</a>`}${!p.linkedin ? `<a href="${liSearch(p)}" target="_blank">Find on LinkedIn ↗</a>` : ""}${p.linkedin ? `<a href="${esc(p.linkedin)}" target="_blank">LinkedIn</a>` : ""}${p.phone ? `<a href="tel:${esc(p.phone)}">Call</a>` : ""}</div>
    <div class="actions" style="margin-bottom:16px">
      <button class="btn small primary" onclick="openDraft(${id})">✉️ Draft email</button>
      ${b(`act({action:'reached_out',id:${id}},'Logged. Follow-up in 3 days.')`, "I reached out")}
      ${p.status === "waiting" ? b(`act({action:'followed_up',id:${id}},'Follow-up logged')`, "I followed up") : ""}
      ${b(`act({action:'replied',id:${id}},'Great news!')`, "They replied")}
      ${b(`act({action:'met',id:${id}},'Logged. Thank-you due tomorrow.')`, "We talked")}
    </div>
    <div class="field"><label>Remind me on</label><div style="display:flex;gap:8px"><input type="date" id="remindDate" value="${p.next_due || addDays(S.today, 14)}"><button class="btn small" onclick="act({action:'remind_on',id:${id},date:$('#remindDate').value},'Reminder set');closeSheet()">Set</button></div></div>
    ${formHTML(p)}
    <div class="actions"><button class="btn primary" onclick="saveEdit(${id})">Save</button><button class="btn ghost" onclick="closeSheet()">Close</button>
      <button class="btn ghost danger" style="margin-left:auto" onclick="if(confirm('Remove ${esc(p.name.replace(/['"]/g, ""))} from Orbit?')){act({action:'archive',id:${id}},'Removed');closeSheet()}">Remove</button></div>
    ${log.length ? `<h2>History</h2><div class="timeline">${log.map((l) => `<div>${esc(l.text)}<span>${new Date(l.at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span></div>`).join("")}</div>` : ""}
  `);
}
function formHTML(p = {}) {
  const f = (k, label, type = "text", ph = "") => `<div class="field"><label>${label}</label><input id="f_${k}" type="${type}" value="${esc(p[k] || "")}" placeholder="${ph}"></div>`;
  return `<div class="two">${f("name", "Name")}${f("company", "Company")}</div>
    <div class="two">${f("role", "Role")}${f("context", "How you know them", "text", "e.g. GHS alum, met at E-Summit")}</div>
    ${f("ask", "What you're asking for", "text", "e.g. grab coffee over Thanksgiving")}
    <div class="two">${f("email", "Email", "email")}${f("linkedin", "LinkedIn URL", "url")}</div>
    <div class="two">${f("phone", "Phone", "tel")}<div class="field"><label>Priority</label><select id="f_priority"><option value="normal">Normal</option><option value="high" ${p.priority === "high" ? "selected" : ""}>High ★</option></select></div></div>
    <div class="field"><label>Notes</label><textarea id="f_notes">${esc(p.notes || "")}</textarea></div>`;
}
const FORM_KEYS = ["name", "company", "role", "context", "ask", "email", "linkedin", "phone", "priority", "notes"];
const readForm = () => Object.fromEntries(FORM_KEYS.map((k) => [k, $("#f_" + k).value]));
function saveEdit(id) { act({ action: "edit", id, ...readForm() }, "Saved"); closeSheet(); }

function openAdd() {
  openSheet(`<h3>Add someone</h3><p class="sub" style="margin-bottom:12px">Orbit will remind you to follow up 3 days after you reach out.</p>
    ${formHTML({})}
    <label class="check"><input type="checkbox" id="f_reached" checked> I already reached out on <input type="date" id="f_date" value="${S.today}" style="margin-left:6px;padding:4px 6px;border:1px solid var(--line);border-radius:8px"></label>
    <div class="actions"><button class="btn primary" onclick="saveAdd()">Add</button><button class="btn ghost" onclick="closeSheet()">Cancel</button></div>`);
  setTimeout(() => $("#f_name").focus(), 50);
}
function saveAdd() {
  const f = readForm(); if (!f.name.trim()) return toast("Add a name first");
  act({ action: "add", ...f, reachedOut: $("#f_reached").checked, date: $("#f_date").value }, $("#f_reached").checked ? "Added. Follow-up in 3 days." : "Added");
  closeSheet();
}

// ---------- outreach draft (with resume) ----------
async function openDraft(id, extra = "") {
  const p = S.people.find((x) => x.id === id); if (!p) return;
  if (DEMO) return toast("Drafting works in your real Orbit");
  openSheet(`<h3>Email to ${esc(p.name)}</h3><p class="sub">Writing a draft…</p>`);
  const r = await fetch("/api/draft", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, extra }) });
  const j = await r.json();
  if (!r.ok) { openSheet(`<h3>Email to ${esc(p.name)}</h3><p class="err">${esc(j.error || "Something went wrong")}</p>`); return; }
  openSheet(`<h3>Email to ${esc(p.name)}</h3><p class="sub" style="margin-bottom:10px">Your resume gets attached, and your LinkedIn is in the email.</p>
    <div class="field"><label>To</label><div style="display:flex;gap:8px"><input id="d_to" type="email" value="${esc(p.email || "")}" placeholder="Paste their email">
      ${p.email ? "" : `<a class="btn small" href="${COLONNADE}" target="_blank" style="white-space:nowrap;align-self:center">Colonnade ↗</a>`}</div></div>
    <div class="field"><label>Subject</label><input id="d_subject" value="${esc(j.subject)}"></div>
    <div class="field"><label>Message</label><textarea id="d_body" style="min-height:260px">${esc(j.body)}</textarea></div>
    <div class="actions">
      <button class="btn primary" onclick="downloadDraft(${id})">Open as email with resume</button>
      <button class="btn" onclick="navigator.clipboard.writeText($('#d_body').value);toast('Copied')">Copy text</button>
      <button class="btn ghost" onclick="act({action:'reached_out',id:${id}},'Logged. Follow-up in 3 days.');closeSheet()">I sent it</button>
    </div>
    <div class="field" style="margin-top:14px"><label>Want a different version?</label><div style="display:flex;gap:8px"><input id="d_extra" placeholder="e.g. shorter, mention we met at E-Summit"><button class="btn small" onclick="openDraft(${id}, $('#d_extra').value)">Rewrite</button></div></div>
    <p class="sub" style="font-size:13px;margin-top:12px">On a laptop, the downloaded file opens in Mail as a ready-to-send draft with your resume attached. On iPhone, use Copy text and attach your resume from Files.</p>`);
}
async function downloadDraft(id) {
  const body = { id, mode: "eml", to: $("#d_to").value, subject: $("#d_subject").value, body: $("#d_body").value };
  const r = await fetch("/api/draft", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) { const j = await r.json().catch(() => ({})); return toast(j.error || "Couldn't make the email"); }
  const blob = await r.blob(), a = document.createElement("a");
  const p = S.people.find((x) => x.id === id);
  a.href = URL.createObjectURL(blob); a.download = `Email to ${p.name}.eml`; document.body.appendChild(a); a.click(); a.remove();
  if (body.to && !p.email) p.email = body.to;
  toast("Downloaded. Open it to send from Mail.");
}

// ---------- copy / email ----------
function copyMsg(id) { navigator.clipboard.writeText($("#msg" + id).textContent); toast("Copied"); }
function mailMsg(id) {
  const p = S.people.find((x) => x.id === id);
  location.href = `mailto:${encodeURIComponent(p.email)}?subject=${encodeURIComponent("Following up")}&body=${encodeURIComponent($("#msg" + id).textContent)}`;
}

// ---------- notifications ----------
const isIOS = /iPhone|iPad/.test(navigator.userAgent);
const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
function notifBanner() {
  if (DEMO || !("serviceWorker" in navigator)) return "";
  if (localStorage.nudgeNotifs === "on" && Notification.permission === "granted") return "";
  if (isIOS && !standalone) return `<div class="banner"><span>Want phone reminders? Tap <b>Share</b> → <b>Add to Home Screen</b>, then open Orbit from your home screen.</span></div>`;
  if (!("PushManager" in window)) return "";
  return `<div class="banner"><span>Get a phone notification when it's time to follow up.</span><button class="btn small primary" onclick="enableNotifs()">Turn on</button></div>`;
}
async function enableNotifs() {
  try {
    const perm = await Notification.requestPermission(); if (perm !== "granted") return toast("Notifications are blocked in settings");
    const reg = await navigator.serviceWorker.ready;
    const { key } = await (await fetch("/api/push")).json();
    const pad = "=".repeat((4 - (key.length % 4)) % 4), raw = atob((key + pad).replace(/-/g, "+").replace(/_/g, "/"));
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: Uint8Array.from(raw, (c) => c.charCodeAt(0)) });
    await fetch("/api/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sub, test: true }) });
    localStorage.nudgeNotifs = "on"; toast("Notifications on"); render();
  } catch (e) { toast("Couldn't turn on notifications"); }
}

// ---------- boot ----------
function showLogin() { $("#login").classList.remove("hidden"); $("#app").classList.add("hidden"); }
function showApp() { $("#login").classList.add("hidden"); $("#app").classList.remove("hidden"); $("#demoBar").classList.toggle("hidden", !DEMO); render(); }
$("#loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const r = await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: $("#pw").value }) });
  if (r.ok) load(); else $("#loginErr").textContent = "That password didn't work.";
});
document.querySelectorAll("#tabs button").forEach((b) => (b.onclick = () => { tab = b.dataset.tab; render(); scrollTo(0, 0); }));
$("#addBtn").onclick = () => (tab === "jobs" ? openAddJob() : tab === "projects" ? openAddProject() : openAdd());
if ("serviceWorker" in navigator && !DEMO) navigator.serviceWorker.register("/sw.js");
load();
if (location.hash.length > 1) { tab = ({ "#ov": "overview", "#jobs": "jobs", "#projects": "projects" })[location.hash] || tab; setTimeout(render, 50); }
