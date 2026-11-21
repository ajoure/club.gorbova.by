/** Strict JSON contract shared by the editor and bounded, database-side audience RPC.
 * The evaluator is a reference for trusted normalized evidence, never a client-side
 * authorization decision or a reason to download all profiles into an Edge Function.
 */
export const TELEGRAM_FUNNEL_SEGMENT_LIMITS = { bytes: 32768, nodes: 100, depth: 6, children: 30, page: 200, offset: 1000000 } as const;
export const TELEGRAM_FUNNEL_FIELDS = ['country', 'city', 'source', 'status', 'marketing_consent', 'was_club_member'] as const;
export type TelegramFunnelField = typeof TELEGRAM_FUNNEL_FIELDS[number];
export type TelegramFunnelSegmentNode =
  | { id: string; op: 'and' | 'or'; args: TelegramFunnelSegmentNode[] }
  | { id: string; kind: 'product'; relation: 'purchased' | 'attended' | 'active_access'; product_id: string; negate: boolean; tariff_ids?: string[] }
  | { id: string; kind: 'year'; product_id: string; year: number; negate: boolean }
  | { id: string; kind: 'cohort'; product_id: string; flow_id: string; negate: boolean }
  | { id: string; kind: 'tag'; tag: string; negate: boolean }
  | { id: string; kind: 'field'; field: TelegramFunnelField; operator: 'eq' | 'neq' | 'is_set' | 'is_not_set'; value?: string | boolean };
export interface TelegramFunnelSegment { version: 1; root: TelegramFunnelSegmentNode }

export class TelegramFunnelSegmentError extends Error {
  constructor(public readonly code: string) { super(code); this.name = 'TelegramFunnelSegmentError'; }
}
function fail(code: string): never { throw new TelegramFunnelSegmentError(`telegram_funnel_segment_${code}`); }
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function uuid(value: unknown): string {
  if (typeof value !== 'string' || !uuidPattern.test(value)) fail('uuid_invalid');
  return (value as string).toLowerCase();
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) fail('object_required');
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some(key => !allowed.includes(key))) fail('unsupported_field');
}
function text(value: unknown, max = 120): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) fail('text_invalid');
  return (value as string).trim();
}

/** Rejects unknown fields, empty groups, duplicate IDs and complexity attacks before any RPC. */
export function parseTelegramFunnelSegment(input: unknown): TelegramFunnelSegment {
  let encoded: string | undefined;
  try { encoded = JSON.stringify(input); } catch { fail('json_invalid'); }
  if (!encoded || new TextEncoder().encode(encoded).length > TELEGRAM_FUNNEL_SEGMENT_LIMITS.bytes) fail('size_exceeded');
  const raw = object(input); keys(raw, ['version', 'root']);
  if (raw.version !== 1) fail('version_unsupported');
  const ids = new Set<string>(); let count = 0;
  const visit = (value: unknown, depth: number): TelegramFunnelSegmentNode => {
    if (++count > TELEGRAM_FUNNEL_SEGMENT_LIMITS.nodes || depth > TELEGRAM_FUNNEL_SEGMENT_LIMITS.depth) fail('complexity_exceeded');
    const node = object(value);
    if (typeof node.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(node.id) || ids.has(node.id)) fail('id_invalid');
    const id = node.id; ids.add(id);
    if ('op' in node) {
      keys(node, ['id', 'op', 'args']);
      if (node.op !== 'and' && node.op !== 'or') fail('operator_unsupported');
      if (!Array.isArray(node.args) || !node.args.length || node.args.length > TELEGRAM_FUNNEL_SEGMENT_LIMITS.children) fail('group_invalid');
      return { id, op: node.op, args: (node.args as unknown[]).map(child => visit(child, depth + 1)) };
    }
    if (node.kind === 'field') {
      keys(node, ['id', 'kind', 'field', 'operator', 'value']);
      if (!(TELEGRAM_FUNNEL_FIELDS as readonly unknown[]).includes(node.field)) fail('unsupported_field');
      const field = node.field as TelegramFunnelField;
      if (!['eq', 'neq', 'is_set', 'is_not_set'].includes(node.operator as string)) fail('operator_unsupported');
      const operator = node.operator as 'eq' | 'neq' | 'is_set' | 'is_not_set';
      if (operator === 'is_set' || operator === 'is_not_set') {
        if ('value' in node) fail('unexpected_value');
        return { id, kind: 'field', field, operator };
      }
      const booleanField = field === 'marketing_consent' || field === 'was_club_member';
      if (booleanField && typeof node.value !== 'boolean') fail('value_invalid');
      const value = booleanField ? node.value as boolean : text(node.value);
      return { id, kind: 'field', field, operator, value };
    }
    if (typeof node.negate !== 'boolean') fail('negate_required');
    const negate = node.negate;
    if (node.kind === 'product') {
      keys(node, ['id', 'kind', 'relation', 'product_id', 'negate', 'tariff_ids']);
      if (!['purchased', 'attended', 'active_access'].includes(node.relation as string)) fail('relation_unsupported');
      const result: Extract<TelegramFunnelSegmentNode, { kind: 'product' }> = { id, kind: 'product', relation: node.relation as 'purchased' | 'attended' | 'active_access', product_id: uuid(node.product_id), negate };
      if ('tariff_ids' in node) {
        if (!Array.isArray(node.tariff_ids) || !node.tariff_ids.length || node.tariff_ids.length > 30) fail('tariffs_invalid');
        const tariffIds = (node.tariff_ids as unknown[]).map(uuid);
        if (new Set(tariffIds).size !== tariffIds.length) fail('tariffs_invalid');
        result.tariff_ids = tariffIds;
      }
      return result;
    }
    if (node.kind === 'year') {
      keys(node, ['id', 'kind', 'product_id', 'year', 'negate']);
      if (!Number.isSafeInteger(node.year) || Number(node.year) < 2000 || Number(node.year) > 2200) fail('year_invalid');
      return { id, kind: 'year', product_id: uuid(node.product_id), year: node.year as number, negate };
    }
    if (node.kind === 'cohort') {
      keys(node, ['id', 'kind', 'product_id', 'flow_id', 'negate']);
      return { id, kind: 'cohort', product_id: uuid(node.product_id), flow_id: uuid(node.flow_id), negate };
    }
    if (node.kind === 'tag') {
      keys(node, ['id', 'kind', 'tag', 'negate']);
      return { id, kind: 'tag', tag: text(node.tag, 80), negate };
    }
    return fail('kind_unsupported');
  };
  return { version: 1, root: visit(raw.root, 1) };
}

/** Evidence is server-owned: confirmed receipts/approved historical purchases,
 * protected full-course enrollment (also expired/imported), actual active access.
 * These arrays must be complete for this one candidate. Missing data is an error.
 * Year is the course flow start year (Europe/Minsk), never import/record date.
 */
export interface TelegramFunnelEvidence {
  product_id: string; tariff_id?: string | null; year?: number | null; flow_id?: string | null;
}
export interface TelegramFunnelSegmentFacts {
  purchases: TelegramFunnelEvidence[];
  participations: TelegramFunnelEvidence[];
  active_access: TelegramFunnelEvidence[];
  tags: string[];
  fields: Partial<Record<TelegramFunnelField, string | boolean | null>>;
}
export function evaluateTelegramFunnelSegment(input: unknown, facts: TelegramFunnelSegmentFacts): boolean {
  const segment = parseTelegramFunnelSegment(input);
  if (!facts || !Array.isArray(facts.purchases) || !Array.isArray(facts.participations) || !Array.isArray(facts.active_access)
    || !Array.isArray(facts.tags) || !facts.fields || typeof facts.fields !== 'object') fail('facts_incomplete');
  const checkFields = (node: TelegramFunnelSegmentNode): void => {
    if ('op' in node) { node.args.forEach(checkFields); return; }
    if (node.kind === 'field' && !Object.prototype.hasOwnProperty.call(facts.fields, node.field)) fail('facts_incomplete');
  };
  checkFields(segment.root);
  const matches = (node: TelegramFunnelSegmentNode): boolean => {
    if ('op' in node) return node.op === 'and' ? node.args.every(matches) : node.args.some(matches);
    if (node.kind === 'field') {
      const actual = facts.fields[node.field];
      const set = actual !== null && actual !== undefined && actual !== '';
      if (node.operator === 'is_set') return set;
      if (node.operator === 'is_not_set') return !set;
      // Unknown/null is not proof of inequality; only explicit is_not_set selects it.
      return set && (node.operator === 'eq' ? actual === node.value : actual !== node.value);
    }
    let positive: boolean;
    if (node.kind === 'tag') positive = facts.tags.includes(node.tag);
    else if (node.kind === 'product') {
      const rows = node.relation === 'purchased' ? facts.purchases : node.relation === 'attended' ? facts.participations : facts.active_access;
      positive = rows.some(row => row.product_id === node.product_id && (!node.tariff_ids || !!row.tariff_id && node.tariff_ids.includes(row.tariff_id)));
    } else {
      const rows = facts.participations.filter(row => row.product_id === node.product_id);
      // An enrollment with unknown year/flow cannot prove non-participation there.
      if (node.negate && rows.some(row => node.kind === 'year' ? row.year == null : row.flow_id == null)) return false;
      positive = rows.some(row => node.kind === 'year' ? row.year === node.year : row.flow_id === node.flow_id);
    }
    return node.negate ? !positive : positive;
  };
  return matches(segment.root);
}

export interface TelegramFunnelAudienceRecipient { profile_id: string; user_id: string | null; full_name: string | null; has_dialog: boolean }
export interface TelegramFunnelAudiencePage { total: number; available_count: number; recipients: TelegramFunnelAudienceRecipient[] }
interface AudienceRpcClient { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }> }
/** One bounded native query, no JS-side per-profile selection or fallback on RPC error. */
export async function resolveTelegramFunnelAudience(db: AudienceRpcClient, input: unknown, options: { botId: string; offset?: number; limit?: number; service?: boolean }): Promise<TelegramFunnelAudiencePage> {
  const segment = parseTelegramFunnelSegment(input), bot = uuid(options.botId);
  const offset = options.offset ?? 0, limit = options.limit ?? 50;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > TELEGRAM_FUNNEL_SEGMENT_LIMITS.offset
    || !Number.isSafeInteger(limit) || limit < 1 || limit > TELEGRAM_FUNNEL_SEGMENT_LIMITS.page) fail('page_invalid');
  const { data, error } = await db.rpc(options.service === true ? 'telegram_funnel_audience_service' : 'telegram_funnel_audience', { p_segment: segment, p_bot: bot, p_offset: offset, p_limit: limit });
  if (error) fail(typeof error === 'object' && error !== null && 'code' in error && error.code === '57014' ? 'selection_timeout' : 'selection_unavailable');
  const page = object(data);
  if (!Number.isSafeInteger(page.total) || Number(page.total) < 0 || !Number.isSafeInteger(page.available_count)
    || Number(page.available_count) < 0 || Number(page.available_count) > Number(page.total)
    || !Array.isArray(page.recipients) || page.recipients.length > limit || page.recipients.length > Math.max(0, Number(page.total) - offset)) fail('response_invalid');
  const ids = new Set<string>();
  const recipients = (page.recipients as unknown[]).map(value => {
    const row = object(value), profileId = uuid(row.profile_id);
    if (ids.has(profileId) || typeof row.has_dialog !== 'boolean' || !(row.full_name === null || typeof row.full_name === 'string')) fail('response_invalid');
    ids.add(profileId);
    return { profile_id: profileId, user_id: row.user_id === null ? null : uuid(row.user_id), full_name: row.full_name as string | null, has_dialog: row.has_dialog as boolean };
  });
  return { total: page.total as number, available_count: page.available_count as number, recipients };
}
