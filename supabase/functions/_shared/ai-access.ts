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

// PATCH v2.2 (2026-05-26): жёсткие ограничения объёма для удешевления
export const HARD_USER_MESSAGE_CHARS = 15_000;        // было 50_000
export const CONTEXT_MAX_MESSAGES = 10;                // было 20
export const CONTEXT_MAX_CHARS = 30_000;               // было 80_000
export const DAILY_CHARS_BUDGET_CHAT = 200_000;        // новый: per-user суточный объёмный лимит для mode='chat'
export const PER_MINUTE_RATE_CHAT = 3;                 // новый: антифлуд 3 msg/min
export const FILE_CONTEXT_MAX_CHARS = 8_000;           // новый: обрезка fileContents в передаваемом контексте
export const ALLOWED_UPLOAD_SCENARIOS = ['balance_analysis', '107NK'];  // upload разрешён только здесь

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

// ============================================================================
// UI projection: единственный read-only вычислитель статуса для frontend.
// Используется edge function `ai-access-status`. Никакой собственной логики
// в самом edge — он только зовёт этот helper.
// ============================================================================

export interface AiAccessStatusUi {
  tier: 'full' | 'zg_only' | 'none';
  allowed_modes: { chat: boolean; prompt: boolean };
  allowed_scenarios: Array<{
    code: string;
    allowed: boolean;
    denial_reason?: string;
  }>;
  quota_by_mode: {
    chat: { daily: { used: number; limit: number; remaining: number }; monthly: { used: number; limit: number; remaining: number } };
    balance_analysis: { daily: { used: number; limit: number; remaining: number }; monthly: { used: number; limit: number; remaining: number } };
    '107NK': { daily: { used: number; limit: number; remaining: number }; monthly: { used: number; limit: number; remaining: number } };
  };
  cta_target: { business_url: string; club_url: string };
  denial_reasons: Record<string, string>;
}

const CTA_TARGET = {
  business_url: '/buhgalteria-kak-biznes',
  club_url: '/gorbova-club',
};

const DENIAL_HUMAN: Record<string, string> = {
  chat_not_in_tier: 'Свободный чат недоступен на вашем тарифе. Откройте Business или Gorbova Club.',
  balance_analysis_not_in_tier: 'Сценарий «Анализ баланса» недоступен на вашем тарифе.',
  '107NK_not_in_tier': 'Сценарий «Ответ на запрос МНС» недоступен на вашем тарифе. Откройте Business или Gorbova Club.',
  scenario_requires_full_tier: 'Этот сценарий доступен в тарифах Business / Gorbova Club.',
  no_access: 'AI-помощник недоступен на вашем тарифе.',
};

function quotaSlot(used: number, limit: number) {
  return { used, limit, remaining: Math.max(0, limit - used) };
}

export async function resolveAiAccessStatus(
  supabase: any,
  userId: string,
  knownScenarioCodes: string[],
): Promise<AiAccessStatusUi> {
  const access = await resolveAiAccess(supabase, userId);
  const chatCheck = isModeAllowed(access, 'chat');
  const scenarios = knownScenarioCodes.map((code) => {
    const check = isModeAllowed(access, 'prompt', code);
    return { code, allowed: check.allowed, denial_reason: check.allowed ? undefined : check.reason };
  });

  const [chatUsed, baUsed, nkUsed] = await Promise.all([
    countUserMessages(supabase, userId, { ai_mode: 'chat' }),
    countUserMessages(supabase, userId, { scenario_code: 'balance_analysis' }),
    countUserMessages(supabase, userId, { scenario_code: '107NK' }),
  ]);

  return {
    tier: access.tier,
    allowed_modes: { chat: chatCheck.allowed, prompt: scenarios.some(s => s.allowed) },
    allowed_scenarios: scenarios,
    quota_by_mode: {
      chat: {
        daily: quotaSlot(chatUsed.daily, LIMITS.chat.daily),
        monthly: quotaSlot(chatUsed.monthly, LIMITS.chat.monthly),
      },
      balance_analysis: {
        daily: quotaSlot(baUsed.daily, LIMITS.balance_analysis.daily),
        monthly: quotaSlot(baUsed.monthly, LIMITS.balance_analysis.monthly),
      },
      '107NK': {
        daily: quotaSlot(nkUsed.daily, LIMITS['107NK'].daily),
        monthly: quotaSlot(nkUsed.monthly, LIMITS['107NK'].monthly),
      },
    },
    cta_target: CTA_TARGET,
    denial_reasons: DENIAL_HUMAN,
  };
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

// ============================================================================
// PATCH v2.2 helpers: daily chars budget + per-minute antiflood
// ============================================================================

/** Сумма metadata.context_chars за сегодня по assistant-сообщениям юзера в mode='chat'. */
export async function sumChatContextCharsToday(supabase: any, userId: string): Promise<number> {
  const minskNow = new Date();
  const dayStart = new Date(minskNow); dayStart.setUTCHours(21, 0, 0, 0);
  if (dayStart > minskNow) dayStart.setUTCDate(dayStart.getUTCDate() - 1);

  const { data } = await supabase
    .from('ai_chat_messages')
    .select('metadata')
    .eq('user_id', userId)
    .eq('role', 'assistant')
    .gte('created_at', dayStart.toISOString())
    .eq('metadata->>ai_mode', 'chat');

  const rows = (data || []) as Array<{ metadata: any }>;
  return rows.reduce((s, r) => s + (parseInt(r.metadata?.context_chars, 10) || 0), 0);
}

/** Количество user-сообщений юзера в mode='chat' за последние 60 секунд (для антифлуда). */
export async function countChatMessagesLastMinute(supabase: any, userId: string): Promise<number> {
  const sinceIso = new Date(Date.now() - 60_000).toISOString();
  const { count } = await supabase
    .from('ai_chat_messages')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('role', 'user')
    .eq('metadata->>ai_mode', 'chat')
    .gte('created_at', sinceIso);
  return count || 0;
}

const OFFTOPIC_SYSTEM = `Ты — строгий классификатор тематики запросов для бизнес-AI для предпринимателей РБ/РФ.
ON_TOPIC (on_topic=true): налоги, бухгалтерия, отчётность, ЕНВД/УСН/ОСН, НДС, подоходный, страховые взносы, МНС/ФНС, проверки, штрафы, кадры/ТК, договоры, акты, счета, ПУД, ИП, ООО, ЗАО, регистрация/ликвидация бизнеса, маркетплейсы, ВЭД, валютный контроль, банки/расчётные счета для бизнеса, эквайринг, ЭДО, ЭЦП, СББОЛ, Закрой год, 107-НК, бухгалтерское ПО.
OFF_TOPIC (on_topic=false): бытовые вопросы, медицина/здоровье/диета, путешествия, рецепты, погода, спорт, развлечения, фильмы/музыка, политика, общие энциклопедические факты (история, география, наука), программирование/IT (если не про бизнес-софт), личные отношения, психология, образование детей, домашние животные, ремонт квартиры, переводы текстов, помощь с домашкой/эссе, рерайт/копирайт общих текстов.
ПРАВИЛО: При явной не-бизнес теме → on_topic=false. При сомнении (запрос неоднозначный, может относиться к ИП) → on_topic=true.
Ответь строго JSON: {"on_topic": true|false, "reason": "..."}.`;

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
