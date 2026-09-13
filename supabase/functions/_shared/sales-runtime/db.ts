import { createClient } from "npm:@supabase/supabase-js@2.108.2";
export type DB = ReturnType<typeof database>;
export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
export const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
export const database = () =>
  createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
export async function must<T>(
  query: PromiseLike<{ data: T; error: unknown }>,
): Promise<T> {
  const { data, error } = await query;
  if (error) throw new Error("database_operation_failed");
  return data;
}
export const rpc = (db: DB, name: string, args: Record<string, unknown> = {}) =>
  must(db.rpc(name, args));
export async function operator(db: DB, request: Request, level = "manage") {
  const token = (request.headers.get("Authorization") || "").replace(
    /^Bearer\s+/i,
    "",
  );
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) return null;
  const allowed = await rpc(db, "has_admin_section_access", {
    _user_id: data.user.id,
    _section_code: "communication",
    _min_level: level,
  });
  return allowed ? data.user : null;
}

export async function read<T>(
  query: PromiseLike<{ data: T; error: unknown }>,
): Promise<NonNullable<T>> {
  const data = await must(query);
  if (data == null) throw Error("required_data_missing");
  return data;
}
