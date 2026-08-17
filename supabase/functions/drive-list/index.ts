// ExamPro Edge Function: drive-list
// Lists files in a Drive folder.
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

    const { folderId = 'root', pageSize = 1000 } = await req.json();

    // restrict listing to the global folder catalog (or root) for members,
    // preventing arbitrary Drive folder enumeration
    if (folderId !== 'root') {
      const { data: known } = await svc.from("storage_folders").select("drive_folder_id").eq("drive_folder_id", folderId).maybeSingle();
      if (!known) return j(403, { error: "forbidden" }, cors);
    }

    const drive = await getDriveClient(svc, null);

    const res = await drive.files.list({
      q: `'${folderId}' in parents and trashed=false`,
      fields: 'files(id, name, mimeType, size, createdTime, modifiedTime), nextPageToken',
      pageSize,
      orderBy: 'name',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });

    return j(200, { files: res.data.files || [], nextPageToken: res.data.nextPageToken }, cors);
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
