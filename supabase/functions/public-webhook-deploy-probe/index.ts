// public-webhook-deploy-probe
// ============================================================
// Canary Edge Function для PATCH-LOVABLE-PUBLIC-WEBHOOK-DEPLOY-V1.
//
// Назначение: проверить, что Lovable agent-deploy публикует функцию с
// verify_jwt = false (как объявлено в supabase/config.toml), и что
// повторный redeploy не включает платформенный JWT-wall.
//
// Эта функция:
//   - НЕ читает и НЕ пишет БД;
//   - НЕ использует никаких secrets;
//   - НЕ содержит бизнес-логики;
//   - не имеет внешних зависимостей кроме Deno.serve и CORS.
//
// Контракт ответа:
//   200 { ok: true, probe: "public-webhook-deploy-v1", method, ts }
//
// Маркер версии (`probe`) меняется ТОЛЬКО в рамках Approve C4
// (повторный controlled redeploy) на `public-webhook-deploy-v2`,
// и обратно на `v1` в проверке recovery (Approve D).
//
// После закрытия PATCH функция должна быть удалена отдельным cleanup-step
// (supabase--delete_edge_functions ["public-webhook-deploy-probe"]).
// ============================================================

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const PROBE_MARKER = "public-webhook-deploy-v1";

Deno.serve((req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const body = {
    ok: true,
    probe: PROBE_MARKER,
    method: req.method,
    ts: new Date().toISOString(),
  };

  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
