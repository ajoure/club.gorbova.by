import { describe, expect, it, vi } from 'vitest';
import { parseTelegramFunnelSegment, evaluateTelegramFunnelSegment, resolveTelegramFunnelAudience, type TelegramFunnelSegmentFacts } from '../../supabase/functions/_shared/telegram-funnel-segments';

const product = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const flow = '33333333-3333-4333-8333-333333333333';
const profile = '44444444-4444-4444-8444-444444444444';
const bot = '55555555-5555-4555-8555-555555555555';
const leaf = (relation = 'attended', negate = false, id = 'course') => ({ id, kind: 'product', relation, product_id: product, negate });
const segment = (root: unknown) => ({ version: 1, root });
const facts = (patch: Partial<TelegramFunnelSegmentFacts> = {}): TelegramFunnelSegmentFacts => ({ purchases: [], participations: [], active_access: [], tags: [], fields: { country: null, city: null, source: null, status: null, marketing_consent: null, was_club_member: null }, ...patch });

describe('strict segment AST boundary', () => {
  it('normalizes UUID case and returns an independent validated tree', () => {
    const input = segment({ ...leaf(), product_id: 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA' });
    const parsed = parseTelegramFunnelSegment(input);
    expect(parsed.root).toMatchObject({ product_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
    expect(parsed.root).not.toBe(input.root);
  });
  for (const [name, input] of [
    ['unknown version', { version: 2, root: leaf() }],
    ['empty AND', segment({ id: 'root', op: 'and', args: [] })],
    ['unsupported group operator', segment({ id: 'root', op: 'not', args: [leaf()] })],
    ['duplicate stable ids', segment({ id: 'root', op: 'or', args: [leaf(), leaf()] })],
    ['unstable id', segment({ ...leaf(), id: 'arbitrary/id' })],
    ['unknown field', segment({ id: 'x', kind: 'field', field: 'meta.paid', operator: 'eq', value: 'yes' })],
    ['arbitrary SQL', segment({ ...leaf(), sql: 'true' })],
    ['unknown condition', segment({ id: 'x', kind: 'script', negate: false })],
    ['missing negate', segment({ id: 'x', kind: 'tag', tag: 'ok' })],
    ['string boolean', segment({ id: 'x', kind: 'field', field: 'marketing_consent', operator: 'eq', value: 'true' })],
    ['value on is_set', segment({ id: 'x', kind: 'field', field: 'city', operator: 'is_set', value: 'x' })],
    ['unknown year', segment({ id: 'x', kind: 'year', product_id: product, year: '2025', negate: false })],
    ['bad cohort', segment({ id: 'x', kind: 'cohort', product_id: product, flow_id: '18', negate: false })],
    ['duplicate tariff', segment({ ...leaf(), tariff_ids: [other, other] })],
    ['empty tariff constraint', segment({ ...leaf(), tariff_ids: [] })],
  ] as const) it(`rejects ${name}`, () => { expect(() => parseTelegramFunnelSegment(input)).toThrow('telegram_funnel_segment_'); });
  it('bounds depth, node count, fanout and UTF-8 bytes', () => {
    let deep: unknown = leaf();
    for (let i = 0; i < 6; i++) deep = { id: `g${i}`, op: 'and', args: [deep] };
    expect(() => parseTelegramFunnelSegment(segment(deep))).toThrow('complexity_exceeded');
    const args = Array.from({ length: 31 }, (_, i) => leaf('attended', false, `l${i}`));
    expect(() => parseTelegramFunnelSegment(segment({ id: 'r', op: 'or', args }))).toThrow('group_invalid');
    const branches = Array.from({ length: 4 }, (_, i) => ({ id: `g${i}`, op: 'or', args: Array.from({ length: 25 }, (_, j) => leaf('attended', false, `l${i}_${j}`)) }));
    expect(() => parseTelegramFunnelSegment(segment({ id: 'r', op: 'and', args: branches }))).toThrow('complexity_exceeded');
    expect(() => parseTelegramFunnelSegment({ version: 1, root: leaf(), ignored: 'я'.repeat(17000) })).toThrow('size_exceeded');
  });
  it('does not allow a valid OR branch to mask an unsupported condition', () => {
    const input = segment({ id: 'r', op: 'or', args: [leaf(), { id: 'bad', kind: 'unknown', negate: false }] });
    expect(() => evaluateTelegramFunnelSegment(input, facts({ participations: [{ product_id: product }] }))).toThrow('kind_unsupported');
  });
});

describe('reference evidence semantics (SQL must implement the same contract)', () => {
  it('distinguishes imported/expired participation, purchase proof and current access', () => {
    // A normalized confirmed import/expired enrollment is participation, not a fabricated receipt or live access.
    const f = facts({ participations: [{ product_id: product, year: 2024, flow_id: flow }] });
    expect(evaluateTelegramFunnelSegment(segment(leaf()), f)).toBe(true);
    expect(evaluateTelegramFunnelSegment(segment(leaf('purchased')), f)).toBe(false);
    expect(evaluateTelegramFunnelSegment(segment(leaf('active_access')), f)).toBe(false);
  });
  it('combines attended selected year AND NOT purchased another product with nested OR', () => {
    const input = segment({ id: 'r', op: 'and', args: [leaf(), { id: 'year', kind: 'year', product_id: product, year: 2025, negate: false },
      { ...leaf('purchased', true, 'not_zg'), product_id: other }, { id: 'g', op: 'or', args: [{ id: 'tag', kind: 'tag', tag: 'reviewed', negate: false }, { id: 'country', kind: 'field', field: 'country', operator: 'eq', value: 'BY' }] }] });
    const f = facts({ participations: [{ product_id: product, year: 2025 }], tags: ['reviewed'] });
    expect(evaluateTelegramFunnelSegment(input, f)).toBe(true);
    expect(evaluateTelegramFunnelSegment(input, { ...f, purchases: [{ product_id: other }] })).toBe(false);
  });
  it('constrains tariff inside the same matching product evidence', () => {
    const input = segment({ ...leaf('purchased'), tariff_ids: [flow] });
    expect(evaluateTelegramFunnelSegment(input, facts({ purchases: [{ product_id: product }, { product_id: other, tariff_id: flow }] }))).toBe(false);
    expect(evaluateTelegramFunnelSegment(input, facts({ purchases: [{ product_id: product, tariff_id: flow }] }))).toBe(true);
  });
  it('does not infer course year or flow from unknown enrollment attributes', () => {
    for (const node of [{ id: 'y', kind: 'year', product_id: product, year: 2025 }, { id: 'c', kind: 'cohort', product_id: product, flow_id: flow }]) {
      for (const negate of [false, true]) expect(evaluateTelegramFunnelSegment(segment({ ...node, negate }), facts({ participations: [{ product_id: product }] }))).toBe(false);
    }
    expect(evaluateTelegramFunnelSegment(segment({ id: 'c', kind: 'cohort', product_id: product, flow_id: flow, negate: false }), facts({ participations: [{ product_id: product, flow_id: flow }] }))).toBe(true);
  });
  it('uses exact manual tags and explicit boolean fields', () => {
    expect(evaluateTelegramFunnelSegment(segment({ id: 't', kind: 'tag', tag: 'Paid', negate: false }), facts({ tags: ['paid'] }))).toBe(false);
    expect(evaluateTelegramFunnelSegment(segment({ id: 'f', kind: 'field', field: 'marketing_consent', operator: 'eq', value: false }), facts({ fields: { marketing_consent: false } }))).toBe(true);
  });
  it('null is not proof of inequality; missing source data always fails closed', () => {
    expect(evaluateTelegramFunnelSegment(segment({ id: 'f', kind: 'field', field: 'city', operator: 'neq', value: 'Minsk' }), facts())).toBe(false);
    expect(evaluateTelegramFunnelSegment(segment({ id: 'f', kind: 'field', field: 'city', operator: 'is_not_set' }), facts())).toBe(true);
    const input = segment({ id: 'r', op: 'or', args: [leaf(), { id: 'f', kind: 'field', field: 'city', operator: 'eq', value: 'Minsk' }] });
    expect(() => evaluateTelegramFunnelSegment(input, facts({ participations: [{ product_id: product }], fields: {} }))).toThrow('facts_incomplete');
    expect(() => evaluateTelegramFunnelSegment(segment(leaf('purchased', true)), {} as never)).toThrow('facts_incomplete');
  });
});

describe('bounded native RPC boundary', () => {
  const page = { total: 250, available_count: 200, recipients: [{ profile_id: profile, user_id: null, full_name: null, has_dialog: false }] };
  it('delegates one validated page to native RPC; no profile downloads or JS postfilter', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: page, error: null });
    expect(await resolveTelegramFunnelAudience({ rpc }, segment(leaf()), { botId: bot, offset: 200, limit: 50 })).toEqual(page);
    expect(rpc).toHaveBeenCalledExactlyOnceWith('telegram_funnel_audience', { p_segment: segment(leaf()), p_bot: bot, p_offset: 200, p_limit: 50 });
    await resolveTelegramFunnelAudience({ rpc }, segment(leaf()), { botId: bot, service: true });
    expect(rpc.mock.calls[1][0]).toBe('telegram_funnel_audience_service');
  });
  for (const options of [{ offset: -1 }, { limit: 0 }, { limit: 201 }, { offset: 1000001 }, { offset: 1.5 }]) it(`rejects unbounded paging ${JSON.stringify(options)} before querying`, async () => {
    const rpc = vi.fn();
    await expect(resolveTelegramFunnelAudience({ rpc }, segment(leaf()), { botId: bot, ...options })).rejects.toThrow('page_invalid');
    expect(rpc).not.toHaveBeenCalled();
  });
  it('fails closed on native failure, invalid counts, duplicate IDs, and malformed recipients', async () => {
    for (const reply of [{ data: null, error: Error('database') }, { data: { ...page, total: -1 }, error: null }, { data: { ...page, available_count: 251 }, error: null },
      { data: { ...page, recipients: [page.recipients[0], page.recipients[0]] }, error: null }, { data: { ...page, recipients: [{ ...page.recipients[0], has_dialog: 'true' }] }, error: null }]) {
      await expect(resolveTelegramFunnelAudience({ rpc: vi.fn().mockResolvedValue(reply) }, segment(leaf()), { botId: bot })).rejects.toThrow('telegram_funnel_segment_');
    }
  });
});
