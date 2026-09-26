# Manifest Scanning Dashboard — Execution Guide

Follow these steps **in order**. Each step depends on the previous one working.

---

## STEP 1 — Create the Supabase project (Database + Auth + Realtime)

1. Go to https://supabase.com → Sign up (free) → "New Project".
2. Choose a name, database password (save it), and region closest to you.
3. Wait ~2 minutes for provisioning.
4. Go to **SQL Editor → New Query**, paste the entire contents of `database/schema.sql`, and click **Run**.
5. Go to **Database → Replication** and confirm `bills` and `manifests` are toggled ON for Realtime (the schema script already does this, this is just a visual check).
6. Go to **Authentication → Users → Add User** and create your first login (email + password) — this is what you'll use to log into the dashboard.
7. Go to **Project Settings → API** and copy:
   - `Project URL`
   - `anon public` key
   - `service_role` key (keep this secret — never put it in frontend code)

---

## STEP 2 — Configure the Next.js project

```bash
cd manifest-scan-app
cp .env.example .env.local
```

Open `.env.local` and paste in the 3 values from Step 1.6.

---

## STEP 3 — Set your real Excel column header for AWB

Open `lib/excelParser.ts` and confirm this line matches your actual Excel header text **exactly**:

```ts
export const AWB_COLUMN_HEADER = "Tracking Number";
```

(Since your headers are fixed across all files, you only ever set this once.)

---

## STEP 4 — Install dependencies and run locally

```bash
npm install
npm run dev
```

Open http://localhost:3000 → you'll be redirected to `/login`. Log in with the user you created in Step 1.6.

---

## STEP 5 — Test the upload flow

1. Go to **Upload Data**.
2. Drag 2–4 `.xlsx` files named like `Manifest_26092026_01.xlsx`.
3. Confirm each shows `created` with the correct bill count.
4. Re-drop the exact same file → confirm it shows `skipped`.
5. Add a few new rows to one file and re-drop it → confirm it shows `updated` with only the new AWBs added.

---

## STEP 6 — Test the scanning flow

1. Go to **Scanning**.
2. Type (or scan with a real barcode scanner) an AWB number that exists in your uploaded data, press **Enter**.
3. Confirm details populate below automatically and input clears/refocuses.
4. Search the same AWB again → confirm it now shows "Already scanned" and the search-attempt count increments.
5. Open the **Dashboard** in a second browser tab/window → confirm scan counts update live without refreshing (this proves Realtime is working).

---

## STEP 7 — Check Shipments and Overages pages

- **Shipments**: should show today's uploaded bills with all ~38 extra columns rendered dynamically, plus a working date/manifest filter.
- **Overages**: should show per-manifest scanned vs pending (not-scanned) counts for the last 7 days.
- **Reports**: pick a date range (defaults to today, for end-of-day use), confirm the table shows manifest / total bills / scanned / pending / total search attempts, then click **Export Excel** or **Export PDF** and confirm the file downloads correctly.

---

## STEP 8 — Deploy for free

### Push to GitHub
```bash
git init
git add .
git commit -m "Initial manifest scanning dashboard"
git remote add origin <your-empty-github-repo-url>
git push -u origin main
```

### Deploy on Vercel (free)
1. Go to https://vercel.com → Sign up with GitHub.
2. **Add New Project** → import your repo.
3. In **Environment Variables**, add the same 3 values from your `.env.local`:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
4. Click **Deploy**. Vercel gives you a public HTTPS URL (e.g. `your-app.vercel.app`) — this is your live internet-accessible dashboard.
5. Every future `git push` auto-redeploys.

### Keep Supabase active
Free Supabase projects pause after 7 days of zero activity (no data loss, just needs waking). If your team uses it daily this is a non-issue. If it ever shows "paused," just open the Supabase dashboard and click Resume.

---

## Project structure reference

```
manifest-scan-app/
├── database/
│   └── schema.sql              # run once in Supabase SQL Editor
├── lib/
│   ├── supabaseClient.ts       # browser + server Supabase clients
│   └── excelParser.ts          # fixed-header parser, AWB extraction, JSONB builder
├── app/
│   ├── login/page.tsx
│   ├── dashboard/page.tsx      # realtime live counters
│   ├── shipments/page.tsx      # filter + dynamic all-columns table
│   ├── overages/page.tsx       # per-manifest scanned/pending rollup
│   ├── upload/page.tsx         # drag-and-drop, no buttons
│   ├── scanning/page.tsx       # Enter-key triggered, auto-clear/refocus
│   ├── reports/page.tsx        # admin end-of-day report, Excel + PDF export
│   └── api/
│       ├── upload/route.ts     # manifest creation + re-upload logic
│       └── bills/search/route.ts  # search vs scan event separation
├── components/
│   └── Sidebar.tsx
├── package.json
├── tsconfig.json
└── .env.example
```

## Access control — what's covered

- **Page-level**: `app/(protected)/layout.tsx` wraps Dashboard, Shipments, Overages, Upload, and Scanning. It checks for a valid session on load and on every auth-state change; anyone without a session is redirected straight to `/login` before any protected content renders. `/login` and `/` are the only routes reachable without logging in.
- **API-level (the part that actually matters for a public URL)**: `/api/upload` and `/api/bills/search` use the Supabase **service-role key**, which bypasses Row Level Security entirely — so without a check, anyone who found the URL could call them directly, logged in or not. Both routes now call `verifyUser()` (`lib/auth.ts`) first, which validates the Bearer token against Supabase Auth and returns `401 Unauthorized` if it's missing or invalid. The frontend attaches this token automatically via `getAuthHeader()` on every request.
- **Logout**: available from the sidebar on every protected page; clears the session and redirects to `/login`.

This means once deployed on Vercel, a visitor with no account can only ever see the login screen — every page and every API endpoint refuses them.

## What to change later (not needed to launch)
- `lib/excelParser.ts` → if headers ever change, this is the only file to touch.
- `database/schema.sql` RLS policies → currently "any logged-in user, full access"; tighten per-role later if multiple teams share the dashboard.
- Scanning page currently matches AWB across *any* manifest (most recent match wins) since AWB is only unique per-manifest — if you need to scope scanning to one manifest at a time, pass `manifest_id` into the search API and filter there.
