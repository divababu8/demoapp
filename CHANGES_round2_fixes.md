# This round's fixes

## 1. Upload: "AWB column not found"
`lib/excelParser.ts` now matches the header normalized (trims, collapses
whitespace, ignores case) instead of a brittle exact string match — catches
things like a trailing space or a non-breaking space in the header cell
that `.trim()` alone wouldn't catch. If no header matches by name at all,
it now falls back to **column A (the first column)**, since you've
confirmed that's always where Tracking Number lives. Upload no longer
hard-fails on a header-text mismatch.

## 2. The real bug: scans were being truncated mid-scan
This was the cause of "already scanned," "missing tracking number," and
"not valid" all showing up unexpectedly. Last round I added an auto-submit
that fired as soon as 8 digits were typed, as a safety net for scanners
that don't send Enter. That was wrong for your actual scanners: they send
**longer** payloads with the real tracking number embedded inside (the
`9876612345678` contains `12345678` case) — so the page was submitting a
truncated, meaningless 8-digit prefix the instant it was reached, *before*
the scanner had finished sending the rest. That partial value matches
nothing, which is exactly the "not valid" / missing-number symptom.

**Fixed by removing the per-keystroke auto-submit entirely.** Submission
now only happens on the scanner's own Enter (its real "I'm done"
signal) or the Submit button — the same reliable trigger as before I
touched it. The backend's suffix-matching (added last round) still handles
the embedded-number case correctly once the full, untruncated payload
actually arrives.

## 3. Already-scanned now shows full details + search count
This was mostly a side effect of #2 — once the full number reaches the
backend instead of a truncated fragment, it resolves correctly either way.
On top of that, the Status box now explicitly reads:
- **"SCANNED NOW"** (green) — first time this bill has been scanned
- **"ALREADY SCANNED (searched N×)"** (amber) — every repeat, with the
  live search count

Every field — Tracking Number, Status, Manifest Description, Flight No,
Manifest Code — populates the same way whether it's a first-time scan or
a repeat; nothing is hidden on a repeat scan.

## 4. Flight number
Re-verified the full path (parser → upload → `scan_bill()` → display) —
unaffected by the above; the only thing that was broken was the AWB
column detection stopping the whole upload before any of this ran. Same
caveat as last round still applies: confirm `MANIFEST_FLIGHT_COLUMN_HEADER`
in `lib/excelParser.ts` is your real column name if it's not `"Manifest
Ref"`, or tell me and I'll set it directly like we did for the country
code column.

## 5. Manifest Description & Manifest Code — bigger, bold
- Manifest Description is now a fixed, read-only `<textarea>` (not an
  editable box) — `resize: none`, no internal scrollbar, bold, bigger text.
- Manifest Code is now bold and bigger too. Flight No stays regular size
  (you only asked for Description + Code).

## 6. No scrolling on the Scan page
Tightened the vertical spacing specifically on this page (header, panel,
each field row, stats) so the whole thing fits a normal laptop/desktop
screen without a scrollbar. This doesn't touch spacing on any other page.
