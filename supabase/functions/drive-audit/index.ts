// ExamPro Edge Function: drive-audit
// Detects orphaned storage records (database records without Drive files,
// or Drive files not tracked in the database).
import { createClient } from "jsr:@supabase/supabase-js@2";
import { getDriveClient } from "../_shared/drive-auth.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const auth = req.headers.get("authorization") ?? "";
    const svc = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );
    const userId = (await svc.auth.getUser(auth.replace("Bearer ", ""))).data.user?.id;
    if (!userId) return j(401, { error: "unauthenticated" }, cors);

    const { data: isAdmin } = await svc.rpc("app_is_platform_admin", { p_user_id: userId });
    if (!isAdmin) return j(403, { error: "forbidden" }, cors);

    const { data: objects } = await svc.from("storage_objects")
      .select("id, drive_file_id, original_filename, mime_type, size_bytes, is_deleted, created_at, tenant_id, question_id, paper_id, source_document_id")
      .eq("provider", "GOOGLE_DRIVE");

    const drive = await getDriveClient(svc, null);

    const orphanDb = [];
    const orphanDrive = [];
    const duplicates = [];
    const seenHashes = new Map();

    for (const obj of (objects || [])) {
      if (!obj.drive_file_id) {
        orphanDb.push({ id: obj.id, reason: "missing drive_file_id" });
        continue;
      }
      try {
        const meta = await drive.files.get({
          fileId: obj.drive_file_id,
          fields: 'id, trashed, name',
          supportsAllDrives: true,
        });
        if (meta.data.trashed) {
          orphanDb.push({ id: obj.id, drive_file_id: obj.drive_file_id, reason: "file trashed in Drive" });
        }
        if (obj.sha256) {
          if (seenHashes.has(obj.sha256)) {
            duplicates.push({ id: obj.id, sha256: obj.sha256, duplicateOf: seenHashes.get(obj.sha256) });
          } else {
            seenHashes.set(obj.sha256, obj.id);
          }
        }
      } catch (e) {
        orphanDb.push({ id: obj.id, drive_file_id: obj.drive_file_id, reason: "file not found in Drive" });
      }
    }

    return j(200, {
      totalRecords: (objects || []).length,
      orphanDb: orphanDb.length,
      orphanDrive: orphanDrive.length,
      duplicates: duplicates.length,
      details: { orphanDb, orphanDrive, duplicates },
      checkedAt: new Date().toISOString(),
    }, cors);
  } catch (e) {
    console.error('[' + Deno.env.get('SUPABASE_FUNCTION_NAME') + '] error:', e);
    const _m = String((e && e.message) || e || '');
    if (_m.includes('EXAMPRO_DRIVE_NOT_CONFIGURED') || _m.includes('EXAMPRO_DRIVE_OAUTH_INCOMPLETE')) {
      return j(503, { error: 'Google Drive is not connected.' }, cors);
    }
    return j(500, { error: 'internal error' }, cors);
  }
});

function j(code: number, body: any, headers: any) {
  return new Response(JSON.stringify(body), { status: code, headers: { ...headers, "Content-Type": "application/json" } });
}
