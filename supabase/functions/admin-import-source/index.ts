// ExamPro Edge Function: admin-import-source
// Ingests an authorized source PDF: uploads to Google Drive, creates a
// source_documents record, and returns the Drive file ID for the parser.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { Readable } from "node:stream";
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

    const contentType = req.headers.get("content-type") || "";
    let fileName, fileBuffer, examId, year, session, shift, title, sourceUrl;

    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (!file) return j(400, { error: "file is required" }, cors);
      fileName = file.name;
      fileBuffer = new Uint8Array(await file.arrayBuffer());
      examId = (form.get("examId") as string) || null;
      year = (form.get("year") as string) || null;
      session = (form.get("session") as string) || null;
      shift = (form.get("shift") as string) || null;
      title = (form.get("title") as string) || fileName;
      sourceUrl = (form.get("sourceUrl") as string) || null;
    } else {
      const body = await req.json();
      const fileData = body.file;
      if (!fileData || !fileData.name) return j(400, { error: "file.name is required" }, cors);
      fileName = fileData.name;
      const b64 = fileData.content?.replace(/^data:.+;base64,/, "") || fileData.content;
      fileBuffer = b64 ? Uint8Array.from(atob(b64), c => c.charCodeAt(0)) : new Uint8Array();
      examId = body.examId || null;
      year = body.year || null;
      session = body.session || null;
      shift = body.shift || null;
      title = body.title || fileName;
      sourceUrl = body.sourceUrl || null;
    }

    const mimeType = guessMimeType(fileName);
    if (!isSupportedMimeType(mimeType)) {
      return j(415, { error: `Unsupported MIME type: ${mimeType}` }, cors);
    }

    const sha256 = await computeSha256(fileBuffer);
    const sizeBytes = fileBuffer.length;

    const { data: existing } = await svc.from("storage_objects")
      .select("*").eq("sha256", sha256).eq("is_deleted", false).maybeSingle();
    if (existing) {
      return j(200, { existing: true, object: existing, message: "Duplicate file — reusing existing Drive copy" }, cors);
    }

    const driveFile = await uploadToDrive(fileName, fileBuffer, mimeType, svc);
    const { data: sourceDoc } = await svc.from("source_documents").insert({
      exam_id: examId,
      year: year ? parseInt(year) : null,
      session: session || null,
      shift: shift || null,
      title,
      source_url: sourceUrl,
      drive_file_id: driveFile.id,
      sha256,
      page_count: 0,
      language: 'EN',
      status: 'INGESTED',
      parser_version: 'v1',
      created_by: userId,
    }).select("id").single();

    const { data: obj } = await svc.from("storage_objects").insert({
      tenant_id: null,
      provider: "GOOGLE_DRIVE",
      drive_file_id: driveFile.id,
      drive_parent_id: driveFile.parentId,
      object_key: driveFile.name,
      original_filename: fileName,
      mime_type: mimeType,
      size_bytes: sizeBytes,
      sha256,
      source_document_id: sourceDoc?.id,
      uploaded_by: userId,
      web_view_link: driveFile.webViewLink,
    }).select("id").single();

    return j(200, {
      created: true,
      source_document_id: sourceDoc?.id,
      storage_object_id: obj?.id,
      drive_file_id: driveFile.id,
      webViewLink: driveFile.webViewLink,
      sha256,
      sizeBytes,
    }, cors);
  } catch (e) {
    console.error('[' + Deno.env.get('SUPABASE_FUNCTION_NAME') + '] error:', e);
    return j(500, { error: 'internal error' }, cors);
  }
});

async function uploadToDrive(fileName, buffer, mimeType, svc) {
  const drive = await getDriveClient(svc, null);

  const parts = "source-documents".split("/").filter(Boolean);
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

function guessMimeType(fileName) {
  const ext = fileName.split('.').pop()?.toLowerCase();
  const map = {
    pdf: 'application/pdf',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    csv: 'text/csv',
    json: 'application/json',
    jsonl: 'application/jsonl',
    zip: 'application/zip',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  };
  return map[ext || ''] || 'application/octet-stream';
}

function isSupportedMimeType(mimeType) {
  const supported = new Set([
    'application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/svg+xml',
    'text/csv', 'application/json', 'application/jsonl', 'application/zip',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/octet-stream',
  ]);
  return supported.has(mimeType);
}

function j(code: number, body: any, headers: any) {
  return new Response(JSON.stringify(body), { status: code, headers: { ...headers, "Content-Type": "application/json" } });
}
