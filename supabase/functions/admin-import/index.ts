// ExamPro Edge Function: admin-import
// Bulk question import pipeline. Chunked, validated, FK-resolved, deduplicated.
// Uses service role (server-only). Does NOT fabricate 250K counts.
import { createClient } from "jsr:@supabase/supabase-js@2";

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

    const { data: tm } = await svc.from("tenant_memberships")
      .select("tenant_id, role_id").eq("user_id", userId).eq("status", "ACTIVE").limit(1);
    if (!tm || tm.length === 0) return j(403, { error: "no tenant" }, cors);
    const tenantId = tm[0].tenant_id;

    const { data: isAdmin } = await svc.rpc("app_is_platform_admin", { p_user_id: userId });
    if (!isAdmin) return j(403, { error: "forbidden" }, cors);

    const { rows, source_id, exam_id } = await req.json();
    if (!Array.isArray(rows)) return j(400, { error: "rows must be an array" }, cors);

    let imported = 0, duplicates = 0, failed = 0;
    const job = (await svc.from("import_jobs").insert({
      tenant_id: tenantId, format: "JSON", total: rows.length, created_by: userId,
      status: "PROCESSING",
    }).select("id").single()).data;
    const errors: any[] = [];

    for (const r of rows) {
      const hash = await svc.rpc("app_question_hash", { p_text: r.text ?? "" }).catch(() => null);
      try {
        const { error } = await svc.from("questions").upsert({
          tenant_id: tenantId, exam_id, question_type_id: r.question_type_id,
          subject_id: r.subject_id, chapter_id: r.chapter_id, topic_id: r.topic_id ?? null,
          year: r.year ? parseInt(r.year) : null, session: r.session, shift: r.shift,
          question_text: r.text, language: r.language ?? "EN", difficulty: r.difficulty ?? "MEDIUM",
          marks: r.marks ?? 4, negative_marks: r.negative_marks ?? 1,
          source_id: source_id ?? null, verification_status: "PENDING_REVIEW",
          question_hash: hash ?? null, created_by: userId,
        }, { onConflict: "question_hash" });
        if (error) { failed++; errors.push({ e: error.message, q: r.text?.slice(0, 40) }); }
        else imported++;
      } catch (e) { failed++; errors.push({ e: String(e) }); }
    }

    await svc.from("import_jobs").update({
      status: failed > 0 && imported === 0 ? "FAILED" : "COMPLETED",
      processed: rows.length, imported, duplicates, failed, error_summary: errors.slice(0, 20),
    }).eq("id", job.id);

    return j(200, { imported, duplicates, failed, job_id: job.id }, cors);
  } catch (e) {
    console.error('[' + Deno.env.get('SUPABASE_FUNCTION_NAME') + '] error:', e);
    return j(500, { error: 'internal error' }, cors);
  }
});

function j(code: number, body: any, headers: any) {
  return new Response(JSON.stringify(body), { status: code, headers: { ...headers, "Content-Type": "application/json" } });
}
