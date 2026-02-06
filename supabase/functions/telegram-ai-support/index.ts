/**
 * AI Support Bot "Oleg" for Telegram
 * 
 * Handles:
 * - Support: answering questions about subscriptions, products, access
 * - Sales: generating payment links, upselling
 * - Smalltalk: friendly conversation with context memory
 * - Handoff: escalating to human when confidence is low
 */

import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, handleCorsPreflightRequest, jsonResponse, errorResponse } from '../_shared/cors.ts';

// =============================================
// TYPES
// =============================================

interface AISupportRequest {
  telegramUserId: number;
  messageText: string;
  botId: string;
  messageId: number;
  chatId: number;
}

interface AISupportResponse {
  reply: string;
  intent: 'support' | 'sales' | 'billing' | 'smalltalk' | 'handoff' | 'unknown';
  confidence: number;
  used_tools: string[];
  safety_flags: string[];
  handoff_created?: boolean;
  skipped_reason?: string;
}

interface BotSettings {
  style_preset: string;
  toggles: {
    auto_reply_enabled: boolean;
    irony_enabled: boolean;
    smalltalk_enabled: boolean;
    sales_enabled: boolean;
    support_enabled: boolean;
    faq_first_enabled: boolean;
    quiet_hours_enabled: boolean;
  };
  sliders: {
    brevity_level: number;
    warmth_level: number;
    formality_level: number;
    sales_assertiveness: number;
    humor_level: number;
    risk_aversion: number;
  };
  templates: {
    greeting_template: string;
    followup_template: string;
    escalation_template: string;
    fallback_template: string;
    sales_close_template: string;
  };
  quiet_hours: {
    enabled: boolean;
    start: string;
    end: string;
    message: string;
  };
  active_prompt_packages: string[];
  confidence_threshold: number;
  max_messages_per_minute: number;
}

interface ConversationContext {
  messages: Array<{ role: 'user' | 'assistant'; content: string; timestamp: string }>;
  last_topics_summary: string | null;
  last_intent: string | null;
  user_tone_preference: { formality: string; style: string } | null;
}

// =============================================
// CONSTANTS
// =============================================

const LOVABLE_API_URL = 'https://api.lovable.dev/v1/chat/completions';

const PRESET_DESCRIPTIONS: Record<string, string> = {
  strict: 'Отвечай коротко, по делу, без смайлов и лишних слов. Дисциплина важнее теплоты.',
  diplomatic: 'Отвечай вежливо и спокойно, без давления. Уважай личное пространство собеседника.',
  legal: 'Отвечай формально, используй точные формулировки. "Читайте и понимайте дословно."',
  flirt: 'Общайся дружелюбно с лёгким флиртом (безопасным). Если собеседник формален — переключись на "вы".',
  friendly: 'Общайся тепло, коротко и человечно. Будь открытым и позитивным.',
  sales: 'Уверенно предлагай решения. Выясни потребность за 1-2 вопроса и предложи подходящий вариант.',
  support_calm: 'Используй деэскалацию и эмпатию. Структурируй ответ по шагам. Спокойствие прежде всего.',
  humor_irony: 'Используй мягкую иронию и юмор. Но никогда не шути над проблемами пользователя.',
  concierge_premium: 'Веди себя как премиум-консьерж. Очень заботливо, проактивно предлагай варианты.',
  crisis_deescalation: 'Максимум спокойствия, минимум слов. При необходимости сразу передай руководителю.',
};

const INTENT_KEYWORDS: Record<string, string[]> = {
  billing: ['оплата', 'ссылка', 'чек', 'списание', 'счёт', 'платёж', 'оплатить', 'продлить'],
  support: ['проблема', 'вопрос', 'ошибка', 'не работает', 'как', 'помогите', 'инструкция', 'не могу'],
  sales: ['купить', 'тариф', 'цена', 'стоимость', 'что входит', 'подписка', 'доступ'],
  smalltalk: ['привет', 'как дела', 'здравствуй', 'доброе утро', 'добрый день', 'добрый вечер'],
  handoff: ['оператор', 'человек', 'руководител', 'не помогает', 'администратор', 'менеджер'],
};

// =============================================
// HELPER FUNCTIONS
// =============================================

function detectIntent(text: string): { intent: string; confidence: number } {
  const lowerText = text.toLowerCase();
  const scores: Record<string, number> = {};
  
  for (const [intent, keywords] of Object.entries(INTENT_KEYWORDS)) {
    let score = 0;
    for (const keyword of keywords) {
      if (lowerText.includes(keyword)) {
        score += 1;
      }
    }
    if (score > 0) {
      scores[intent] = score / keywords.length;
    }
  }
  
  const entries = Object.entries(scores);
  if (entries.length === 0) {
    return { intent: 'unknown', confidence: 0.3 };
  }
  
  entries.sort((a, b) => b[1] - a[1]);
  const [topIntent, topScore] = entries[0];
  
  // Normalize confidence
  const confidence = Math.min(0.95, 0.5 + topScore * 0.5);
  
  return { intent: topIntent, confidence };
}

function isInQuietHours(quietHours: BotSettings['quiet_hours']): boolean {
  if (!quietHours.enabled) return false;
  
  const now = new Date();
  const currentTime = now.toTimeString().slice(0, 5); // HH:MM
  
  const start = quietHours.start;
  const end = quietHours.end;
  
  // Handle overnight quiet hours (e.g., 22:00 - 08:00)
  if (start > end) {
    return currentTime >= start || currentTime < end;
  }
  
  return currentTime >= start && currentTime < end;
}

function buildSystemPrompt(
  settings: BotSettings,
  promptPackages: Array<{ code: string; content: string }>,
  userContext: {
    firstName: string;
    subscriptionsSummary: string;
    lastTopicsSummary: string | null;
    userTonePreference: { formality: string; style: string } | null;
  },
  productsCatalog: string
): string {
  const presetDescription = PRESET_DESCRIPTIONS[settings.style_preset] || PRESET_DESCRIPTIONS.friendly;
  
  // Build sliders description
  const sliderDescriptions = [
    `- Краткость: ${settings.sliders.brevity_level}% (0=подробно, 100=очень коротко)`,
    `- Теплота: ${settings.sliders.warmth_level}% (0=сухо, 100=очень тепло)`,
    `- Формальность: ${settings.sliders.formality_level}% (0=на ты, 100=строго на вы)`,
    `- Юмор: ${settings.sliders.humor_level}% (0=без юмора, 100=много иронии)`,
  ].join('\n');
  
  // Collect active prompt packages
  const packagesContent = promptPackages
    .filter(p => settings.active_prompt_packages.includes(p.code))
    .map(p => `=== ${p.code} ===\n${p.content}`)
    .join('\n\n');
  
  // User formality preference
  const formalityNote = userContext.userTonePreference?.formality === 'formal'
    ? 'Пользователь предпочитает обращение на "вы".'
    : userContext.userTonePreference?.formality === 'informal'
    ? 'Пользователь предпочитает обращение на "ты".'
    : '';
  
  return `Ты — Олег, бот поддержки клуба «Буква закона» Катерины Горбовой.

== ТВОЯ ЛИЧНОСТЬ ==
${presetDescription}

== ПРАВИЛА ОБЩЕНИЯ ==
${sliderDescriptions}

${formalityNote}

== КОНТЕКСТ ПОЛЬЗОВАТЕЛЯ ==
Имя: ${userContext.firstName || 'Пользователь'}
Активные подписки: ${userContext.subscriptionsSummary || 'Нет активных подписок'}
${userContext.lastTopicsSummary ? `Последняя тема разговора: ${userContext.lastTopicsSummary}` : ''}

== ДОСТУПНЫЕ ПРОДУКТЫ ==
${productsCatalog}

== АКТИВНЫЕ МОДУЛИ ==
${packagesContent}

== ИНСТРУМЕНТЫ ==
У тебя есть доступ к функциям:
- get_user_subscriptions: показать активные подписки пользователя
- get_product_catalog: получить список продуктов и тарифов
- generate_payment_link: создать ссылку на оплату

== ОГРАНИЧЕНИЯ (КРИТИЧЕСКИ ВАЖНО) ==
- НИКОГДА не выдавай данные других пользователей
- НИКОГДА не упоминай внутренние ID, токены, названия таблиц
- НЕ логируй и не упоминай email/телефон/адрес
- При неясном вопросе — уточняй
- При низкой уверенности в ответе — передай человеку

== ФОРМАТ ОТВЕТА ==
Отвечай кратко и по делу. Используй HTML-форматирование для Telegram:
- <b>жирный</b> для важного
- <i>курсив</i> для примеров
Не используй markdown.`;
}

// =============================================
// AI TOOLS DEFINITIONS
// =============================================

const AI_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'get_user_subscriptions',
      description: 'Получить список активных подписок пользователя',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_product_catalog',
      description: 'Получить список доступных продуктов и тарифов',
      parameters: {
        type: 'object',
        properties: {
          category: {
            type: 'string',
            description: 'Категория продуктов (опционально)',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'generate_payment_link',
      description: 'Создать ссылку на оплату продукта',
      parameters: {
        type: 'object',
        properties: {
          product_code: {
            type: 'string',
            description: 'Код продукта',
          },
          tariff_code: {
            type: 'string',
            description: 'Код тарифа',
          },
        },
        required: ['product_code'],
      },
    },
  },
];

// =============================================
// TOOL EXECUTION
// =============================================

async function executeTool(
  supabase: any,
  toolName: string,
  args: Record<string, any>,
  context: { userId: string | null; telegramUserId: number }
): Promise<{ result: any; error?: string }> {
  try {
    switch (toolName) {
      case 'get_user_subscriptions': {
        if (!context.userId) {
          return { result: 'Telegram не привязан к аккаунту. Подписки недоступны.' };
        }
        
        const { data: subs } = await supabase
          .from('subscriptions_v2')
          .select(`
            id,
            status,
            current_period_end,
            tariffs!inner(name, products_v2!inner(name))
          `)
          .eq('profile_id', context.userId)
          .in('status', ['active', 'trialing', 'past_due']);
        
        if (!subs || subs.length === 0) {
          return { result: 'У вас нет активных подписок.' };
        }
        
        const summary = subs.map((s: any) => {
          const productName = s.tariffs?.products_v2?.name || 'Продукт';
          const tariffName = s.tariffs?.name || 'Тариф';
          const endDate = s.current_period_end 
            ? new Date(s.current_period_end).toLocaleDateString('ru-RU')
            : 'бессрочно';
          return `• ${productName} (${tariffName}) — до ${endDate}`;
        }).join('\n');
        
        return { result: summary };
      }
      
      case 'get_product_catalog': {
        const { data: products } = await supabase
          .from('products_v2')
          .select(`
            code,
            name,
            description,
            tariffs!inner(code, name, price, billing_period)
          `)
          .eq('status', 'published')
          .eq('tariffs.status', 'published');
        
        if (!products || products.length === 0) {
          return { result: 'Продукты временно недоступны.' };
        }
        
        const catalog = products.map((p: any) => {
          const tariffs = p.tariffs.map((t: any) => {
            const price = t.price ? `${t.price} BYN` : 'бесплатно';
            const period = t.billing_period === 'month' ? '/мес' : t.billing_period === 'year' ? '/год' : '';
            return `  - ${t.name}: ${price}${period}`;
          }).join('\n');
          return `<b>${p.name}</b>\n${p.description || ''}\n${tariffs}`;
        }).join('\n\n');
        
        return { result: catalog };
      }
      
      case 'generate_payment_link': {
        if (!context.userId) {
          return { result: null, error: 'Для оплаты нужно привязать Telegram к аккаунту.' };
        }
        
        const productCode = args.product_code;
        const tariffCode = args.tariff_code;
        
        // Find product and tariff
        const { data: tariff } = await supabase
          .from('tariffs')
          .select('id, name, price, products_v2!inner(id, code, name)')
          .eq('products_v2.code', productCode)
          .eq('status', 'published')
          .order('price', { ascending: true })
          .limit(1)
          .maybeSingle();
        
        if (!tariff) {
          return { result: null, error: `Продукт "${productCode}" не найден.` };
        }
        
        // Create a simple checkout URL (uses existing bepaid flow)
        const siteUrl = Deno.env.get('SITE_URL') || 'https://gorbova.lovable.app';
        const checkoutUrl = `${siteUrl}/checkout?product=${productCode}${tariffCode ? `&tariff=${tariffCode}` : ''}`;
        
        return { result: checkoutUrl };
      }
      
      default:
        return { result: null, error: `Unknown tool: ${toolName}` };
    }
  } catch (err) {
    console.error(`Tool ${toolName} error:`, err);
    return { result: null, error: String(err) };
  }
}

// =============================================
// MAIN HANDLER
// =============================================

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return handleCorsPreflightRequest();
  }

  const startTime = Date.now();
  
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY');
    
    if (!lovableApiKey) {
      console.error('LOVABLE_API_KEY not configured');
      return errorResponse('AI service not configured', 500);
    }
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    const body: AISupportRequest = await req.json();
    const { telegramUserId, messageText, botId, messageId, chatId } = body;
    
    if (!telegramUserId || !messageText || !botId || !messageId) {
      return errorResponse('Missing required fields');
    }
    
    console.log(`[AI Support] Processing message ${messageId} from user ${telegramUserId}`);
    
    // ==========================================
    // 1. IDEMPOTENCY CHECK
    // ==========================================
    const { data: existingProcessed } = await supabase
      .from('telegram_ai_processed_messages')
      .select('id')
      .eq('telegram_message_id', messageId)
      .eq('bot_id', botId)
      .maybeSingle();
    
    if (existingProcessed) {
      console.log(`[AI Support] Message ${messageId} already processed, skipping`);
      return jsonResponse({
        reply: null,
        intent: 'unknown',
        confidence: 0,
        used_tools: [],
        safety_flags: [],
        skipped_reason: 'already_processed',
      } as AISupportResponse);
    }
    
    // Mark as processing
    await supabase.from('telegram_ai_processed_messages').insert({
      telegram_message_id: messageId,
      bot_id: botId,
      telegram_user_id: telegramUserId,
      response_sent: false,
    });
    
    // ==========================================
    // 2. LOAD BOT SETTINGS
    // ==========================================
    const { data: settingsRow } = await supabase
      .from('ai_bot_settings')
      .select('*')
      .eq('bot_id', botId)
      .maybeSingle();
    
    const settings: BotSettings = settingsRow || {
      style_preset: 'friendly',
      toggles: {
        auto_reply_enabled: true,
        irony_enabled: false,
        smalltalk_enabled: true,
        sales_enabled: true,
        support_enabled: true,
        faq_first_enabled: false,
        quiet_hours_enabled: false,
      },
      sliders: {
        brevity_level: 50,
        warmth_level: 70,
        formality_level: 50,
        sales_assertiveness: 30,
        humor_level: 20,
        risk_aversion: 60,
      },
      templates: {
        greeting_template: 'Привет! Я Олег. Чем могу помочь?',
        followup_template: 'Как там ваша ситуация — получилось?',
        escalation_template: 'Передаю ваш вопрос руководителю. Вернёмся с ответом.',
        fallback_template: 'Не совсем понял вопрос. Можете уточнить?',
        sales_close_template: 'Готово! Вот ссылка на оплату:',
      },
      quiet_hours: { enabled: false, start: '22:00', end: '08:00', message: '' },
      active_prompt_packages: ['support_base', 'tone_katerina'],
      confidence_threshold: 0.55,
      max_messages_per_minute: 10,
    };
    
    // Check if AI is enabled
    if (!settings.toggles.auto_reply_enabled) {
      console.log(`[AI Support] Auto-reply disabled for bot ${botId}`);
      return jsonResponse({
        reply: null,
        intent: 'unknown',
        confidence: 0,
        used_tools: [],
        safety_flags: [],
        skipped_reason: 'auto_reply_disabled',
      } as AISupportResponse);
    }
    
    // ==========================================
    // 3. CHECK HANDOFF STATUS
    // ==========================================
    const { data: activeHandoff } = await supabase
      .from('ai_handoffs')
      .select('id, status')
      .eq('telegram_user_id', telegramUserId)
      .eq('bot_id', botId)
      .in('status', ['open', 'waiting_human'])
      .maybeSingle();
    
    if (activeHandoff) {
      console.log(`[AI Support] Active handoff exists for user ${telegramUserId}, skipping AI`);
      return jsonResponse({
        reply: null,
        intent: 'handoff',
        confidence: 1,
        used_tools: [],
        safety_flags: ['active_handoff'],
        skipped_reason: 'handoff_active',
      } as AISupportResponse);
    }
    
    // ==========================================
    // 4. QUIET HOURS CHECK
    // ==========================================
    if (isInQuietHours(settings.quiet_hours)) {
      console.log(`[AI Support] Quiet hours active`);
      return jsonResponse({
        reply: settings.quiet_hours.message || 'Спасибо за сообщение! Ответим в рабочее время.',
        intent: 'unknown',
        confidence: 1,
        used_tools: [],
        safety_flags: ['quiet_hours'],
      } as AISupportResponse);
    }
    
    // ==========================================
    // 5. RATE LIMIT CHECK
    // ==========================================
    const oneMinuteAgo = new Date(Date.now() - 60000).toISOString();
    const { data: rateData } = await supabase
      .from('ai_rate_limits')
      .select('count, window_start')
      .eq('telegram_user_id', telegramUserId)
      .eq('action_type', 'message')
      .gte('window_start', oneMinuteAgo)
      .maybeSingle();
    
    if (rateData && rateData.count >= settings.max_messages_per_minute) {
      console.log(`[AI Support] Rate limit exceeded for user ${telegramUserId}`);
      return jsonResponse({
        reply: 'Пожалуйста, подождите немного. Слишком много сообщений за короткое время.',
        intent: 'unknown',
        confidence: 1,
        used_tools: [],
        safety_flags: ['rate_limited'],
      } as AISupportResponse);
    }
    
    // Update rate limit counter
    await supabase.from('ai_rate_limits').upsert({
      telegram_user_id: telegramUserId,
      action_type: 'message',
      count: (rateData?.count || 0) + 1,
      window_start: rateData?.window_start || new Date().toISOString(),
    }, { onConflict: 'telegram_user_id,action_type' });
    
    // ==========================================
    // 6. LOAD USER CONTEXT
    // ==========================================
    const { data: profile } = await supabase
      .from('profiles')
      .select('id, user_id, first_name')
      .eq('telegram_user_id', telegramUserId)
      .maybeSingle();
    
    const userId = profile?.user_id || null;
    const firstName = profile?.first_name || 'Пользователь';
    
    // Load or create conversation
    const { data: conversation } = await supabase
      .from('telegram_ai_conversations')
      .select('*')
      .eq('telegram_user_id', telegramUserId)
      .eq('bot_id', botId)
      .maybeSingle();
    
    const conversationContext: ConversationContext = conversation || {
      messages: [],
      last_topics_summary: null,
      last_intent: null,
      user_tone_preference: null,
    };
    
    // Get subscriptions summary
    let subscriptionsSummary = 'Нет активных подписок';
    if (userId) {
      const { data: subs } = await supabase
        .from('subscriptions_v2')
        .select('status, tariffs!inner(name, products_v2!inner(name))')
        .eq('profile_id', userId)
        .in('status', ['active', 'trialing']);
      
      if (subs && subs.length > 0) {
        subscriptionsSummary = subs.map((s: any) => 
          `${s.tariffs?.products_v2?.name || 'Продукт'} (${s.tariffs?.name || 'тариф'})`
        ).join(', ');
      }
    }
    
    // ==========================================
    // 7. LOAD PROMPT PACKAGES
    // ==========================================
    const { data: promptPackages } = await supabase
      .from('ai_prompt_packages')
      .select('code, content')
      .eq('enabled', true);
    
    // ==========================================
    // 8. BUILD PRODUCTS CATALOG
    // ==========================================
    const { data: products } = await supabase
      .from('products_v2')
      .select('code, name, description, tariffs!inner(code, name, price)')
      .eq('status', 'published')
      .limit(10);
    
    const productsCatalog = (products || []).map((p: any) => {
      const tariffs = (p.tariffs || []).map((t: any) => `${t.name}: ${t.price} BYN`).join(', ');
      return `• ${p.name}: ${tariffs}`;
    }).join('\n') || 'Продукты недоступны';
    
    // ==========================================
    // 9. DETECT INTENT
    // ==========================================
    const { intent: detectedIntent, confidence: detectedConfidence } = detectIntent(messageText);
    
    // Check if handoff needed
    const needsHandoff = detectedIntent === 'handoff' || detectedConfidence < settings.confidence_threshold;
    
    if (needsHandoff && settings.sliders.risk_aversion > 70) {
      // Create handoff
      await supabase.from('ai_handoffs').insert({
        telegram_user_id: telegramUserId,
        user_id: userId,
        bot_id: botId,
        status: 'waiting_human',
        reason: detectedIntent === 'handoff' ? 'user_requested' : 'low_confidence',
        last_message_id: messageId,
        meta: { detected_intent: detectedIntent, confidence: detectedConfidence },
      });
      
      // Log audit
      await supabase.from('audit_logs').insert({
        actor_type: 'system',
        actor_user_id: null,
        actor_label: 'telegram-ai-support',
        action: 'telegram.ai.handoff_created',
        target_user_id: userId,
        meta: {
          telegram_user_id: telegramUserId,
          reason: detectedIntent === 'handoff' ? 'user_requested' : 'low_confidence',
          confidence: detectedConfidence,
        },
      });
      
      return jsonResponse({
        reply: settings.templates.escalation_template,
        intent: 'handoff',
        confidence: detectedConfidence,
        used_tools: [],
        safety_flags: ['handoff_created'],
        handoff_created: true,
      } as AISupportResponse);
    }
    
    // ==========================================
    // 10. BUILD SYSTEM PROMPT
    // ==========================================
    const systemPrompt = buildSystemPrompt(
      settings,
      promptPackages || [],
      {
        firstName,
        subscriptionsSummary,
        lastTopicsSummary: conversationContext.last_topics_summary,
        userTonePreference: conversationContext.user_tone_preference as any,
      },
      productsCatalog
    );
    
    // ==========================================
    // 11. BUILD MESSAGES
    // ==========================================
    const aiMessages: Array<{ role: string; content: string }> = [
      { role: 'system', content: systemPrompt },
    ];
    
    // Add conversation history (last 10 messages)
    const recentMessages = (conversationContext.messages || []).slice(-10);
    for (const msg of recentMessages) {
      aiMessages.push({ role: msg.role, content: msg.content });
    }
    
    // Add current user message
    aiMessages.push({ role: 'user', content: messageText });
    
    // ==========================================
    // 12. CALL LOVABLE AI
    // ==========================================
    console.log(`[AI Support] Calling Lovable AI with ${aiMessages.length} messages`);
    
    const aiResponse = await fetch(LOVABLE_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${lovableApiKey}`,
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: aiMessages,
        tools: AI_TOOLS,
        tool_choice: 'auto',
        temperature: settings.style_preset === 'strict' ? 0.3 : 0.7,
        max_tokens: 500,
      }),
    });
    
    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error(`[AI Support] Lovable AI error: ${aiResponse.status} - ${errorText}`);
      return jsonResponse({
        reply: settings.templates.fallback_template,
        intent: 'unknown',
        confidence: 0,
        used_tools: [],
        safety_flags: ['ai_error'],
      } as AISupportResponse);
    }
    
    const aiData = await aiResponse.json();
    const aiChoice = aiData.choices?.[0];
    
    // ==========================================
    // 13. PROCESS TOOL CALLS
    // ==========================================
    const usedTools: string[] = [];
    let finalReply = '';
    
    if (aiChoice?.message?.tool_calls) {
      // Execute tools
      const toolResults: string[] = [];
      
      for (const toolCall of aiChoice.message.tool_calls) {
        const toolName = toolCall.function.name;
        const toolArgs = JSON.parse(toolCall.function.arguments || '{}');
        
        console.log(`[AI Support] Executing tool: ${toolName}`);
        usedTools.push(toolName);
        
        const { result, error } = await executeTool(supabase, toolName, toolArgs, {
          userId,
          telegramUserId,
        });
        
        if (error) {
          toolResults.push(`Tool ${toolName} error: ${error}`);
        } else {
          toolResults.push(`Tool ${toolName} result:\n${result}`);
        }
      }
      
      // Call AI again with tool results
      aiMessages.push(aiChoice.message);
      for (let i = 0; i < aiChoice.message.tool_calls.length; i++) {
        aiMessages.push({
          role: 'tool',
          content: toolResults[i],
        });
      }
      
      const followupResponse = await fetch(LOVABLE_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${lovableApiKey}`,
        },
        body: JSON.stringify({
          model: 'google/gemini-2.5-flash',
          messages: aiMessages,
          temperature: 0.7,
          max_tokens: 500,
        }),
      });
      
      if (followupResponse.ok) {
        const followupData = await followupResponse.json();
        finalReply = followupData.choices?.[0]?.message?.content || settings.templates.fallback_template;
      } else {
        finalReply = settings.templates.fallback_template;
      }
    } else {
      // Direct response without tools
      finalReply = aiChoice?.message?.content || settings.templates.fallback_template;
    }
    
    // ==========================================
    // 14. SAVE CONVERSATION
    // ==========================================
    const newMessages = [
      ...conversationContext.messages,
      { role: 'user' as const, content: messageText, timestamp: new Date().toISOString() },
      { role: 'assistant' as const, content: finalReply, timestamp: new Date().toISOString() },
    ].slice(-20); // Keep last 20 messages
    
    await supabase.from('telegram_ai_conversations').upsert({
      telegram_user_id: telegramUserId,
      user_id: userId,
      bot_id: botId,
      messages: newMessages,
      last_message_at: new Date().toISOString(),
      last_intent: detectedIntent,
      last_confidence: detectedConfidence,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'telegram_user_id,bot_id' });
    
    // Mark as processed with response sent
    await supabase
      .from('telegram_ai_processed_messages')
      .update({ response_sent: true })
      .eq('telegram_message_id', messageId)
      .eq('bot_id', botId);
    
    // ==========================================
    // 15. AUDIT LOG
    // ==========================================
    const processingMs = Date.now() - startTime;
    
    await supabase.from('audit_logs').insert({
      actor_type: 'system',
      actor_user_id: null,
      actor_label: 'telegram-ai-support',
      action: 'telegram.ai.reply',
      target_user_id: userId,
      meta: {
        telegram_user_id: telegramUserId,
        intent: detectedIntent,
        confidence: detectedConfidence,
        used_tools: usedTools,
        response_length: finalReply.length,
        processing_ms: processingMs,
      },
    });
    
    console.log(`[AI Support] Reply generated in ${processingMs}ms, intent: ${detectedIntent}, tools: ${usedTools.join(',') || 'none'}`);
    
    return jsonResponse({
      reply: finalReply,
      intent: detectedIntent,
      confidence: detectedConfidence,
      used_tools: usedTools,
      safety_flags: [],
    } as AISupportResponse);
    
  } catch (error) {
    console.error('[AI Support] Fatal error:', error);
    return errorResponse(error instanceof Error ? error.message : 'Unknown error', 500);
  }
});
