// =====================================================================
// Inbox mark-as-read coordinator (PATCH-CONTACT-CENTER-FIX-V1 corrective)
// ---------------------------------------------------------------------
// Единый shared registry, доступный обоим источникам — mutation в
// InboxTabContent и realtime bus useInboxRealtimeInvalidation. Mutation
// регистрирует «свои» user_id ДО RPC, а realtime подавляет ровно
// ожидаемое собственное событие `UPDATE telegram_messages SET is_read=true`.
//
// Контракт:
//   * registerSelfMark(userId, ttlMs) — записывает expiresAt = Date.now() + ttl;
//   * isSelfMarkActive(userId)        — true если запись не истекла;
//   * clearSelfMark(userId)           — снимает запись (вызывается на ошибке
//                                       RPC, чтобы реальное чужое событие
//                                       не было проглочено);
//   * INSERT-события НИКОГДА не подавляются (новое incoming всегда
//     инвалидирует кэш) — coordinator используется только для is_read=true.
// =====================================================================

const registry = new Map<string, number>();

function prune(): void {
  const now = Date.now();
  for (const [key, exp] of registry) {
    if (exp <= now) registry.delete(key);
  }
}

export function registerSelfMark(userId: string, ttlMs: number = 2500): void {
  if (!userId) return;
  prune();
  registry.set(userId, Date.now() + ttlMs);
}

export function isSelfMarkActive(userId: string | null | undefined): boolean {
  if (!userId) return false;
  const exp = registry.get(userId);
  if (!exp) return false;
  if (exp <= Date.now()) {
    registry.delete(userId);
    return false;
  }
  return true;
}

export function clearSelfMark(userId: string | null | undefined): void {
  if (!userId) return;
  registry.delete(userId);
}
