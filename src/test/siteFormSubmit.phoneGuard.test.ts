import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import path from "node:path";
import ts from "typescript";
import { resolveServerFormSettings } from "../../supabase/functions/site-form-submit/form_settings";
import { validateQuestionnaireAnswers } from "../../supabase/functions/site-form-submit/questionnaire-fields";
import { parseQuestionnaireSource } from "../../supabase/functions/site-form-submit/questionnaire-source";
import { validateConfiguredPhoneAnswers } from "../../supabase/functions/_shared/phone-validation";

const source = readFileSync(path.resolve(__dirname, "../../supabase/functions/site-form-submit/index.ts"), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

describe("real site-form-submit phone guard", () => {
  it.each(["legacy", "auth", "questionnaire"])("rejects a one-digit phone before any write on %s path", async mode => {
    let handler: (request: Request) => Promise<Response> = () => { throw new Error("handler missing"); };
    const insert = vi.fn();
    const update = vi.fn();
    const rpc = vi.fn();
    const getUser = vi.fn();
    const page = { id: "page", status: "published", workspace_id: "workspace", blocks: [{
      id: "form", type: "form", content: { auth_mode: mode !== "legacy", questionnaire_first: mode === "questionnaire",
        fields: [{ label: "Телефон", type: "phone", mapping: "phone", required: true }] },
    }] };
    const from = vi.fn(() => {
      const chain: any = { select: () => chain, eq: () => chain, single: async () => ({ data: page, error: null }), insert, update };
      return chain;
    });
    const admin = { from, rpc, auth: { getUser } };
    runInNewContext(compiled, {
      exports: {}, Response, Request, console,
      Deno: { env: { get: () => "test-only" }, serve: (fn: typeof handler) => { handler = fn; } },
      require: (module: string) => {
        if (module.startsWith("https://esm.sh/")) return { createClient: () => admin };
        if (module === "./form_settings.ts") return { resolveServerFormSettings };
        if (module === "./questionnaire-fields.ts") return { validateQuestionnaireAnswers };
        if (module === "./questionnaire-source.ts") return { parseQuestionnaireSource };
        if (module === "../_shared/phone-validation.ts") return { validateConfiguredPhoneAnswers };
        throw new Error(`Unexpected import: ${module}`);
      },
    });
    const response = await handler(new Request("https://example.invalid", { method: "POST", body: JSON.stringify({
      page_id: "page", block_id: "form", fields: [{ label: "Телефон", type: "text", mapping: "none", value: "1" }],
    }) }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "phone_invalid" });
    expect(from).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledWith("site_pages");
    for (const write of [insert, update, rpc, getUser]) expect(write).not.toHaveBeenCalled();
  });
});
