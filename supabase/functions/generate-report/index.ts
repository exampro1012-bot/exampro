// ExamPro Edge Function: generate-report
// Aggregated student / tenant analytics using indexed aggregate queries (no full scans).
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

    const { type, student_id, tenant_id } = await req.json();

    const { data: tm } = await svc.from("tenant_memberships")
      .select("tenant_id").eq("user_id", userId).eq("status", "ACTIVE");
    const memberTenants = (tm ?? []).map((m: any) => m.tenant_id);
    const isAdmin = await svc.rpc("app_is_platform_admin", { p_user_id: userId }).then(r => r.data).catch(() => false);

    if (type === "student") {
      const sid = student_id ?? userId;
      if (!isAdmin && sid !== userId) return j(403, { error: "forbidden" }, cors);
      const { data: results } = await svc.from("results")
        .select("marks, percentage, accuracy, correct, incorrect, unanswered, created_at")
        .eq("student_id", sid).order("created_at", { ascending: false }).limit(50);
      const { data: weak } = await svc.rpc("app_weak_topics", { p_user_id: sid, p_limit: 10 });
      return j(200, { results: results ?? [], weak_topics: weak ?? [] }, cors);
    }

    if (type === "tenant") {
      if (!isAdmin && !(tenant_id && memberTenants.includes(tenant_id))) return j(403, { error: "forbidden" }, cors);
      const { data: agg } = await svc.from("usage")
        .select("metric, count, period").eq("tenant_id", tenant_id);
      const { data: students } = await svc.from("students")
        .select("id", { count: "exact", head: true }).eq("tenant_id", tenant_id);
      return j(200, { usage: agg ?? [], student_count: students?.length ?? 0 }, cors);
    }

    return j(400, { error: "unknown report type" }, cors);
  } catch (e) {
    console.error('[' + Deno.env.get('SUPABASE_FUNCTION_NAME') + '] error:', e);
    return j(500, { error: 'internal error' }, cors);
  }
});

function j(code: number, body: any, headers: any) {
  return new Response(JSON.stringify(body), { status: code, headers: { ...headers, "Content-Type": "application/json" } });
}
