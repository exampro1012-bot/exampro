// ExamPro Edge Function: drive-upload
// Server-side file upload to Google Drive with tenant isolation, duplicate detection,
// and storage_objects record creation. Never exposes credentials to the browser.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { Readable } from "node:stream";
import { getDriveClient } from "../_shared/drive-auth.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPPORTED_MIME_TYPES = new Set([
  'application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/svg+xml',
  'text/csv', 'text/plain', 'application/json', 'application/jsonl', 'application/zip',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/octet-stream',
]);

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

    const contentType = req.headers.get("content-type") || "";
    let fileName, fileBuffer, folderPath, tenantId, mimeType, extra;

    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (!file) return j(400, { error: "file is required" }, cors);
      fileName = file.name;
      fileBuffer = new Uint8Array(await file.arrayBuffer());
      folderPath = (form.get("folderPath") as string) || "";
      tenantId = (form.get("tenantId") as string) || "";
      mimeType = file.type || "application/octet-stream";
      extra = {
        questionId: form.get("questionId") as string || null,
        paperId: form.get("paperId") as string || null,
        sourceDocumentId: form.get("sourceDocumentId") as string || null,
        force: form.get("force") === "true",
      };
    } else {
      const body = await req.json();
      const fileData = body.file;
      if (!fileData || !fileData.name) return j(400, { error: "file.name is required" }, cors);
      fileName = fileData.name;
      const b64 = fileData.content?.replace(/^data:.+;base64,/, "") || fileData.content;
      fileBuffer = b64 ? Uint8Array.from(atob(b64), c => c.charCodeAt(0)) : new Uint8Array();
      folderPath = body.folderPath || "";
      tenantId = body.tenantId || "";
      mimeType = fileData.mimeType || "application/octet-stream";
      extra = {
        questionId: body.questionId || null,
        paperId: body.paperId || null,
        sourceDocumentId: body.sourceDocumentId || null,
        force: body.force || false,
      };
    }

    if (!SUPPORTED_MIME_TYPES.has(mimeType)) {
      return j(415, { error: `Unsupported MIME type: ${mimeType}` }, cors);
    }

    const sha256 = await computeSha256(fileBuffer);
    const sizeBytes = fileBuffer.length;

    const { data: existing } = await svc.from("storage_objects")
      .select("*").eq("sha256", sha256).eq("is_deleted", false).maybeSingle();
    if (existing && !extra.force) {
      return j(200, { existing: true, object: existing }, cors);
    }

    const driveFile = await uploadToDrive(fileName, fileBuffer, folderPath, tenantId, mimeType, svc);
    const { data: obj, error } = await svc.from("storage_objects").insert({
      tenant_id: tenantId || null,
      provider: "GOOGLE_DRIVE",
      drive_file_id: driveFile.id,
      drive_parent_id: driveFile.parentId,
      object_key: driveFile.name,
      original_filename: fileName,
      mime_type: mimeType,
      size_bytes: sizeBytes,
      sha256,
      question_id: extra.questionId,
      paper_id: extra.paperId,
      source_document_id: extra.sourceDocumentId,
      uploaded_by: userId,
      web_view_link: driveFile.webViewLink,
      checksum: sha256,
    }).select("id, drive_file_id, object_key, sha256, created_at").single();

    if (error) return j(500, { error: error.message }, cors);
    return j(200, { created: true, object: obj, drive: driveFile }, cors);
  } catch (e) {
    console.error('[' + Deno.env.get('SUPABASE_FUNCTION_NAME') + '] error:', e);
    const _m = String((e && e.message) || e || '');
    if (_m.includes('EXAMPRO_DRIVE_NOT_CONFIGURED') || _m.includes('EXAMPRO_DRIVE_OAUTH_INCOMPLETE')) {
      return j(503, { error: 'Google Drive is not connected.' }, cors);
    }
    return j(500, { error: 'internal error' }, cors);
  }
});

async function uploadToDrive(fileName, buffer, folderPath, tenantId, mimeType, svc) {
  const drive = await getDriveClient(svc, tenantId);

  const normalizedPath = (folderPath || `tenant-${tenantId || 'global'}`).replace(/\\/g, '/');
  const parts = normalizedPath.split('/').filter(Boolean);
  let currentParent = 'root';

  for (const part of parts) {
    const q = `'${currentParent}' in parents and name='${part.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
    const res = await drive.files.list({ q, fields: 'files(id)', pageSize: 1 });
    if (res.data.files.length > 0) {
      currentParent = res.data.files[0].id;
    } else {
      const created = await drive.files.create({
        resource: { name: part, mimeType: 'application/vnd.google-apps.folder', parents: [currentParent] },
        fields: 'id',
      });
      currentParent = created.data.id;
    }
  }

  const ext = fileName.includes('.') ? fileName.slice(fileName.lastIndexOf('.')) : '';
  const base = fileName.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
  const ts = Date.now().toString(36);
  const driveName = `${base}_${ts}${ext}`;

  const file = await drive.files.create({
    resource: { name: driveName, parents: [currentParent], mimeType },
    media: { mimeType, body: Readable.from([buffer]) },
    fields: 'id, name, mimeType, size, webViewLink, webContentLink, parents',
  });
  return { id: file.data.id, name: file.data.name, parentId: currentParent, webViewLink: file.data.webViewLink };
}

async function computeSha256(buffer) {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', buffer));
  return Array.from(hash).map(b => b.toString(16).padStart(2, '0')).join('');
}

function j(code: number, body: any, headers: any) {
  return new Response(JSON.stringify(body), { status: code, headers: { ...headers, "Content-Type": "application/json" } });
}
