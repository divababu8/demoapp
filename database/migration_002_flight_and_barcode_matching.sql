-- =====================================================================
-- MIGRATION 002 — run this once in Supabase SQL Editor, AFTER schema.sql.
-- Adds: flight_number on manifests, and barcode suffix-matching in scan_bill
-- (multi-symbology scanners prepend/append extra digits around the real
-- AWB — e.g. scanning "9876612345678" for a real AWB of "12345678").
-- =====================================================================

-- 1. New column — manifest-level flight number, parsed alongside the
--    manifest number (see lib/excelParser.ts: parseFlightAndManifest).
alter table manifests add column if not exists flight_number text;

-- 2. Reports view: surface flight_number alongside manifest_number.
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
  m.flight_number,
  m.upload_date,
  m.total_bills,
  count(b.id) filter (where b.scan_status = 'scanned') as scanned_count,
  count(b.id) filter (where b.scan_status = 'pending') as pending_count,
  coalesce(sc.search_count, 0) as total_search_count
from manifests m
left join bills b on b.manifest_id = m.id
left join search_counts sc on sc.manifest_id = m.id
group by m.id, m.manifest_number, m.flight_number, m.upload_date, m.total_bills, sc.search_count;

-- 3. scan_bill(): exact match first (unchanged behavior), THEN — only if
--    that fails — a suffix match: does any bill's awb_number appear as the
--    trailing digits of what was scanned? This is NOT fuzzy/partial
--    matching of user-typed input (that rule is unchanged: an incomplete
--    or wrong number still returns "not found", logs nothing). It only
--    ever matches when the FULL, exact stored AWB is literally embedded
--    as a suffix of a longer scanned string — e.g. right('9876612345678', 8)
--    = '12345678'. If several bills' AWBs are all valid suffixes (rare),
--    the longest (most specific) one wins.
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
  v_matched_awb  text;
begin
  select * into v_bill
  from bills
  where awb_number = p_awb
  order by created_at desc
  limit 1;

  if not found then
    -- Suffix fallback: minimum length 4 guards against trivially short
    -- AWBs matching by coincidence.
    select * into v_bill
    from bills
    where length(awb_number) >= 4
      and length(p_awb) > length(awb_number)
      and right(p_awb, length(awb_number)) = awb_number
    order by length(awb_number) desc, created_at desc
    limit 1;
  end if;

  if not found then
    return jsonb_build_object('found', false);
  end if;

  v_matched_awb := v_bill.awb_number;

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
    'scannedRaw', p_awb,        -- what was actually typed/scanned
    'matchedAwb', v_matched_awb, -- the real AWB it resolved to (may differ from scannedRaw)
    'bill', jsonb_build_object(
      'id', v_bill.id,
      'awb_number', v_bill.awb_number,
      'scan_status', v_bill.scan_status,
      'extra_data', v_bill.extra_data,
      'manifest_number', v_manifest.manifest_number,
      'flight_number', v_manifest.flight_number,
      'manifest_upload_date', v_manifest.upload_date
    )
  );
end;
$$;

-- =====================================================================
-- DONE. No changes needed to RLS, indexes, or any other table.
-- =====================================================================
