// Execute the checked-in Deno entrypoint with an isolated client and synthetic data.
import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

const source = readFileSync("supabase/functions/broadcast-audience-preview/index.ts", "utf8")
  .replace(/^import .*;\n/gm, "");
const executable = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
function fixture(count = 59, permitted = true) {
  let handle!: (req: Request) => Promise<Response>;
  const profiles = Array.from({ length: count }, (_, i) => ({
    id: String(i).padStart(5, "0"), user_id: `user-${i}`, full_name: "Same name",
    email: null, telegram_username: `test_${i}`, telegram_user_id: i + 1, is_archived: false, status: "active",
  }));
  const rpc = vi.fn((name, args) => {
    if (name === "resolve_broadcast_audience_user_ids_system") return {
      order: () => ({ range: async (start: number, end: number) => ({ data: profiles.slice(start, end + 1), error: null }) }),
    };
    if (name === "resolve_broadcast_audience") return Promise.resolve({ data: {
      page_offset: args._filters.__preview_offset, page_limit: args._filters.__preview_limit,
      total_count: count, users: profiles.slice(args._filters.__preview_offset, args._filters.__preview_offset + args._filters.__preview_limit),
    }, error: null });
    return Promise.resolve({ data: permitted, error: null });
  });
  const admin = { rpc, from: () => ({ select: () => ({ in: async (_key: string, ids: string[]) => ({ data: profiles.filter(p => ids.includes(p.user_id)), error: null }) }) }) };
  const client = vi.fn().mockReturnValueOnce({ auth: { getClaims: async () => ({ data: { claims: { sub: "operator" } }, error: null }) } }).mockReturnValue(admin);
  const education = vi.fn(async (_db, ids: string[]) => new Set(ids));
  new Function("createClient", "filterUsersByEducationCondition", "Deno", executable)(client, education, {
    env: { get: () => "synthetic-test" }, serve: (handler: typeof handle) => { handle = handler; },
  });
  const request = (body: object, auth = true) => handle(new Request("https://example.invalid", {
    method: "POST", headers: auth ? { Authorization: "Bearer synthetic-test" } : {}, body: JSON.stringify(body),
  }));
  return { request, rpc, education };
}

describe("broadcast audience preview endpoint", () => {
  it("passes an explicit offset while overriding untrusted internal pagination fields", async () => {
    const { request, rpc } = fixture();
    const response = await request({ page_offset: 50, filters: { include: ["selected"], __preview_offset: 0, __preview_limit: 99999 } });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ page_offset: 50, page_limit: 50, users: expect.any(Array) });
    expect(rpc).toHaveBeenLastCalledWith("resolve_broadcast_audience", { _filters: { include: ["selected"], __system_bypass: true, __preview_offset: 50, __preview_limit: 50 } });
  });
  it.each([{ page_offset: -1 }, { page_offset: 0.5 }, { page_limit: 101 }, { page_limit: "50" }])("rejects invalid page %j", async body => {
    const { request, rpc } = fixture();
    expect((await request(body)).status).toBe(400);
    expect(rpc.mock.calls.some(([name]) => name.startsWith("resolve_"))).toBe(false);
  });
  it("paginates education results beyond 100 and reads candidate batches beyond 200", async () => {
    const { request, education } = fixture(259);
    const response = await request({ page_offset: 250, filters: { education: { lesson_id: "test" } } });
    const result = await response.json();
    expect(result.total_count).toBe(259);
    expect(result.users).toHaveLength(9);
    expect(result.users[8].id).toBe("00258");
    expect(education).toHaveBeenCalledTimes(2);
  });
  it("requires authentication and section permissions before audience queries", async () => {
    const { request, rpc } = fixture(59, false);
    expect((await request({}, false)).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
    expect((await request({})).status).toBe(403);
    expect(rpc.mock.calls.some(([name]) => name.startsWith("resolve_"))).toBe(false);
  });
});
