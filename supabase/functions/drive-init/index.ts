// ExamPro Edge Function: drive-init
// Initializes the ExamPro Drive folder hierarchy under the centralized storage account.
// Server-side only â€” never exposes credentials to the browser.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { getDriveClient, ensureExamProStructure } from "../_shared/drive-auth.ts";

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

    const drive = await getDriveClient(svc, "00000000-0000-0000-0000-000000000001");
    const structure = await ensureExamProStructure(drive, svc);
    const created = Object.entries(structure).map(([name, id]) => ({ name, drive_folder_id: id }));
    return j(200, { created, total: Object.keys(structure).length, provider: "GOOGLE_DRIVE" }, cors);
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
