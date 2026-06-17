import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

Deno.serve(async (_req) => {
  console.log("hit");
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
  console.log("calling rpc");
  try {
    const { data, error } = await admin.rpc("_proof_stage3_call_atomic", {
      p_uid: "05cd3754-d589-4d90-97d1-89ba2bee610b",
      p_session_id: "b0b229b7-cf7e-4869-988e-8e97bdf54043",
      p_item_id: "dac9d7b2-7905-492d-8d30-959395dbebef",
      p_field_values: [{ field_catalog_id: "76e082af-5511-45dc-b2a3-258f13911ebc", value: "2026-06-17" }],
      p_role_assignments: [],
      p_expected_version: null,
    });
    console.log("rpc done", JSON.stringify({ data, error }));
    return new Response(JSON.stringify({ data, error: error?.message ?? null }), {
      headers: { "content-type": "application/json" },
    });
  } catch (e) {
    console.log("exception", String(e));
    return new Response(JSON.stringify({ ex: String(e) }), { status: 500 });
  }
});
