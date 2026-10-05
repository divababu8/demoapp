import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabaseClient";
import { parseManifestExcel } from "@/lib/excelParser";
import { verifyUser } from "@/lib/auth";

/* =====================================================================
   Helper — detect "column does not exist" / "schema cache" errors so we
   can gracefully retry without flight_number on databases where the
   migration hasn't been applied yet.                                    */
function isMissingColumnError(err: any, column: string): boolean {
  if (!err) return false;
  const msg = String(err.message ?? err.error ?? "").toLowerCase();
  return (
    msg.includes(column.toLowerCase()) &&
    (msg.includes("does not exist") ||
     msg.includes("not in the schema cache") ||
     msg.includes("could not find"))
  );
}

// POST /api/upload
export async function POST(req: NextRequest) {
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

    // 1. Does this manifest already exist?
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
        return NextResponse.json({
          manifest: parsed.manifestNumber,
          flightNumber: parsed.flightNumber,
          status: "skipped",
          message: `Already uploaded — no changes (${newRowCount}/${existingManifest.total_bills} rows match).`,
        });
      }

      if (newRowCount < existingManifest.total_bills) {
        return NextResponse.json(
          {
            manifest: parsed.manifestNumber,
            flightNumber: parsed.flightNumber,
            status: "rejected",
            message: `Uploaded file has fewer rows (${newRowCount}) than existing manifest (${existingManifest.total_bills}). Please verify the file.`,
          },
          { status: 409 }
        );
      }

      // Case B: more rows -> append. Refresh flight_number if we can.
      manifestId = existingManifest.id;
      const { error: updErr } = await db
        .from("manifests")
        .update({ flight_number: parsed.flightNumber || null })
        .eq("id", manifestId);

      // If the column doesn't exist yet, ignore — upload still succeeds.
      if (updErr && !isMissingColumnError(updErr, "flight_number")) throw updErr;
    } else {
      // Brand new manifest. Try with flight_number, fall back without it.
      const insertPayload: Record<string, any> = {
        manifest_number: parsed.manifestNumber,
        original_filename: file.name,
        total_bills: 0,
      };
      if (parsed.flightNumber) insertPayload.flight_number = parsed.flightNumber;

      let insertRes = await db
        .from("manifests")
        .insert(insertPayload)
        .select("id")
        .single();

      // If the failure was specifically about the flight_number column,
      // retry without it so the upload doesn't break on a fresh DB.
      if (insertRes.error && isMissingColumnError(insertRes.error, "flight_number")) {
        delete insertPayload.flight_number;
        insertRes = await db
          .from("manifests")
          .insert(insertPayload)
          .select("id")
          .single();
      }

      if (insertRes.error) throw insertRes.error;
      manifestId = insertRes.data.id;
    }

    // 2. Upsert bills
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

    // 3. Recompute total_bills
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
      flightNumber: parsed.flightNumber,
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