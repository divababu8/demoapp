import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabaseClient";
import { parseManifestExcel } from "@/lib/excelParser";
import { verifyUser } from "@/lib/auth";

// POST /api/upload
// Body: multipart/form-data with a single "file" field.
// Called once per file dropped — the frontend loops files and calls this
// endpoint per file so each manifest is processed independently (case 3
// in the spec: 4 files dropped -> 4 separate calls -> 4 manifests).
export async function POST(req: NextRequest) {
  // REQUIRED: this route uses the service-role key below, which bypasses
  // RLS. Without this check, anyone with the URL could upload without
  // logging in. Reject immediately if there's no valid session token.
  const user = await verifyUser(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized — please log in again." }, { status: 401 });
  }

  const db = getServiceClient();

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const buffer = await file.arrayBuffer();
    const parsed = parseManifestExcel(file.name, buffer);
    const newRowCount = parsed.rows.length;

    // 1. Check if this manifest already exists
    const { data: existingManifest, error: findErr } = await db
      .from("manifests")
      .select("id, total_bills")
      .eq("manifest_number", parsed.manifestNumber)
      .maybeSingle();

    if (findErr) throw findErr;

    let manifestId: string;

    if (existingManifest) {
      // ---- RE-UPLOAD LOGIC ----
      if (newRowCount === existingManifest.total_bills) {
        // Case A: identical row count -> skip entirely, no DB writes
        return NextResponse.json({
          manifest: parsed.manifestNumber,
          status: "skipped",
          message: `Already uploaded — no changes (${newRowCount}/${existingManifest.total_bills} rows match).`,
        });
      }

      if (newRowCount < existingManifest.total_bills) {
        // Case C: fewer rows than before -> reject, likely wrong/old file
        return NextResponse.json(
          {
            manifest: parsed.manifestNumber,
            status: "rejected",
            message: `Uploaded file has fewer rows (${newRowCount}) than existing manifest (${existingManifest.total_bills}). Please verify the file.`,
          },
          { status: 409 }
        );
      }

      // Case B: more rows than before -> append, upsert handles de-dupe.
      // Also refresh flight_number in case it was blank/wrong on first upload.
      manifestId = existingManifest.id;
      await db
        .from("manifests")
        .update({ flight_number: parsed.flightNumber || null })
        .eq("id", manifestId);
    } else {
      // Brand new manifest
      const { data: newManifest, error: insertManifestErr } = await db
        .from("manifests")
        .insert({
          manifest_number: parsed.manifestNumber,
          flight_number: parsed.flightNumber || null,
          original_filename: file.name,
          total_bills: 0,
        })
        .select("id")
        .single();

      if (insertManifestErr) throw insertManifestErr;
      manifestId = newManifest.id;
    }

    // 2. Upsert bills — composite unique key (manifest_id, awb_number)
    // ensures duplicate AWBs within this manifest are silently skipped.
    const rowsToInsert = parsed.rows.map((r) => ({
      manifest_id: manifestId,
      awb_number: r.awb_number,
      extra_data: r.extra_data,
    }));

    const { error: upsertErr } = await db
      .from("bills")
      .upsert(rowsToInsert, {
        onConflict: "manifest_id,awb_number",
        ignoreDuplicates: true,
      });

    if (upsertErr) throw upsertErr;

    // 3. Recompute and store the true total_bills count for this manifest
    const { count, error: countErr } = await db
      .from("bills")
      .select("*", { count: "exact", head: true })
      .eq("manifest_id", manifestId);

    if (countErr) throw countErr;

    await db
      .from("manifests")
      .update({ total_bills: count ?? 0 })
      .eq("id", manifestId);

    return NextResponse.json({
      manifest: parsed.manifestNumber,
      flightNumber: parsed.flightNumber || null,
      status: existingManifest ? "updated" : "created",
      total_bills: count,
      message: existingManifest
        ? `Updated — now ${count} bills (was ${existingManifest.total_bills}).`
        : `Created — ${count} bills linked.${parsed.flightNumber ? ` Flight ${parsed.flightNumber}.` : ""}`,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
