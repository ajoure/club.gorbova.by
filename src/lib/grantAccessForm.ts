type RecordValue = Record<string, any>;
const record = (value: unknown): RecordValue => value && typeof value === 'object' && !Array.isArray(value)
  ? value as RecordValue : {};

export function localDateTimeValue(date: Date): string {
  const pad = (value: number, width = 2) => String(value).padStart(width, '0');
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    + `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}

export function parseLocalDateTime(value: string): Date | null {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(value);
  if (!match) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  // Reject normalized impossible calendar dates and nonexistent local DST times.
  const canonical = `${match[1]}:${match[2] || '00'}.${(match[3] || '').padEnd(3, '0')}`;
  return localDateTimeValue(date) === canonical ? date : null;
}

export function buildGrantAccessBody(input: {
  orderId: string;
  start: Date | null;
  days: number | null;
  extendFromCurrent: boolean;
  grantTelegram: boolean;
  grantGetcourse: boolean;
  exactEnd?: Date | null;
  expectedExistingSubscriptionId?: string;
}) {
  if (input.exactEnd && !input.expectedExistingSubscriptionId) {
    throw new Error('Не подтверждена существующая подписка. Обновите данные сделки.');
  }
  return {
    orderId: input.orderId,
    customAccessStartAt: input.start?.toISOString(),
    ...(input.exactEnd ? {
      customAccessEndAt: input.exactEnd.toISOString(),
      expectedExistingSubscriptionId: input.expectedExistingSubscriptionId,
    } : { customAccessDays: input.days }),
    extendFromCurrent: input.exactEnd ? true : input.extendFromCurrent,
    grantTelegram: input.grantTelegram,
    grantGetcourse: input.grantGetcourse,
  };
}

export function confirmedGrantIds(value: unknown) {
  const data = record(value);
  if (data.manual_review === true || data.manualReview === true) throw new Error('Требуется ручная проверка связи оплаты и доступа. Срок не подтверждён.');
  if (data.skipped === true) throw new Error('Выдача пропущена сервером. Доступ не подтверждён; проверьте причину в истории сделки.');
  if (data.success !== true || data.error) throw new Error('Сервер не подтвердил выдачу доступа. Обновите данные и проверьте историю сделки.');
  const results = record(data.results);
  const subscriptionId = data.subscription_id || data.subscription_v2_id || record(results.subscription).id;
  const entitlementId = data.entitlement_id || record(results.entitlement).id;
  if (typeof subscriptionId !== 'string' || typeof entitlementId !== 'string') {
    throw new Error('Не получены идентификаторы выданного доступа. Повторная выдача вслепую запрещена.');
  }
  return {
    subscriptionId,
    entitlementId,
    integrationsIncomplete: record(results.telegram).success === false || record(results.getcourse).success === false,
    integrationsPending: [results.telegram, results.getcourse].some(value => {
      const integration = record(value);
      return integration.queued === true || ['pending_downstream', 'pending', 'queued'].includes(integration.status);
    }),
  };
}

export function verifyGrantAccessReadback(input: {
  orderId: string;
  userId: string;
  productId: string;
  tariffId: string | null;
  subscription: unknown;
  entitlement: unknown;
  minimumEnd?: Date | null;
  expectedExistingSubscriptionId?: string;
}): Date {
  const sub = record(input.subscription);
  const ent = record(input.entitlement);
  const belongs = (row: RecordValue) => row.order_id === input.orderId
    || (Array.isArray(row.meta?.extended_by_orders) && row.meta.extended_by_orders.includes(input.orderId));
  const subEnd = Date.parse(sub.access_end_at);
  const entEnd = Date.parse(ent.expires_at);
  if (sub.user_id !== input.userId || ent.user_id !== input.userId
      || sub.product_id !== input.productId || ent.product_id !== input.productId
      || sub.tariff_id !== input.tariffId || sub.status !== 'active' || ent.status !== 'active'
      || !belongs(sub) || !belongs(ent) || !Number.isFinite(subEnd) || !Number.isFinite(entEnd)
      || (input.expectedExistingSubscriptionId && sub.id !== input.expectedExistingSubscriptionId)
      || (input.minimumEnd && Math.min(subEnd, entEnd) < input.minimumEnd.getTime())) {
    throw new Error('Проверка после выдачи не подтвердила связь или полный срок доступа. Не создавайте повторную покупку.');
  }
  return new Date(Math.min(subEnd, entEnd));
}
