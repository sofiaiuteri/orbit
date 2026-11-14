// Creates the tables. Safe to run more than once. Usage: npm run setup-db
import { neon } from "@neondatabase/serverless";
const sql = neon(process.env.DATABASE_URL);

await sql`CREATE SCHEMA IF NOT EXISTS nudge`;
await sql`CREATE TABLE IF NOT EXISTS nudge.people (
  id serial PRIMARY KEY,
  name text NOT NULL, company text, role text, context text,
  email text, linkedin text, phone text, ask text, notes text,
  priority text NOT NULL DEFAULT 'normal',
  status text NOT NULL DEFAULT 'to_contact',
  last_outreach date, last_met date, followups_sent int NOT NULL DEFAULT 0,
  next_due date, stage text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`;
await sql`CREATE TABLE IF NOT EXISTS nudge.log (
  id serial PRIMARY KEY, person_id int REFERENCES nudge.people(id) ON DELETE CASCADE,
  at timestamptz NOT NULL DEFAULT now(), kind text NOT NULL, text text NOT NULL)`;
await sql`ALTER TABLE nudge.people ADD COLUMN IF NOT EXISTS hold_reason text`;
await sql`ALTER TABLE nudge.people ADD COLUMN IF NOT EXISTS meeting_on date`;
await sql`CREATE TABLE IF NOT EXISTS nudge.push_subs (endpoint text PRIMARY KEY, sub jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now())`;
await sql`CREATE TABLE IF NOT EXISTS nudge.ideas (
  id serial PRIMARY KEY, run_date date NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  title text NOT NULL, sector text, pitch text, user_desc text, buyer text, why_now text, pain text, first_offer text, grows_into text,
  competitors jsonb, saturation int, importance int, profit int, execution int, score int,
  test_who text, test_questions jsonb, bad_sign text, sources jsonb,
  status text NOT NULL DEFAULT 'new', notes text)`;
console.log("Tables ready.");
