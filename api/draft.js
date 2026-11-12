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

const SYSTEM = `You write short networking emails for ${ME.name}. About her: ${ME.about}

Write a first outreach email to the person described. Rules:
- 90 to 140 words in the body. Warm, specific and human, like a real student wrote it. No buzzwords, no flattery, and no em dashes (use commas or periods).
- Open with "Hi [first name]," then one line on who she is and why she's writing to this person specifically (use how they're connected and the notes).
- One clear ask: a 15 to 20 minute call (or coffee if the notes say they're nearby), with flexibility on timing.
- Mention that her resume is attached and include her LinkedIn as a link on its own line before the sign-off: "LinkedIn: ${ME.linkedin}"
- Sign off exactly: "Best,\\n${ME.name}\\n${ME.site}"
- Subject: under 8 words, specific (mention the shared connection when there is one, e.g. "W&L student, quick question about Palantir").
- Don't invent facts about the recipient. If you know little, keep it simple.`;

function eml({ to, subject, body, pdf }) {
  const boundary = "orbit-" + Math.random().toString(36).slice(2);
  const b64 = (buf) => buf.toString("base64").replace(/.{76}/g, "$&\r\n");
  const subj = /^[\x20-\x7e]*$/.test(subject) ? subject : `=?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`;
  return [
    `From: ${ME.name} <${ME.email}>`, `To: ${to || ""}`, `Subject: ${subj}`, "X-Unsent: 1", "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`, "",
    `--${boundary}`, 'Content-Type: text/plain; charset="utf-8"', "Content-Transfer-Encoding: base64", "", b64(Buffer.from(body, "utf8")), "",
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
