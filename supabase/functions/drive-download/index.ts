// ExamPro Edge Function: drive-download
// Server-side file download from Google Drive. Streams the file back to the client
// after auth/z checks. Never exposes Google credentials.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { getDriveClient, getDriveAccessToken } from "../_shared/drive-auth.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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

    let fileId: string | null = null;
    if (req.method === "GET") {
      fileId = new URL(req.url).searchParams.get("fileId");
    } else {
      try { const body = await req.json(); fileId = body.fileId || null; } catch (_) {}
    }
    if (!fileId) return j(400, { error: "fileId is required" }, cors);

    const { data: obj } = await svc.from("storage_objects")
      .select("id, tenant_id, provider, drive_file_id, original_filename, mime_type, size_bytes")
      .eq("drive_file_id", fileId).eq("is_deleted", false).maybeSingle();
    if (!obj) return j(404, { error: "file not found" }, cors);

    const { data: tm } = await svc.from("tenant_memberships")
      .select("tenant_id, role_id").eq("user_id", userId).eq("status", "ACTIVE").limit(1);
    const memberTenant = tm && tm.length > 0 ? tm[0].tenant_id : null;
    const isAdmin = tm && tm.length > 0 && await svc.rpc("app_is_platform_admin", { p_user_id: userId }).then(r => r.data).catch(() => false);
    if (!isAdmin && obj.tenant_id !== memberTenant) return j(403, { error: "forbidden" }, cors);

    const drive = await getDriveClient(svc, obj.tenant_id);

    // Stream the media directly from the Google Drive API instead of buffering
    // it through the googleapis client (whose media responses can stall in the
    // Deno edge runtime). Pass the body straight through to the caller.
    const t0 = Date.now();
    const accessToken = await getDriveAccessToken(drive);
    const mediaUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`;
    let res: Response;
    try {
      res = await fetch(mediaUrl, {
        headers: { authorization: "Bearer " + accessToken },
        signal: AbortSignal.timeout(30000),
      });
    } catch (e) {
      const _m = String((e && e.message) || e || "");
      if (/abort|timeout/i.test(_m)) {
        return j(504, { error: "drive media timeout after " + (Date.now() - t0) + "ms" }, cors);
      }
      throw e;
    }
    if (!res.ok || !res.body) {
      return j(res.status >= 500 ? 502 : 500, { error: "drive media " + res.status }, cors);
    }
    console.error("drive media ok in " + (Date.now() - t0) + "ms");

    const headers = new Headers(cors as any);
    headers.set("Content-Type", obj.mime_type || "application/octet-stream");
    headers.set("Content-Disposition", `attachment; filename="${encodeURIComponent(obj.original_filename || 'download')}"`);
    headers.set("Content-Length", String(obj.size_bytes || 0));
    headers.set("Access-Control-Expose-Headers", "Content-Disposition, Content-Type, Content-Length");

    return new Response(res.body, { status: 200, headers });
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
