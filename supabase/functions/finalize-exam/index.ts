// ExamPro Edge Function: finalize-exam
// Server-authoritative exam finalization + evaluation. Never trusts the browser timer.
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

    const { session_id } = await req.json();
    if (!session_id) return j(400, { error: "session_id required" }, cors);

    // verify ownership / tenant
    const { data: sess } = await svc.from("exam_sessions")
      .select("id, student_id, tenant_id, ends_at, submitted_at")
      .eq("id", session_id).single();
    if (!sess) return j(404, { error: "session not found" }, cors);
    const { data: tm } = await svc.from("tenant_memberships")
      .select("tenant_id").eq("user_id", userId).eq("status", "ACTIVE");
    const allowed = sess.student_id === userId || (tm ?? []).some((m: any) => m.tenant_id === sess.tenant_id);
    if (!allowed) return j(403, { error: "forbidden" }, cors);

    const { data: rid } = await svc.rpc("app_finalize_session", { p_session_id: session_id });
    return j(200, { result_id: rid }, cors);
  } catch (e) {
    console.error('[' + Deno.env.get('SUPABASE_FUNCTION_NAME') + '] error:', e);
    return j(500, { error: 'internal error' }, cors);
  }
});

function j(code: number, body: any, headers: any) {
  return new Response(JSON.stringify(body), { status: code, headers: { ...headers, "Content-Type": "application/json" } });
}
