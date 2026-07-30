import { describe, expect, it } from "vitest";
import {
  isOneShotScenarioType,
  shouldRestoreScenarioContext,
} from "./aiScenarioRouting";

describe("AI scenario routing", () => {
  it.each(["asset_classifier_hybrid", "deterministic_lookup"])(
    "treats %s as a one-shot tool",
    (scenarioType) => {
      expect(isOneShotScenarioType(scenarioType)).toBe(true);
      expect(shouldRestoreScenarioContext(scenarioType)).toBe(false);
    },
  );

  it("keeps regular prompt scenarios resumable", () => {
    expect(shouldRestoreScenarioContext("document_review")).toBe(true);
    expect(shouldRestoreScenarioContext("file_analysis")).toBe(true);
  });

  it("does not invent a context for a plain chat", () => {
    expect(shouldRestoreScenarioContext(undefined)).toBe(false);
    expect(shouldRestoreScenarioContext(null)).toBe(false);
  });
});
