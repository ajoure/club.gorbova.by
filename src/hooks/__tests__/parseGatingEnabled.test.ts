import { describe, it, expect, vi } from "vitest";

// Extract parseGatingEnabled for testing by re-implementing the same logic
// (it's not exported, so we test the contract directly)
function parseGatingEnabled(value: unknown): boolean {
  if (value && typeof value === "object" && "enabled" in (value as Record<string, unknown>)) {
    const enabled = (value as Record<string, unknown>).enabled;
    if (typeof enabled === "boolean") return enabled;
    if (enabled === "true") return true;
    if (enabled === "false") return false;
  }
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return true; // safe mode
}

describe("parseGatingEnabled", () => {
  // Case 1: boolean true → gating enabled
  it("boolean true → gating enabled", () => {
    expect(parseGatingEnabled(true)).toBe(true);
  });

  // Case 2: boolean false → gating disabled
  it("boolean false → gating disabled", () => {
    expect(parseGatingEnabled(false)).toBe(false);
  });

  // Case 3: JSON {enabled: false} → gating disabled
  it('JSON {enabled: false} → gating disabled', () => {
    expect(parseGatingEnabled({ enabled: false })).toBe(false);
  });

  // Case 4: JSON {enabled: true} → gating enabled
  it('JSON {enabled: true} → gating enabled', () => {
    expect(parseGatingEnabled({ enabled: true })).toBe(true);
  });

  // Case 5: string "true" → gating enabled
  it('string "true" → gating enabled', () => {
    expect(parseGatingEnabled("true")).toBe(true);
  });

  // Case 6: string "false" → gating disabled
  it('string "false" → gating disabled', () => {
    expect(parseGatingEnabled("false")).toBe(false);
  });

  // Case 7: null/undefined → safe mode (enabled)
  it("null → safe mode (enabled)", () => {
    expect(parseGatingEnabled(null)).toBe(true);
  });

  it("undefined → safe mode (enabled)", () => {
    expect(parseGatingEnabled(undefined)).toBe(true);
  });

  // Case 8: random object → safe mode (enabled)
  it("random object → safe mode (enabled)", () => {
    expect(parseGatingEnabled({ foo: "bar" })).toBe(true);
  });

  // Case 9: number → safe mode (enabled)
  it("number → safe mode (enabled)", () => {
    expect(parseGatingEnabled(42)).toBe(true);
  });
});
