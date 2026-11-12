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
  document.body.classList.toggle("wide", tab === "overview");
  $("#view").innerHTML = commandBar() + (tab === "today" ? viewToday() : tab === "waiting" ? viewWaiting() : viewOverview());
}

function viewToday() {
  const due = S.people.filter(isDue).sort((a, b) => (b.priority === "high") - (a.priority === "high") || a.next_due.localeCompare(b.next_due));
  const soon = S.people.filter((p) => p.next_due && p.next_due > S.today && p.next_due <= addDays(S.today, 7) && ACTIVE.includes(p.status)).sort((a, b) => a.next_due.localeCompare(b.next_due));
  const dateLabel = new Date(S.today + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
  let h = notifBanner();
  h += `<h1 class="title">${due.length ? `${due.length} to do today` : "You're all caught up"}</h1><p class="sub">${dateLabel}</p>`;
  if (!due.length) h += `<div class="empty"><b>Nothing due.</b>Add someone you want to meet, or check who's coming up.</div>`;
  for (const p of due) {
    const d = dueInfo(p), msg = draft(p, d.kind);
    h += `<div class="card due-card ${d.kind === "close" ? "close" : ""}">
      <div class="who"><div><div class="name">${esc(p.name)}${p.priority === "high" ? " ★" : ""}</div><div class="meta">${esc([p.role, p.company].filter(Boolean).join(", "))}</div></div>
      <span class="pill ${d.kind === "close" ? "warn" : ""}">${esc(d.pill)}</span></div>
      <div class="why">${esc(d.why)}</div>${nextStep(p)}
      ${msg ? `<details class="draft"><summary>See the draft message</summary><div class="msg" id="msg${p.id}">${esc(msg)}</div></details>` : ""}
      <div class="actions">${actionsFor(p, d.kind, !!msg)}</div></div>`;
  }
  if (soon.length) {
    h += `<h2>Coming up this week</h2>`;
    for (const p of soon) h += rowHTML(p, `${nice(p.next_due)}`);
  }
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

// ---------- command bar ----------
let lastResult = null;
function commandBar() {
  return `<form class="cmd" onsubmit="runCommand(event)">
    <textarea id="cmdText" rows="1" placeholder="Tell Orbit what happened…" oninput="this.style.height='auto';this.style.height=this.scrollHeight+'px'" onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();runCommand(event)}"></textarea>
    <button class="btn primary" id="cmdBtn">Do it</button></form>
    ${!lastResult ? `<div class="hint">Try: “Ted Elliott: follow up once I finish the AI certification” or “Ivan replied, coffee next Wednesday”</div>` : ""}
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
$("#addBtn").onclick = openAdd;
if ("serviceWorker" in navigator && !DEMO) navigator.serviceWorker.register("/sw.js");
load();
if (location.hash === "#ov") { tab = "overview"; setTimeout(render, 50); }
