# Testing on Your Laptop (fully offline, before deploying online)

This app relies on Supabase's Postgres + Auth + Realtime + Row Level Security +
the custom `scan_bill()` function — not just a plain Postgres database. The
most accurate way to test locally is the **Supabase CLI local stack**, which
runs the real Supabase engine (Postgres, Auth, Realtime, Studio UI) in Docker
containers on your machine. It behaves identically to the cloud version, so
nothing changes when you later switch to your real online project.

---

## Prerequisites

- **Docker Desktop** — installed and running. (Supabase's local stack runs as
  Docker containers; your existing standalone Postgres install isn't used
  directly, since Auth/Realtime need to run alongside it exactly as they do
  in the cloud.)
- **Node.js 18+** and **npm** — for the Next.js app.
- No Supabase account or internet connection needed for local testing.

If you'd rather skip Docker entirely: create a free cloud Supabase project
(as in the original README) and just point your local `npm run dev` at it —
your laptop app still runs locally, only the database is remote. Skip to
**Step 6** if you choose this.

---

## STEP 1 — Install the Supabase CLI

```bash
npm install -g supabase
supabase --version
```

## STEP 2 — Initialize Supabase inside the project

```bash
cd manifest-scan-app
supabase init
```

This creates a `supabase/` folder for local config — safe to keep in the repo.

## STEP 3 — Start the local stack

```bash
supabase start
```

First run downloads Docker images (a few minutes). When done, it prints something like:

```
API URL: http://localhost:54321
DB URL: postgresql://postgres:postgres@localhost:54322/postgres
Studio URL: http://localhost:54323
anon key: eyJhbGciOi...
service_role key: eyJhbGciOi...
```

Keep this output visible — you'll need the API URL and both keys next. You can
always re-print them later with `supabase status`.

## STEP 4 — Load the schema into the local database

```bash
psql "postgresql://postgres:postgres@localhost:54322/postgres" -f database/schema.sql
```

(If `psql` isn't on your PATH, open **Studio URL → SQL Editor** from Step 3
in your browser instead, paste the contents of `database/schema.sql`, and
run it there — same effect.)

## STEP 5 — Create your first local login user

Open **Studio URL** (`http://localhost:54323`) → **Authentication → Users →
Add User** → enter an email + password. This is a completely local test
account, separate from anything in the cloud.

## STEP 6 — Point the app at your local (or cloud) Supabase

```bash
cp .env.example .env.local
```

Fill in `.env.local` with the values from Step 3 (or your cloud project's
values if you skipped Docker):

```
NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key from step 3>
SUPABASE_SERVICE_ROLE_KEY=<service_role key from step 3>
```

## STEP 7 — Run the app

```bash
npm install
npm run dev
```

Open `http://localhost:3000` → you should land on `/login` (confirms the
route guard is working) → log in with the user from Step 5.

---

## What to actually test locally, in order

1. **Login/logout** — confirm `/dashboard` redirects to `/login` when logged
   out, and that logout from the sidebar works.
2. **Upload** — drag 2–3 sample `.xlsx` files named like
   `Manifest_26092026_01.xlsx`. Confirm the live "Manifests Uploaded / Total
   Bills Uploaded" counters update on the page itself.
3. **Re-upload rules** — drop the exact same file again (expect "skipped"),
   add rows and re-drop (expect "updated"), then try a file with fewer rows
   than before (expect "rejected").
4. **Scanning — single user** — type a real AWB number + Enter. Confirm the
   details panel populates, the beep plays, and the input auto-clears and
   refocuses. Search the same AWB again — confirm it says "Already scanned"
   and the search-attempt count goes up without creating a duplicate scan.
5. **Scanning — concurrency (the race-condition fix)** — open the Scanning
   page in two separate browser windows (or one normal + one incognito),
   log in as the same or different users in each, and submit the **same**
   AWB in both at nearly the same moment. Exactly one should say "Scanned
   now"; the other should say "Already scanned." This confirms the atomic
   `scan_bill()` function is working.
6. **Realtime** — open Dashboard in one tab and Scanning in another; scan a
   bill in the Scanning tab and confirm the Dashboard's counters update on
   their own, with no refresh.
7. **Shipments / Overages** — confirm the date filters work and all ~38
   extra columns render in the Shipments table.
8. **Reports** — pick today's date range, confirm the rollup numbers match
   what you'd expect from your test uploads/scans, then click **Export
   Excel** and **Export PDF** and open both downloaded files to confirm they
   look right.

---

## Stopping / resetting the local stack

```bash
supabase stop            # stops containers, keeps your data
supabase stop --no-backup && supabase start   # wipes local data and starts fresh
```

---

## Moving to the online deployment

Nothing in the app code changes. Once local testing passes, follow the
original `README.md` deployment steps (create a real cloud Supabase project,
run `schema.sql` there, and deploy to Vercel with the cloud project's
URL/keys in the environment variables instead of the local ones above).
