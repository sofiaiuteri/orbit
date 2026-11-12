# Orbit

A tiny app that tells me who to follow up with today.

Networking falls apart in the follow-up, not the first email. Orbit keeps the rhythm for me:

- **Day 3 to 4 after I reach out:** a friendly follow-up, with the message already drafted
- **A week later:** one last note
- **After 2 follow-ups with no reply:** it stops reminding me, so nobody gets pestered
- **After a coffee chat:** a thank-you reminder the next day, then a check-in every 2 months

Every morning it sends a phone notification listing who's due. Each card has the draft, "Copy", "Open in email", and one tap to log what happened.

**Try the demo (made-up people):** add `?demo=1` to the URL.

## How it's built

- Plain HTML, CSS and JavaScript, no framework or build step
- Vercel serverless functions (`/api`) with a Neon Postgres database
- Web push notifications (installable on iPhone via Add to Home Screen) and a daily Vercel cron
- One-password login with a signed cookie

No contact data lives in this repo. Everything personal stays in the database.

## Run it yourself

1. Create a Neon database and set these env vars (in `.env.local` and on Vercel):
   `DATABASE_URL`, `NUDGE_PASSWORD`, `SESSION_SECRET`, `CRON_SECRET`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`
   (make VAPID keys with `npx web-push generate-vapid-keys`)
2. `npm install && npm run setup-db`
3. Deploy to Vercel.

Built by [Sofia Iuteri](https://sofiaiuteri.com).
