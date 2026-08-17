// ExamPro Edge Function: drive-metadata
// Returns metadata for a Drive file.
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

    const { fileId } = await req.json();
    if (!fileId) return j(400, { error: "fileId is required" }, cors);

    // tenant scope: only the owning tenant (or a platform admin) may read metadata
    const { data: obj } = await svc.from("storage_objects")
      .select("tenant_id").eq("drive_file_id", fileId).eq("is_deleted", false).maybeSingle();
    if (!obj) return j(404, { error: "file not found" }, cors);
    const { data: tm } = await svc.from("tenant_memberships")
      .select("tenant_id").eq("user_id", userId).eq("status", "ACTIVE").limit(1);
    const memberTenant = tm && tm.length > 0 ? tm[0].tenant_id : null;
    const isAdmin = tm && tm.length > 0 && await svc.rpc("app_is_platform_admin", { p_user_id: userId }).then(r => r.data).catch(() => false);
    if (!isAdmin && obj.tenant_id !== memberTenant) return j(403, { error: "forbidden" }, cors);

    const drive = await getDriveClient(svc, obj.tenant_id);

    const res = await drive.files.get({
      fileId,
      fields: 'id, name, mimeType, size, createdTime, modifiedTime, webViewLink, webContentLink, parents, trashed',
      supportsAllDrives: true,
    });
    return j(200, res.data, cors);
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
