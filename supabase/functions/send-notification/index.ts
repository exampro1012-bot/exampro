// ExamPro Edge Function: send-notification
// Creates an in-app notification row (Realtime delivers it to the client).
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

    const { tenant_id, user_id, title, body } = await req.json();
    if (!title || !body) return j(400, { error: "title and body are required" }, cors);

    // authz: platform admins may notify anyone; members only their own tenant
    const { data: tm } = await svc.from("tenant_memberships")
      .select("tenant_id").eq("user_id", userId).eq("status", "ACTIVE");
    const isAdmin = await svc.rpc("app_is_platform_admin", { p_user_id: userId }).then(r => r.data).catch(() => false);
    const memberTenants = (tm ?? []).map((m: any) => m.tenant_id);
    if (!isAdmin && tenant_id && !memberTenants.includes(tenant_id)) return j(403, { error: "forbidden" }, cors);
    if (!isAdmin && !tenant_id && user_id !== userId) return j(403, { error: "forbidden" }, cors);

    const { error } = await svc.from("notifications").insert({
      tenant_id: tenant_id ?? null, user_id: user_id ?? null, title, body,
    });
    if (error) return j(500, { error: error.message }, cors);
    return j(200, { ok: true }, cors);
  } catch (e) {
    console.error('[' + Deno.env.get('SUPABASE_FUNCTION_NAME') + '] error:', e);
    return j(500, { error: 'internal error' }, cors);
  }
});

function j(code: number, body: any, headers: any) {
  return new Response(JSON.stringify(body), { status: code, headers: { ...headers, "Content-Type": "application/json" } });
}
