export function preserveQuestionnaireUrls<T extends { clickTokens: Map<string, string> }>(tracking: T, urls: string[]): T {
  const protectedSet = new Set(urls);
  return { ...tracking, clickTokens: new Map([...tracking.clickTokens].filter(([url]) => !protectedSet.has(url))) };
}

export function questionnaireProtectedUrls(value: unknown, scope: { systemActor: boolean; sendMode: string | null; recipientCount: number }): string[] {
  if (value === undefined || (Array.isArray(value) && value.length === 0)) return [];
  if (!scope.systemActor || scope.sendMode !== 'event' || scope.recipientCount !== 1 || !Array.isArray(value) || value.length !== 2 ||
      typeof value[0] !== 'string' || !/^https:\/\/t\.me\/(\+|joinchat\/)[A-Za-z0-9_-]+$/.test(value[0]) ||
      typeof value[1] !== 'string' || !/^https:\/\/t\.me\/m\/[A-Za-z0-9_-]+$/.test(value[1])) throw new Error('questionnaire_protected_urls_invalid');
  return value;
}
