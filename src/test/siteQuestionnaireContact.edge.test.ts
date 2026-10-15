import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import path from "node:path";
import ts from "typescript";
import { resolveServerFormSettings } from "../../supabase/functions/site-form-submit/form_settings";
import { validateQuestionnaireAnswers } from "../../supabase/functions/site-form-submit/questionnaire-fields";
import { parseQuestionnaireSource } from "../../supabase/functions/site-form-submit/questionnaire-source";
import { validateConfiguredPhoneAnswers } from "../../supabase/functions/site-form-submit/phone-validation";
import { isQuestionnaireContactField } from "../../supabase/functions/site-form-submit/questionnaire-contacts";
const compiled = ts.transpileModule(readFileSync(path.resolve(__dirname, "../../supabase/functions/site-form-submit/index.ts"), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const fields = [
  { label: "Email", type: "email", mapping: "email", required: true },
  { label: "Телефон", type: "phone", mapping: "phone", required: true },
  { label: "Instagram", type: "text", mapping: "instagram_url", required: true },
  { label: "Вопрос", type: "textarea", required: true },
];
function harness(enabled = true, confirmed = true) {
  let handler: (request: Request) => Promise<Response> = () => { throw new Error("missing handler"); };
  const rpc = vi.fn().mockResolvedValue({ data: { success: true, contact_saved: true }, error: null });
  const getUser = vi.fn().mockResolvedValue({ data: { user: { id: id(3), email: "owner@example.invalid", email_confirmed_at: confirmed ? "2026-01-01" : null } }, error: null });
  const page = { status: "published", blocks: [{ id: id(2), type: "form", content: { auth_mode: true, questionnaire_first: true, contact_first: enabled, fields } }] };
  const admin = { auth: { getUser }, rpc, from: () => {
    const chain = { select: () => chain, eq: () => chain, single: async () => ({ data: page, error: null }) }; return chain;
  } };
  const imports = { "./form_settings.ts": { resolveServerFormSettings }, "./questionnaire-fields.ts": { validateQuestionnaireAnswers },
    "./questionnaire-source.ts": { parseQuestionnaireSource }, "./phone-validation.ts": { validateConfiguredPhoneAnswers },
    "./questionnaire-contacts.ts": { isQuestionnaireContactField } };
  runInNewContext(compiled, { exports: {}, Request, Response, console,
    Deno: { env: { get: () => "test-only" }, serve: (fn: typeof handler) => { handler = fn; } },
    require: (name: string) => name.startsWith("https://esm.sh/") ? { createClient: () => admin } : imports[name as keyof typeof imports],
  });
  const send = (changes = {}, token = true) => handler(new Request("https://example.invalid", {
    method: "POST", headers: token ? { Authorization: "Bearer owner-session" } : {}, body: JSON.stringify({
      action: "questionnaire_contact", page_id: id(1), block_id: id(2), submission_key: id(4),
      privacy_consent: { accepted: true, version: "v2026-04-10" },
      fields: fields.slice(0, 3).map((field, i) => ({ ...field, value: ["owner@example.invalid", "+375291234567", "own.profile"][i] })), ...changes,
    }),
  }));
  return { send, rpc, getUser };
}
describe("contact-first Edge boundary", () => {
  it("saves only configured contacts using the JWT owner without requiring survey answers", async () => {
    const { send, rpc } = harness();
    expect((await send({ user_id: id(99) })).status).toBe(200);
    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc.mock.calls[0][0]).toBe("save_site_questionnaire_contact");
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_user_id: id(3), p_page_id: id(1), p_block_id: id(2), p_submission_key: id(4) });
    expect(rpc.mock.calls[0][1].p_fields).toHaveLength(3);
  });
  it("rejects missing or unconfirmed identity, wrong email and unconfigured mode before any write", async () => {
    const missing = harness(); expect((await missing.send({}, false)).status).toBe(401); expect(missing.rpc).not.toHaveBeenCalled();
    const unconfirmed = harness(true, false); expect((await unconfirmed.send()).status).toBe(401); expect(unconfirmed.rpc).not.toHaveBeenCalled();
    const disabled = harness(false); expect((await disabled.send()).status).toBe(400); expect(disabled.rpc).not.toHaveBeenCalled();
    const foreign = harness(); expect((await foreign.send({ fields: fields.slice(0, 3).map((field, i) => ({ ...field, value: ["foreign@example.invalid", "+375291234567", "own"][i] })) })).status).toBe(400); expect(foreign.rpc).not.toHaveBeenCalled();
  });
  it("rejects a disguised one-digit phone before calling Auth or the RPC", async () => {
    const { send, rpc, getUser } = harness();
    expect((await send({ fields: [{ label: "Телефон", type: "text", mapping: "none", value: "1" }] })).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled(); expect(getUser).not.toHaveBeenCalled();
  });
});
