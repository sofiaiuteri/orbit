// Outreach emails. mode "write": Claude drafts subject + body for one person.
// mode "eml": returns a ready-to-send email draft (.eml) with the resume attached; opens in Mail as a draft.
import Anthropic from "@anthropic-ai/sdk";
import { sql, isAuthed, unauthorized, readBody, logEvent } from "./_lib.js";

const client = new Anthropic();
// Public info about the sender (all of this is on her website).
export const ME = {
  name: "Sofia Iuteri",
  email: "siuteri@mail.wlu.edu",
  linkedin: "https://www.linkedin.com/in/sofia-iuteri",
  site: "https://sofiaiuteri.com",
  resumeUrl: process.env.RESUME_URL || "https://sofiaiuteri.com/sofia-iuteri-resume-2026-11.pdf",
  about: "Senior (Class of 2027) at Washington and Lee University studying Economics and Environmental Studies with a minor in Entrepreneurship. Founder and editor-in-chief of The Experience Exchange, a student environmental magazine with a 40-person team. Founder of SponsorFlow, an AI sponsorship tool she built. Interned in FP&A at Synchrony and in venture capital at Hoxton Ventures (London). Teaching assistant for Intermediate Microeconomics. Building with AI, interested in roles that mix AI, startups and business, and planning to move to California after graduation.",
};

const SCHEMA = {
  type: "object", additionalProperties: false, required: ["subject", "body"],
  properties: { subject: { type: "string" }, body: { type: "string" } },
};

const EXAMPLE = `Hi Lucy,

I hope you're doing well!

I'm Sofia Iuteri, a senior at Washington and Lee University, majoring in Economics and Environmental Studies with a minor in Entrepreneurship. I came across your background at Palantir on LinkedIn and was particularly interested in your work in operations.

I've spent much of college building my own ventures, including SponsorFlow, an AI-powered sponsorship tool, and have previously interned in FP&A at Synchrony and venture capital at Hoxton Ventures in London. Recently, I've become increasingly interested in the intersection of AI, business strategy, and operations, which has drawn me toward opportunities at Palantir.

Given your experience, I'd appreciate the opportunity to hear about your path to Palantir, the types of projects you've worked on, and your perspective on the team and culture. I'm particularly interested in how Palantir combines technical innovation with solving real-world business problems.

Would you have 15–20 minutes to chat sometime in the next couple of weeks? I'd be happy to work around your schedule.

I've attached my resume for some background and included my [LinkedIn](${ME.linkedin}) for additional context.

Thank you, and I look forward to hopefully connecting soon.

Best,
Sofia Iuteri
${ME.site}`;

const SYSTEM = `You write networking emails for ${ME.name}. About her: ${ME.about}

Write a first outreach email that follows Sofia's own template below exactly in structure, tone and length. Keep these paragraphs in this order:
1. "Hi [first name]," then "I hope you're doing well!"
2. Who she is (the same intro sentence as the template), then how she found them and what specifically interested her about their work (use how they're connected and the notes; if you know little, keep it general, e.g. "your background at [company]").
3. Her background in one or two sentences (ventures, SponsorFlow, internships), then why she's drawn to their company or field. Pick the parts of her background most relevant to this person.
4. What she'd like to hear about (their path, projects, team and culture) and one specific angle about their company or role.
5. "Would you have 15–20 minutes to chat sometime in the next couple of weeks? I'd be happy to work around your schedule." If the notes say they're nearby or it's a fellow alum she can meet in person, offer coffee instead.
6. The resume + LinkedIn line exactly as in the template, keeping the [LinkedIn](url) link format.
7. "Thank you, and I look forward to hopefully connecting soon." then the exact sign-off.

Rules: don't invent facts about the recipient; no em dashes; adapt the content, not the structure. Subject: under 8 words, specific (e.g. "W&L senior interested in Palantir").

Sofia's template (an email she wrote to someone at Palantir):
${EXAMPLE}`;

const escHtml = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function toHtml(body) {
  const linked = escHtml(body)
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2">$1</a>')
    .replace(/(^|[\s])(https?:\/\/[^\s<]+)/g, '$1<a href="$2">$2</a>');
  return `<div style="font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5">${linked.split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`).join("")}</div>`;
}
const toPlain = (body) => body.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, "$1 ($2)");

function eml({ to, subject, body, pdf }) {
  const boundary = "orbit-" + Math.random().toString(36).slice(2);
  const alt = boundary + "-alt";
  const b64 = (buf) => buf.toString("base64").replace(/.{76}/g, "$&\r\n");
  const subj = /^[\x20-\x7e]*$/.test(subject) ? subject : `=?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`;
  return [
    `From: ${ME.name} <${ME.email}>`, `To: ${to || ""}`, `Subject: ${subj}`, "X-Unsent: 1", "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`, "",
    `--${boundary}`, `Content-Type: multipart/alternative; boundary="${alt}"`, "",
    `--${alt}`, 'Content-Type: text/plain; charset="utf-8"', "Content-Transfer-Encoding: base64", "", b64(Buffer.from(toPlain(body), "utf8")), "",
    `--${alt}`, 'Content-Type: text/html; charset="utf-8"', "Content-Transfer-Encoding: base64", "", b64(Buffer.from(toHtml(body), "utf8")), "",
    `--${alt}--`, "",
    `--${boundary}`, 'Content-Type: application/pdf; name="Sofia Iuteri Resume.pdf"', "Content-Transfer-Encoding: base64",
    'Content-Disposition: attachment; filename="Sofia Iuteri Resume.pdf"', "", b64(pdf), "", `--${boundary}--`, "",
  ].join("\r\n");
}

export async function POST(req) {
  if (!isAuthed(req)) return unauthorized();
  const b = await readBody(req);
  const [p] = await sql`SELECT * FROM nudge.people WHERE id = ${Number(b.id) || 0}`;
  if (!p) return Response.json({ error: "Person not found" }, { status: 404 });

  if (b.mode === "eml") {
    const to = (b.to || p.email || "").trim();
    if (to && !p.email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) await sql`UPDATE nudge.people SET email=${to}, updated_at=now() WHERE id=${p.id}`;
    const r = await fetch(ME.resumeUrl);
    if (!r.ok) return Response.json({ error: "Couldn't load your resume from your website." }, { status: 502 });
    const pdf = Buffer.from(await r.arrayBuffer());
    await logEvent(p.id, "draft", "Drafted an outreach email with resume attached.");
    const name = `Email to ${p.name}`.replace(/[^\w .-]/g, "");
    return new Response(eml({ to, subject: b.subject || "", body: b.body || "", pdf }), {
      headers: { "Content-Type": "message/rfc822", "Content-Disposition": `attachment; filename="${name}.eml"` },
    });
  }

  const recent = await sql`SELECT kind, text, at::date::text AS d FROM nudge.log WHERE person_id = ${p.id} AND kind <> 'import' ORDER BY at DESC LIMIT 8`;
  const info = [
    `Name: ${p.name}`, p.role && `Role: ${p.role}`, p.company && `Company: ${p.company}`, p.context && `How she knows them: ${p.context}`,
    p.ask && `What she wants to ask for: ${p.ask}`, p.notes && `Notes: ${p.notes}`,
    recent.length && `History: ${recent.map((l) => `${l.d} ${l.text}`).join("; ")}`,
    b.extra && `Extra from Sofia: ${String(b.extra).slice(0, 500)}`,
  ].filter(Boolean).join("\n");

  const request = {
    model: "claude-opus-5-5", max_tokens: 2000, system: SYSTEM,
    output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
    messages: [{ role: "user", content: info }],
  };
  let msg;
  try { msg = await client.beta.messages.create({ ...request, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" }); }
  catch (e) {
    if (e instanceof Anthropic.BadRequestError) msg = await client.messages.create(request);
    else return Response.json({ error: "Couldn't reach Claude. Try again." }, { status: 502 });
  }
  if (msg.stop_reason === "refusal") return Response.json({ error: "Couldn't draft this one." }, { status: 400 });
  try { return Response.json(JSON.parse(msg.content.find((c) => c.type === "text")?.text || "")); }
  catch { return Response.json({ error: "Draft failed. Try again." }, { status: 500 }); }
}
