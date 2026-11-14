// Idea Scout: runs every morning (vercel.json cron). Claude searches the web for fresh market signals,
// then turns them into ~10 scored startup ideas saved to nudge.ideas. GET = cron run, POST {run:true} = run now (logged in).
import Anthropic from "@anthropic-ai/sdk";
import { sql, today, isAuthed } from "./_lib.js";

export const config = { maxDuration: 300 };
const client = new Anthropic();
const MODEL = "claude-opus-5-5";

const SECTORS = ["healthcare and clinics", "insurance", "small-business finance and accounting", "legal services", "energy and climate",
  "construction and real estate", "manufacturing", "logistics and trucking", "agriculture and food", "local government and public records",
  "nonprofits", "education and colleges", "consumer services and home services", "local retail and restaurants", "media, creators and publishers",
  "travel and hospitality", "HR, hiring and labor compliance", "cross-border trade and EU rules", "outdoor recreation and gear", "AI adoption inside small companies"];

function todaysSectors(t) {
  const day = Math.floor(new Date(t + "T12:00:00Z").getTime() / 86400000);
  return [0, 1, 2].map((i) => SECTORS[(day * 3 + i) % SECTORS.length]);
}

const ABOUT = `Sofia Iuteri: Washington and Lee senior (May 2027), Economics + Environmental Studies, minor Entrepreneurship. Founder of a student outdoor magazine (40-person team, $5K ad revenue), a nonprofit, and SponsorFlow (an AI SaaS she built with the Claude API). Non-CS but builds web apps with AI coding tools; can run manual services, interview customers, and has access to college campuses, student media, nonprofits and small businesses. Wants a company that could fit YC. Ideas can be US or global.`;

const str = { type: "string" };
const int15 = { type: "integer" };
const SCHEMA = {
  type: "object", additionalProperties: false, required: ["ideas"],
  properties: { ideas: { type: "array", items: { type: "object", additionalProperties: false,
    required: ["title", "sector", "pitch", "user", "buyer", "why_now", "pain", "first_offer", "grows_into", "competitors", "saturation", "importance", "profit", "execution", "test_who", "test_questions", "bad_sign", "sources"],
    properties: {
      title: str, sector: str, pitch: str, user: str, buyer: str, why_now: str, pain: str, first_offer: str, grows_into: str,
      competitors: { type: "array", items: { type: "object", additionalProperties: false, required: ["name", "note"], properties: { name: str, note: str } } },
      saturation: int15, importance: int15, profit: int15, execution: int15,
      test_who: str, test_questions: { type: "array", items: str }, bad_sign: str,
      sources: { type: "array", items: { type: "object", additionalProperties: false, required: ["label", "url", "date"], properties: { label: str, url: str, date: str } } },
    } } } },
};

async function create(params) {
  // Server-side fallback: if the model declines, the API retries on a fallback model in the same call.
  try { return await client.beta.messages.create({ ...params, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" }); }
  catch (e) { if (e instanceof Anthropic.BadRequestError) return client.messages.create(params); throw e; }
}

export async function runScout() {
  const t = today();
  const sectors = todaysSectors(t);
  const recent = await sql`SELECT title FROM nudge.ideas ORDER BY created_at DESC LIMIT 80`;

  // Step 1: research with live web search.
  const research = `Today is ${t}. You are a startup analyst finding evidence-backed opportunities for this founder:\n${ABOUT}\n\n` +
    `Scan these sectors today: ${sectors.join("; ")}. Search for developments from the past 2-4 weeks (new rules, deadlines, court rulings, enforcement, price changes, funding shifts) ` +
    `and evidence of recurring, costly pain (manual work, delays, errors, compliance burdens, work people already pay someone to do). Check who already serves each problem.\n\n` +
    `Find 10 distinct opportunities (spread across the sectors). Skip ideas similar to these recent ones: ${recent.map((r) => r.title).join("; ") || "none"}.\n` +
    `For each, write a short paragraph: the opportunity, user and buyer, why now (with source URL and date), the pain and current workaround with any cost numbers, competitors, a first paid offer, and how she could test it this week. Only cite facts you found.`;
  let messages = [{ role: "user", content: research }];
  const tools = [{ type: "web_search_20260209", name: "web_search", max_uses: 9 }];
  let msg = await create({ model: MODEL, max_tokens: 16000, output_config: { effort: "medium" }, tools, messages });
  for (let i = 0; i < 4 && msg.stop_reason === "pause_turn"; i++) {
    messages = [{ role: "user", content: research }, { role: "assistant", content: msg.content }];
    msg = await create({ model: MODEL, max_tokens: 16000, output_config: { effort: "medium" }, tools, messages });
  }
  if (msg.stop_reason === "refusal") throw new Error("Research step was declined");
  const notes = msg.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
  if (!notes) throw new Error("No research notes returned");

  // Step 2: turn the notes into structured, scored ideas.
  const shape = `Turn these research notes into structured ideas for ${ABOUT}\n\nRules: keep each text field under 30 words, plain words, no em dashes. ` +
    `Scores 1-5, honest and spread out: importance (pain size and urgency), profit (could become a profitable, venture-scale business), execution (how easily SHE can start in the next month: 5 = calls or a manual service this week, 1 = needs a license, hardware or big capital), saturation (1 = nobody serves it, 5 = crowded with funded players). ` +
    `test_who = the role and type of org to contact; test_questions = 2 questions about the last time they faced the problem; bad_sign = the answer that would weaken the case. Only use sources that appear in the notes.\n\nNOTES:\n${notes}`;
  const out = await create({ model: MODEL, max_tokens: 16000, output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } }, messages: [{ role: "user", content: shape }] });
  const text = out.content.find((b) => b.type === "text")?.text || "";
  const ideas = JSON.parse(text).ideas || [];

  let saved = 0;
  const c5 = (v) => Math.max(1, Math.min(5, Math.round(Number(v) || 3)));
  for (const i of ideas.slice(0, 12)) {
    i.saturation = c5(i.saturation); i.importance = c5(i.importance); i.profit = c5(i.profit); i.execution = c5(i.execution);
    const score = Math.round(((i.importance + i.profit + 1.5 * i.execution + (6 - i.saturation)) / 22.5) * 100);
    await sql`INSERT INTO nudge.ideas (run_date, title, sector, pitch, user_desc, buyer, why_now, pain, first_offer, grows_into, competitors, saturation, importance, profit, execution, score, test_who, test_questions, bad_sign, sources)
      VALUES (${t}, ${i.title}, ${i.sector}, ${i.pitch}, ${i.user}, ${i.buyer}, ${i.why_now}, ${i.pain}, ${i.first_offer}, ${i.grows_into}, ${JSON.stringify(i.competitors)}::jsonb,
              ${i.saturation}, ${i.importance}, ${i.profit}, ${i.execution}, ${score}, ${i.test_who}, ${JSON.stringify(i.test_questions)}::jsonb, ${i.bad_sign}, ${JSON.stringify(i.sources)}::jsonb)`;
    saved++;
  }
  return { date: t, sectors, saved };
}

export async function GET(req) {
  const auth = req.headers.get("authorization") || "";
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) return new Response("Unauthorized", { status: 401 });
  try { return Response.json(await runScout()); }
  catch (e) { return Response.json({ error: e.message }, { status: 500 }); }
}

export async function POST(req) {
  if (!isAuthed(req)) return new Response("Unauthorized", { status: 401 });
  try { return Response.json(await runScout()); }
  catch (e) { return Response.json({ error: e.message }, { status: 500 }); }
}
