import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { resolveServerFormSettings } from "../../supabase/functions/site-form-submit/form_settings";

const form = (id: string, content: Record<string, unknown>) => ({ id, type: "form", content });
const handler = readFileSync(path.resolve(
  __dirname,
  "..",
  "..",
  "supabase",
  "functions",
  "site-form-submit",
  "index.ts",
), "utf8");

describe("site-form-submit server form configuration", () => {
  it("resolves configuration from the server before the first submission write", () => {
    const configIndex = handler.indexOf("resolveServerFormSettings(page.blocks, body.block_id)");
    const submissionInsertIndex = handler.indexOf('.from("site_form_submissions")');

    expect(configIndex).toBeGreaterThanOrEqual(0);
    expect(submissionInsertIndex).toBeGreaterThan(configIndex);
    expect(handler).not.toMatch(/auth_mode\?: boolean/);
    expect(handler).not.toMatch(/deal_creation_enabled\?: boolean/);
    expect(handler).not.toMatch(/pipeline_id\?: string/);
  });

  it("uses the selected published form block instead of browser-provided settings", () => {
    const result = resolveServerFormSettings([
      form("form-a", {
        auth_mode: false,
        product_binding_enabled: true,
        product_id: "product-a",
        tariff_id: "tariff-a",
        deal_creation_enabled: true,
        pipeline_id: "pipeline-a",
        pipeline_stage_id: "stage-a",
      }),
      form("form-b", { auth_mode: true, deal_creation_enabled: false }),
    ], "form-a");

    expect(result).toEqual({
      authMode: false,
      productId: "product-a",
      tariffId: "tariff-a",
      dealCreationEnabled: true,
      pipelineId: "pipeline-a",
      pipelineStageId: "stage-a",
    });
  });

  it("does not guess a CRM destination when a multi-form page has no block ID", () => {
    expect(resolveServerFormSettings([
      form("form-a", { deal_creation_enabled: true, pipeline_id: "pipeline-a" }),
      form("form-b", { deal_creation_enabled: true, pipeline_id: "pipeline-b" }),
    ])).toBeNull();
  });

  it("keeps a one-form page compatible with a cached client that has no block ID", () => {
    expect(resolveServerFormSettings([
      { id: "text-1", type: "text", content: {} },
      form("form-a", { auth_mode: true, product_binding_enabled: false }),
    ])).toEqual({
      authMode: true,
      productId: undefined,
      tariffId: undefined,
      dealCreationEnabled: false,
      pipelineId: undefined,
      pipelineStageId: undefined,
    });
  });

  it("does not enable product or deal settings without their server-side flags", () => {
    expect(resolveServerFormSettings([
      form("form-a", {
        product_id: "product-a",
        tariff_id: "tariff-a",
        pipeline_id: "pipeline-a",
        pipeline_stage_id: "stage-a",
      }),
    ], "form-a")).toEqual({
      authMode: false,
      productId: undefined,
      tariffId: undefined,
      dealCreationEnabled: false,
      pipelineId: undefined,
      pipelineStageId: undefined,
    });
  });
});
