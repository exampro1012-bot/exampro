// ExamPro Edge Function: drive-save-paper
// Generates a printable paper PDF (HTML-based) and uploads to Google Drive.
// Called from the paper view page.
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

    const { paper_id, kind = "paper" } = await req.json();
    if (!paper_id) return j(400, { error: "paper_id is required" }, cors);

    const { data: paper } = await svc.from("papers").select("*").eq("id", paper_id).maybeSingle();
    if (!paper) return j(404, { error: "paper not found" }, cors);

    const { data: qs } = await svc.from("paper_questions").select("question_order, marks, negative_marks, snapshot").eq("paper_id", paper_id).order("question_order");
    if (!qs || qs.length === 0) return j(400, { error: "paper has no questions" }, cors);

    const tenantId = paper.tenant_id;
    const { data: tm } = await svc.from("tenant_memberships")
      .select("tenant_id, role_id").eq("user_id", userId).eq("status", "ACTIVE").limit(1);
    const memberTenant = tm && tm.length > 0 ? tm[0].tenant_id : null;
    const isAdmin = tm && tm.length > 0 && await svc.rpc("app_is_platform_admin", { p_user_id: userId }).then(r => r.data).catch(() => false);
    if (!isAdmin && tenantId !== memberTenant) return j(403, { error: "forbidden" }, cors);

    let branding = null;
    if (tenantId) {
      const { data: t } = await svc.from("tenants").select("name,logo_url,address,header_text,footer_text").eq("id", tenantId).maybeSingle();
      if (t) branding = t;
    }

    const html = buildPaperHtml(paper, qs, branding, kind);
    const htmlBuffer = new TextEncoder().encode(html);

    const drive = await getDriveClient(svc, tenantId);

    const folderPath = kind === "answer-key" ? "answer-keys" : kind === "solutions" ? "generated-solutions" : "generated-papers";
    const tenantPath = tenantId ? `tenant-${tenantId}` : "global";
    const fullPath = `${folderPath}/${tenantPath}`;

    const parts = fullPath.split('/').filter(Boolean);
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

    const ext = kind === "answer-key" ? "-answer-key.html" : kind === "solutions" ? "-solutions.html" : ".html";
    const fileName = `${paper.title.replace(/[^a-zA-Z0-9_-]/g, '_')}${ext}`;
    const media = Readable.from([htmlBuffer]);

    const file = await drive.files.create({
      resource: { name: fileName, parents: [currentParent], mimeType: 'text/html' },
      media: { mimeType: 'text/html', body: media },
      fields: 'id, name, webViewLink, webContentLink, parents',
    });

    const driveFileId = file.data.id;
    const column = kind === "answer-key" ? "drive_answer_key_file_id" : kind === "solutions" ? "drive_solution_file_id" : "drive_file_id";
    await svc.from("papers").update({ [column]: driveFileId }).eq("id", paper_id);

    const { data: obj } = await svc.from("storage_objects").insert({
      tenant_id: tenantId,
      provider: "GOOGLE_DRIVE",
      drive_file_id: driveFileId,
      drive_parent_id: currentParent,
      object_key: fileName,
      original_filename: fileName,
      mime_type: "text/html",
      size_bytes: htmlBuffer.length,
      paper_id: paper_id,
      uploaded_by: userId,
      web_view_link: file.data.webViewLink,
    }).select("id").single();

    return j(200, {
      success: true,
      drive_file_id: driveFileId,
      storage_object_id: obj?.id,
      webViewLink: file.data.webViewLink,
      kind,
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

function buildPaperHtml(paper, questions, branding, kind) {
  const esc = (s: any) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
  const logo = branding?.logo_url ? `<img src="${esc(branding.logo_url)}" style="height:48px;object-fit:contain">` : '<div style="width:48px;height:48px;background:#1f3a5f;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;border-radius:8px">E</div>';
  const header = branding?.header_text ? esc(branding.header_text) : esc(paper.title);
  const footer = branding?.footer_text ? esc(branding.footer_text) : "ExamPro";
  const orgName = esc(branding?.name || "ExamPro");
  const address = esc(branding?.address || "");

  let body = "";
  if (kind === "answer-key") {
    body = "<h2>Answer Key</h2><ol>" + questions.map((pq, i) => {
      const sn = pq.snapshot || {};
      const ans = sn.answer || {};
      return `<li><b>Q${pq.question_order}:</b> ${esc(ans.correct_option_keys?.join(", ") || ans.numerical_answer || "â€”")}</li>`;
    }).join("") + "</ol>";
  } else if (kind === "solutions") {
    body = "<h2>Solutions</h2><ol>" + questions.map((pq, i) => {
      const sn = pq.snapshot || {};
      const ans = sn.answer || {}, sol = sn.solution || {};
      const answer = esc(ans.correct_option_keys?.join(", ") || ans.numerical_answer || "â€”");
      const solText = esc(sol.solution_text || sol.detailed_solution || sol.short_solution || sol.concept || "â€”");
      return `<li><b>Q${pq.question_order}:</b> Answer: ${answer}<br><b>Solution:</b> ${solText}</li>`;
    }).join("") + "</ol>";
  } else {
    body = questions.map((pq, i) => {
      const sn = pq.snapshot || {};
      const opts = (sn.options || []).map(o => `<li><b>${esc(o.option_key)}.</b> ${esc(o.option_text)}</li>`).join("");
      return `<div style="margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid #eee"><div style="font-weight:700;margin-bottom:6px">Q${pq.question_order}. (${pq.marks || 4} marks${pq.negative_marks ? ", âˆ’" + pq.negative_marks + " neg" : ""})</div><div>${esc(sn.question_text || "")}</div>${opts ? "<ol>" + opts + "</ol>" : ""}</div>`;
    }).join("");
  }

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${esc(paper.title)}</title><style>
    body { font-family: system-ui, sans-serif; max-width: 900px; margin: 0 auto; padding: 24px; color: #1d2733; }
    .print-head { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; padding-bottom: 8px; border-bottom: 2px solid #1f3a5f; }
    .ph-name { font-weight: 800; font-size: 18px; color: #1f3a5f; }
    .ph-sub { font-size: 12px; color: #6b7785; }
    .ph-meta { margin-left: auto; text-align: right; color: #6b7785; font-size: 12px; }
    .ph-footer { text-align: center; padding: 12px; color: #6b7785; font-size: 11px; border-top: 1px solid #eee; margin-top: 20px; }
    @page { size: A4; margin: 2cm; }
  </style></head><body>
    <div class="print-head">${logo}<div><div class="ph-name">${orgName}</div><div class="ph-sub">${header}</div></div><div class="ph-meta">${paper.duration_minutes || "â€”"} min Â· ${paper.total_marks || 0} marks Â· ${paper.total_questions || 0} questions</div></div>
    <div class="paper-body">${body}</div>
    <div class="ph-footer">${orgName} Â· ${address} Â· Page <span class="page-number"></span></div>
  </body></html>`;
}

function j(code: number, body: any, headers: any) {
  return new Response(JSON.stringify(body), { status: code, headers: { ...headers, "Content-Type": "application/json" } });
}
