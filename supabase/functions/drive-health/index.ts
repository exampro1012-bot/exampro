// ExamPro Edge Function: drive-health
// Returns Google Drive connection health, folder status, and storage usage metrics.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { getDriveClient } from "../_shared/drive-auth.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
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

    const { data: prof } = await svc.from("profiles").select("default_tenant_id").eq("auth_user_id", userId).maybeSingle();
    const tenantId = prof?.default_tenant_id || "00000000-0000-0000-0000-000000000001";
    let { data: oauthTok } = await svc
      .from("google_drive_oauth_tokens")
      .select("account")
      .eq("tenant_id", tenantId)
      .eq("provider", "GOOGLE_DRIVE")
      .maybeSingle();
    // Platform admins act under the global tenant while the stored token may
    // live under a specific tenant (or none) — match getDriveClient's fallback
    // so the reported account stays accurate.
    if (!oauthTok?.account) {
      ({ data: oauthTok } = await svc
        .from("google_drive_oauth_tokens")
        .select("account")
        .eq("provider", "GOOGLE_DRIVE")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle());
    }

    const { data: folders } = await svc.from("storage_folders").select("*").eq("provider", "GOOGLE_DRIVE");
    const { data: objects } = await svc.from("storage_objects").select("id, mime_type, size_bytes, created_at, is_deleted").eq("provider", "GOOGLE_DRIVE");

    const totalFiles = (objects || []).length;
    const totalSize = (objects || []).reduce((sum, o) => sum + (o.size_bytes || 0), 0);
    const activeFiles = (objects || []).filter(o => !o.is_deleted).length;

    const byType = {};
    (objects || []).forEach(o => {
      const t = o.mime_type || 'unknown';
      byType[t] = (byType[t] || 0) + 1;
    });

    let driveConnected = false;
    let lastError = null;
    try {
      const drive = await getDriveClient(svc, tenantId);
      await drive.files.list({ pageSize: 1, fields: 'files(id)' });
      driveConnected = true;
    } catch (e) {
      driveConnected = false;
      lastError = String(e).includes('EXAMPRO_DRIVE') ? 'Google Drive is not connected.' : String(e);
    }

    // drive-health contract (storage-repair spec §9): explicit status field;
    // account is reported ONLY for a real connection (never a hardcoded
    // fallback email); classified failures map to reauthorization_required /
    // provider_unavailable.
    const status =
      driveConnected ? 'healthy'
        : /reauthoriz|expired|invalid_grant|refresh/i.test(lastError || '') ? 'reauthorization_required'
        : /provider|unavailable|network|fetch|5\d\d/i.test(lastError || '') ? 'provider_unavailable'
        : 'not_connected';

    return j(200, {
      connected: driveConnected,
      status,
      provider: "GOOGLE_DRIVE",
      account: driveConnected
        ? (oauthTok?.account || Deno.env.get("GOOGLE_DRIVE_CLIENT_EMAIL") || null)
        : null,
      rootFolder: folders?.find(f => f.folder_type === 'ROOT'),
      folders: folders || [],
      stats: {
        totalFiles,
        activeFiles,
        totalSizeBytes: totalSize,
        byMimeType: byType,
      },
      lastError,
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
