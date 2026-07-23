import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..", "..");
const handler = readFileSync(path.join(root, "supabase", "functions", "vochi-webhook", "index.ts"), "utf8");
const config = readFileSync(path.join(root, "supabase", "config.toml"), "utf8");

describe("VOCHI webhook authentication", () => {
  it("declares the external webhook configuration and keeps custom auth in the handler", () => {
    expect(config).toMatch(/\[functions\.vochi-webhook\]\s*[\s\S]*?verify_jwt\s*=\s*false/);
    expect(handler).toContain('error: "webhook_token_not_configured"');
    expect(handler).toContain('if (!token || token !== expected)');
  });

  it("rejects missing or invalid credentials before any webhook event is written", () => {
    const tokenConfigIndex = handler.indexOf('const expectedRaw = (credRow.secrets as any)?.webhook_token');
    const rejectMissingIndex = handler.indexOf('error: "webhook_token_not_configured"');
    const rejectInvalidIndex = handler.indexOf('error: "invalid_signature"');
    const firstWriteIndex = handler.indexOf('.from("call_events").insert');

    expect(tokenConfigIndex).toBeGreaterThanOrEqual(0);
    expect(rejectMissingIndex).toBeGreaterThan(tokenConfigIndex);
    expect(rejectInvalidIndex).toBeGreaterThan(rejectMissingIndex);
    expect(firstWriteIndex).toBeGreaterThan(rejectInvalidIndex);
  });
});
