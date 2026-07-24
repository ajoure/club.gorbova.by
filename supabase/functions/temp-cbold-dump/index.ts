import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
  const { data, error } = await supabase
    .from("site_pages")
    .select("blocks")
    .eq("id", "e3c79f1c-947a-49ec-88be-6cebdfe19f35")
    .single();
  if (error) return new Response(error.message, { status: 500 });
  const code = data.blocks?.[0]?.content?.code ?? "";
  return new Response(code, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
});
