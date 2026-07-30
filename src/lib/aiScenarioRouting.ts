const ONE_SHOT_SCENARIO_TYPES = new Set([
  "asset_classifier_hybrid",
  "deterministic_lookup",
]);

export function isOneShotScenarioType(scenarioType: string | null | undefined): boolean {
  return Boolean(scenarioType && ONE_SHOT_SCENARIO_TYPES.has(scenarioType));
}

export function shouldRestoreScenarioContext(
  scenarioType: string | null | undefined,
): boolean {
  return Boolean(scenarioType) && !isOneShotScenarioType(scenarioType);
}
