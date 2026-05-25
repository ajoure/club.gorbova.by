// Shared AI access helper.
// SOT — существующие entitlements; никакой новой тарифной подсистемы.
//
// Продукты:
//   ЗАКРОЙ ГОД → только balance_analysis
//   Gorbova Club / Бухгалтерия как бизнес → chat + balance_analysis + 107NK

export const PRODUCT_ZG = '73c29914-63a3-4f4f-ac42-9f5287e58696';
export const PRODUCT_GORBOVA_CLUB = '11c9f1b8-0355-4753-bd74-40b42aa53616';
export const PRODUCT_BUSINESS = '85046734-2282-4ded-b0d3-8c66c8f5bc2b';
export const FULL_AI_PRODUCTS = [PRODUCT_GORBOVA_CLUB, PRODUCT_BUSINESS];

export type AiMode = 'chat' | 'prompt';
export type ScenarioCode = 'balance_analysis' | '107NK' | string;

export const LIMITS = {
  chat: { daily: 50, monthly: 500 },
  balance_analysis: { daily: 20, monthly: 200 },
  '107NK': { daily: 20, monthly: 200 },
  default_prompt: { daily: 20, monthly: 200 },
} as const;

export const HARD_USER_MESSAGE_CHARS = 50_000;
export const CONTEXT_MAX_MESSAGES = 20;
export const CONTEXT_MAX_CHARS = 80_000;

export interface AiAccess {
  tier: 'full' | 'zg_only' | 'none';
  chat: boolean;
  balance_analysis: boolean;
  '107NK': boolean;
}

export async function resolveAiAccess(supabase: any, userId: string): Promise<AiAccess> {
  const { data, error } = await supabase
    .from('entitlements')
    .select('product_id, expires_at, status')
    .eq('user_id', userId)
    .eq('status', 'active')
    .in('product_id', [PRODUCT_ZG, ...FULL_AI_PRODUCTS]);

  if (error || !data) {
    // Fallback: deny by default
    return { tier: 'none', chat: false, balance_analysis: false, '107NK': false };
  }

  const now = Date.now();
  const active = data.filter((r: any) => !r.expires_at || new Date(r.expires_at).getTime() > now);
  const hasFull = active.some((r: any) => FULL_AI_PRODUCTS.includes(r.product_id));
  const hasZg = active.some((r: any) => r.product_id === PRODUCT_ZG);

  if (hasFull) return { tier: 'full', chat: true, balance_analysis: true, '107NK': true };
  if (hasZg) return { tier: 'zg_only', chat: false, balance_analysis: true, '107NK': false };
  return { tier: 'none', chat: false, balance_analysis: false, '107NK': false };
}

export function isModeAllowed(access: AiAccess, mode: AiMode, scenarioCode?: string | null): { allowed: boolean; reason?: string } {
  if (mode === 'chat') {
    if (!access.chat) return { allowed: false, reason: 'chat_not_in_tier' };
    return { allowed: true };
  }
  // prompt mode
  if (scenarioCode === 'balance_analysis') {
    if (!access.balance_analysis) return { allowed: false, reason: 'balance_analysis_not_in_tier' };
    return { allowed: true };
  }
  if (scenarioCode === '107NK') {
    if (!access['107NK']) return { allowed: false, reason: '107NK_not_in_tier' };
    return { allowed: true };
  }
  // Любой другой брендированный сценарий = требует full
  if (access.tier !== 'full') return { allowed: false, reason: 'scenario_requires_full_tier' };
  return { allowed: true };
}

export function limitsForKey(key: 'chat' | 'balance_analysis' | '107NK' | 'default_prompt') {
  return LIMITS[key];
}

export async function countUserMessages(
  supabase: any,
  userId: string,
  filter: { ai_mode?: AiMode; scenario_code?: string },
): Promise<{ daily: number; monthly: number }> {
  const minskNow = new Date();
  const dayStart = new Date(minskNow); dayStart.setUTCHours(21, 0, 0, 0); // ~Minsk midnight (UTC+3 → 21:00 UTC prev day)
  if (dayStart > minskNow) dayStart.setUTCDate(dayStart.getUTCDate() - 1);
  const monthStart = new Date(Date.UTC(minskNow.getUTCFullYear(), minskNow.getUTCMonth(), 1, 21, 0, 0));

  let q = supabase
    .from('ai_chat_messages')
    .select('id, created_at, metadata', { count: 'exact', head: false })
    .eq('user_id', userId)
    .eq('role', 'user')
    .gte('created_at', monthStart.toISOString());

  if (filter.ai_mode) q = q.eq('metadata->>ai_mode', filter.ai_mode);
  if (filter.scenario_code) q = q.eq('metadata->>scenario_code', filter.scenario_code);

  const { data } = await q;
  const rows = (data || []) as Array<{ created_at: string; metadata: any }>;
  const filtered = rows.filter(r => !r.metadata?.denial_reason);
  const monthly = filtered.length;
  const daily = filtered.filter(r => new Date(r.created_at) >= dayStart).length;
  return { daily, monthly };
}

export function truncateHistory(
  messages: Array<{ role: string; content: string }>,
  systemPrompt: string,
  fileContext: string | null,
): {
  messages: Array<{ role: string; content: string }>;
  truncated: boolean;
  dropped_messages_count: number;
  dropped_chars: number;
  context_messages_count: number;
  context_chars: number;
} {
  // 1) by count: keep last N
  let kept = messages.slice(-CONTEXT_MAX_MESSAGES);
  let droppedCount = messages.length - kept.length;
  let droppedChars = messages.slice(0, messages.length - kept.length).reduce((s, m) => s + (m.content?.length || 0), 0);

  // 2) by char cap (без учёта system и fileContext, чтобы их не вырезать)
  const reservedChars = (systemPrompt?.length || 0) + (fileContext?.length || 0);
  let budget = Math.max(0, CONTEXT_MAX_CHARS - reservedChars);
  let totalChars = kept.reduce((s, m) => s + (m.content?.length || 0), 0);

  while (totalChars > budget && kept.length > 1) {
    const removed = kept.shift()!;
    droppedCount += 1;
    droppedChars += removed.content?.length || 0;
    totalChars -= removed.content?.length || 0;
  }

  return {
    messages: kept,
    truncated: droppedCount > 0,
    dropped_messages_count: droppedCount,
    dropped_chars: droppedChars,
    context_messages_count: kept.length,
    context_chars: totalChars,
  };
}

const OFFTOPIC_SYSTEM = `Ты — классификатор тематики запросов. Тема: бизнес, налоги, бухгалтерия, право в РБ/РФ, ИП/ООО/ЗАО, документы, отчётность, фриланс, маркетплейсы. Если запрос про эти темы (даже косвенно) — on_topic=true. Если запрос явно про быт/медицину/развлечения/общие энциклопедические факты — on_topic=false. ПРИ СОМНЕНИИ — on_topic=true. Ответь строго JSON: {"on_topic": true|false, "reason": "..."}.`;

export async function classifyOffTopic(apiKey: string, userText: string): Promise<{ on_topic: boolean; reason: string; classifier_model: string; error?: string }> {
  const model = 'google/gemini-2.5-flash-lite';
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    const r = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: OFFTOPIC_SYSTEM },
          { role: 'user', content: (userText || '').slice(0, 4000) },
        ],
        response_format: { type: 'json_object' },
        stream: false,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!r.ok) {
      return { on_topic: true, reason: 'classifier_http_' + r.status, classifier_model: model, error: 'http_' + r.status };
    }
    const j = await r.json();
    const content = j?.choices?.[0]?.message?.content;
    if (!content) return { on_topic: true, reason: 'classifier_no_content', classifier_model: model, error: 'no_content' };
    try {
      const parsed = JSON.parse(content);
      return {
        on_topic: parsed.on_topic !== false, // консервативно: только явный false блокирует
        reason: String(parsed.reason || '').slice(0, 200),
        classifier_model: model,
      };
    } catch {
      return { on_topic: true, reason: 'classifier_bad_json', classifier_model: model, error: 'bad_json' };
    }
  } catch (e) {
    return { on_topic: true, reason: 'classifier_exception', classifier_model: model, error: (e as Error).message };
  }
}
