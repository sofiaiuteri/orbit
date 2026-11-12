// Made-up people for the public demo (/?demo=1). No real contacts live in this repo.
window.NUDGE_DEMO = (() => {
  const t = new Date();
  const d = (n) => { const x = new Date(t); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
  const people = [
    { id: 1, name: "Maya Chen", company: "Lumen Health (YC W25)", role: "Co-founder & CEO", context: "High school alum", email: "maya@example.com", ask: "hear how you got into YC", status: "waiting", last_outreach: d(-4), followups_sent: 0, next_due: d(-1), stage: "followup", priority: "high" },
    { id: 2, name: "Jordan Ellis", company: "Northwind Capital", role: "Associate", context: "Met at career fair", email: "jordan@example.com", ask: "grab a quick call about your path into VC", status: "waiting", last_outreach: d(-7), followups_sent: 1, next_due: d(0), stage: "followup", priority: "normal" },
    { id: 3, name: "Priya Rao", company: "Atlas Robotics", role: "Product Manager", context: "Alumni directory", email: "priya@example.com", ask: "chat about product roles", status: "replied", last_outreach: d(-5), followups_sent: 0, next_due: d(0), stage: "schedule", priority: "normal" },
    { id: 4, name: "Sam Ortiz", company: "Brightline Media", role: "Founder", context: "Podcast guest", email: "sam@example.com", ask: "", status: "keep_warm", last_met: d(-1), next_due: d(0), stage: "thanks", priority: "normal" },
    { id: 5, name: "Lena Fischer", company: "Greenfield Energy", role: "Analyst", context: "Friend of a friend", email: "lena@example.com", ask: "hear about climate finance", status: "waiting", last_outreach: d(-1), followups_sent: 0, next_due: d(2), stage: "followup", priority: "normal" },
    { id: 6, name: "Chris Park", company: "Orbit Labs", role: "Engineer", context: "Hackathon teammate", email: "", ask: "", status: "to_contact", next_due: null, stage: null, priority: "normal" },
    { id: 8, name: "Ted Alvarez", company: "Copado", role: "Recruiter", context: "Spoke at club event", email: "ted@example.com", ask: "", status: "keep_warm", next_due: d(12), stage: "hold", hold_reason: "finish the AI certification", priority: "normal" },
    { id: 9, name: "Nora Patel", company: "Seaside Ventures", role: "Partner", context: "Alumni", email: "nora@example.com", ask: "", status: "replied", next_due: d(5), stage: "meeting", meeting_on: d(4), priority: "high" },
    { id: 7, name: "Dana Brooks", company: "Harbor Partners", role: "VP", context: "Alumni panel", email: "dana@example.com", ask: "", status: "no_reply", last_outreach: d(-20), followups_sent: 2, next_due: null, stage: null, priority: "normal" },
  ];
  const log = [
    { person_id: 1, at: d(-4) + "T15:00:00Z", kind: "outreach", text: "Reached out by email." },
    { person_id: 2, at: d(-7) + "T15:00:00Z", kind: "followup", text: "Sent follow-up #1." },
    { person_id: 3, at: d(-1) + "T15:00:00Z", kind: "replied", text: "They replied." },
    { person_id: 4, at: d(-1) + "T15:00:00Z", kind: "met", text: "Had the chat." },
  ];
  return { people, log, today: d(0), rules: { first: 3, second: 7, closeAfter: 7, maxFollowups: 2, thanks: 1, checkin: 60 } };
})();
