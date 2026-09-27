-- =====================================================================
-- MANIFEST SCANNING DASHBOARD — DATABASE SCHEMA
-- Run this once in Supabase SQL Editor (Project → SQL Editor → New query)
-- =====================================================================

-- 1. MANIFESTS TABLE
-- One row per uploaded Excel file.
create table manifests (
  id              uuid primary key default gen_random_uuid(),
  manifest_number text not null unique,          -- e.g. "Manifest_26092026_01"
  original_filename text not null,
  upload_date     timestamptz not null default now(),
  uploaded_by     uuid references auth.users(id),
  total_bills     integer not null default 0,     -- denormalized, updated on insert
  created_at      timestamptz not null default now()
);

create index idx_manifests_upload_date on manifests (upload_date desc);

-- 2. BILLS TABLE
-- One row per AWB (per manifest). Core columns are real columns;
-- the remaining ~38 Excel columns live in extra_data (JSONB).
create table bills (
  id              uuid primary key default gen_random_uuid(),
  manifest_id     uuid not null references manifests(id) on delete cascade,
  awb_number      text not null,
  extra_data      jsonb not null default '{}'::jsonb,  -- all other ~38 columns, fixed keys, null where blank
  scan_status     text not null default 'pending' check (scan_status in ('pending','scanned')),
  scanned_by      uuid references auth.users(id),
  scanned_at      timestamptz,
  created_at      timestamptz not null default now(),

  -- THE key business rule: AWB is unique only WITHIN a manifest, not globally
  constraint uq_manifest_awb unique (manifest_id, awb_number)
);

create index idx_bills_manifest_id on bills (manifest_id);
create index idx_bills_awb_number on bills (awb_number);          -- fast scan lookup
create index idx_bills_scan_status on bills (scan_status);
create index idx_bills_extra_data_gin on bills using gin (extra_data); -- optional: filter inside JSONB later

-- 3. SCAN_EVENTS TABLE
-- Every lookup on the Scanning page = 1 row here. Separates "search count"
-- (every attempt) from "scan count" (bills.scan_status, first match only).
create table scan_events (
  id          uuid primary key default gen_random_uuid(),
  bill_id     uuid not null references bills(id) on delete cascade,
  event_type  text not null check (event_type in ('search','scan')),
  user_id     uuid references auth.users(id),
  created_at  timestamptz not null default now()
);

create index idx_scan_events_bill_id on scan_events (bill_id);
create index idx_scan_events_created_at on scan_events (created_at desc);

-- =====================================================================
-- 4. HELPER VIEW — used by Overages page
-- Per-manifest rollup: total / scanned / pending (= overage), last 7 days
-- =====================================================================
create or replace view manifest_overages as
select
  m.id as manifest_id,
  m.manifest_number,
  m.upload_date,
  m.total_bills,
  count(b.id) filter (where b.scan_status = 'scanned') as scanned_count,
  count(b.id) filter (where b.scan_status = 'pending') as pending_count
from manifests m
left join bills b on b.manifest_id = m.id
where m.upload_date >= now() - interval '7 days'
group by m.id, m.manifest_number, m.upload_date, m.total_bills;

-- =====================================================================
-- 4b. ADMIN REPORT VIEW — used by the Reports page (Excel/PDF export)
-- Per manifest: total bills, scanned, pending, AND total search attempts
-- (every scan_events row of type 'search', across all bills in that manifest).
-- No date restriction here — the Reports page applies its own date filter,
-- so admins can pull any day's or any week's end-of-day report.
-- =====================================================================
create or replace view manifest_report as
with search_counts as (
  select bi.manifest_id, count(*) as search_count
  from scan_events se
  join bills bi on bi.id = se.bill_id
  where se.event_type = 'search'
  group by bi.manifest_id
)
select
  m.id as manifest_id,
  m.manifest_number,
  m.upload_date,
  m.total_bills,
  count(b.id) filter (where b.scan_status = 'scanned') as scanned_count,
  count(b.id) filter (where b.scan_status = 'pending') as pending_count,
  coalesce(sc.search_count, 0) as total_search_count
from manifests m
left join bills b on b.manifest_id = m.id
left join search_counts sc on sc.manifest_id = m.id
group by m.id, m.manifest_number, m.upload_date, m.total_bills, sc.search_count;

grant select on manifest_report to authenticated;

-- =====================================================================
-- 4c. PENDING-AGE VIEW — used by Dashboard + Overages to compute overage
-- status ("pending > 10h"). Both pages previously downloaded EVERY pending
-- bill row (manifest_id, created_at) to the browser just to find the
-- oldest one per manifest in JavaScript — on every single realtime tick,
-- across every scanner. This view does that aggregation in the database
-- instead, so the browser only ever receives one small row per manifest.
-- =====================================================================
create or replace view manifest_pending_age as
select manifest_id, min(created_at) as oldest_pending_at
from bills
where scan_status = 'pending'
group by manifest_id;

grant select on manifest_pending_age to authenticated;

-- =====================================================================
-- 5. ROW LEVEL SECURITY (RLS) — required by Supabase for client-side access
-- Simple policy: any logged-in user can read/write. Tighten later if needed.
-- =====================================================================
alter table manifests enable row level security;
alter table bills enable row level security;
alter table scan_events enable row level security;

create policy "Authenticated users full access - manifests"
  on manifests for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

create policy "Authenticated users full access - bills"
  on bills for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

create policy "Authenticated users full access - scan_events"
  on scan_events for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- =====================================================================
-- 5b. ATOMIC SCAN FUNCTION — replaces 4 sequential round-trips from the
-- API route with a single call, and fixes a real race condition: with
-- 2 people scanning simultaneously, two near-identical requests for the
-- same AWB could both read scan_status='pending' before either write
-- landed, and both would incorrectly report "justScanned". The
-- `update ... where scan_status = 'pending' returning *` below is
-- atomic — only ONE concurrent caller can ever win that update, so
-- exactly one scan event fires no matter how many scanners hit it at once.
-- =====================================================================
create or replace function scan_bill(p_awb text, p_user_id uuid)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_bill      bills%rowtype;
  v_manifest  manifests%rowtype;
  v_just_scanned boolean := false;
  v_search_count integer;
begin
  select * into v_bill
  from bills
  where awb_number = p_awb
  order by created_at desc
  limit 1;

  if not found then
    return jsonb_build_object('found', false);
  end if;

  -- Always log the search/attempt event
  insert into scan_events (bill_id, event_type, user_id)
  values (v_bill.id, 'search', p_user_id);

  -- Atomic flip: only succeeds for the first caller while status is still 'pending'
  update bills
  set scan_status = 'scanned', scanned_by = p_user_id, scanned_at = now()
  where id = v_bill.id and scan_status = 'pending'
  returning * into v_bill;

  if found then
    v_just_scanned := true;
    insert into scan_events (bill_id, event_type, user_id)
    values (v_bill.id, 'scan', p_user_id);
  else
    -- Someone else already scanned it (or this is a repeat lookup) — refetch current row
    select * into v_bill from bills where id = v_bill.id;
  end if;

  select count(*) into v_search_count
  from scan_events
  where bill_id = v_bill.id and event_type = 'search';

  select * into v_manifest from manifests where id = v_bill.manifest_id;

  return jsonb_build_object(
    'found', true,
    'justScanned', v_just_scanned,
    'searchCount', v_search_count,
    'bill', jsonb_build_object(
      'id', v_bill.id,
      'awb_number', v_bill.awb_number,
      'scan_status', v_bill.scan_status,
      'extra_data', v_bill.extra_data,
      'manifest_number', v_manifest.manifest_number,
      'manifest_upload_date', v_manifest.upload_date
    )
  );
end;
$$;

grant execute on function scan_bill(text, uuid) to authenticated;

-- =====================================================================
-- 6. ENABLE REALTIME on bills + manifests
-- (In Supabase dashboard: Database → Replication → toggle these tables ON,
--  OR run the following if using the Supabase CLI / SQL directly)
-- =====================================================================
alter publication supabase_realtime add table bills;
alter publication supabase_realtime add table manifests;

-- =====================================================================
-- DONE. Next: create your first login user via Supabase Auth dashboard,
-- then move to the Next.js app (see /README.md for run order).
-- =====================================================================
