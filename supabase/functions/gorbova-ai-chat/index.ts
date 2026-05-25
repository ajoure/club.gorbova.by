import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  resolveAiAccess,
  isModeAllowed,
  countUserMessages,
  limitsForKey,
  truncateHistory,
  classifyOffTopic,
  HARD_USER_MESSAGE_CHARS,
} from '../_shared/ai-access.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const ALLOWED_EXTENSIONS = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.jpg', '.jpeg', '.png', '.webp', '.rtf', '.csv', '.txt'];
const ALLOWED_MIME_PREFIXES = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats', 'application/vnd.ms-excel', 'image/jpeg', 'image/png', 'image/webp', 'application/rtf', 'text/rtf', 'text/csv', 'text/plain'];
const MAX_FILES = 5;
const MAX_TOTAL_BYTES = 10 * 1024 * 1024;
const MAX_TEXT_CHARS = 100000;

const MODEL_CHAT = 'google/gemini-2.5-flash';
const MODEL_PROMPT = 'google/gemini-2.5-pro';

async function writeAccessAudit(supabase: any, userId: string, action: string, details: Record<string, any>) {
  try {
    await supabase.from('audit_logs').insert({
      actor_id: userId,
      action,
      entity_type: 'ai_chat',
      details,
    });
  } catch (_e) { /* non-fatal */ }
}


const WEB_SYSTEM_PROMPT = `Ты — gorbova AI, профессиональный бизнес-ассистент для предпринимателей.
Отвечай на русском языке. Будь полезным, точным и структурированным.

КРИТИЧЕСКИ ВАЖНЫЕ ПРАВИЛА:
- Запрещено выдумывать, оценивать приблизительно, достраивать или предполагать числовые показатели, если они не извлечены из документа явно.
- Нельзя делать выводы о значениях только потому, что документ «похож на баланс» или содержит типовую структуру формы.
- Если данных нет — писать, что данных нет.
- Если файл пустой или нечитабельный — сообщать о невозможности анализа.
- Никогда не использовать «типовые», «примерные» или «ориентировочные» значения.
- Если невозможно рассчитать коэффициент из-за отсутствия данных, указать: «Данные для расчёта отсутствуют».`;

const ANTI_HALLUCINATION_SUFFIX = `

--- ОБЯЗАТЕЛЬНЫЕ ОГРАНИЧЕНИЯ ---
- Если в содержимом файлов нет явных числовых данных — НЕ рассчитывай коэффициенты, НЕ подставляй примерные значения, НЕ реконструируй данные по структуре формы.
- Нельзя делать выводы о значениях только потому, что документ «похож на баланс».
- Если данные извлечены частично — анализируй ТОЛЬКО извлечённые показатели, для остальных укажи: «Данные для расчёта отсутствуют».
- В начале ответа кратко перечисли, какие данные обнаружены в документе.`;

const PARTIAL_ANALYSIS_INSTRUCTION = `

ВАЖНО: Из документа удалось извлечь ограниченный объём данных.
Построй ответ по структуре:
1. Что удалось извлечь из документа
2. Чего не хватает для полного анализа
3. Анализ по имеющимся данным (только реально извлечённые показатели)
4. Ограничения выводов
5. Что загрузить для более точного анализа
НЕ выдумывай отсутствующие данные. Для показателей без данных пиши: «Не рассчитывается: данные отсутствуют».`;

const BLOCKED_SCENARIOS = ['file_analysis', 'document_review'];

interface UnsupportedFileInfo {
  name: string;
  reason: string;
  extension?: string;
}

interface RequestBody {
  mode: 'chat' | 'prompt';
  messages: Array<{ role: string; content: string }>;
  prompt_id?: string;
  fileContents?: string;
  images?: Array<{ base64: string; filename: string; mimeType?: string }>;
  fileNames?: string[];
  conversation_id?: string;
  unsupported_files?: UnsupportedFileInfo[];
}

function validateFileExtension(filename: string): boolean {
  const ext = filename.toLowerCase().substring(filename.lastIndexOf('.'));
  return ALLOWED_EXTENSIONS.includes(ext);
}

function validateMimeType(mime: string): boolean {
  return ALLOWED_MIME_PREFIXES.some(prefix => mime.startsWith(prefix));
}

function assessExtractQuality(text: string): { quality: 'ok' | 'low' | 'empty'; cleanedLength: number } {
  const cleaned = text
    .replace(/\[(PARSE_EMPTY|Изображение|PDF документ|FILE_PARSE_ERROR|Не удалось извлечь)[^\]]*\]/g, '')
    .trim();

  const cleanedLength = cleaned.length;
  const digits = (cleaned.match(/\d/g) || []).length;

  if (cleanedLength < 20 || digits === 0) {
    return { quality: 'empty', cleanedLength };
  }
  if (cleanedLength < 100 && digits < 5) {
    return { quality: 'low', cleanedLength };
  }
  return { quality: 'ok', cleanedLength };
}

const NON_CONTENT_MARKER_PATTERN = /\[(PARSE_EMPTY|UNSUPPORTED_FORMAT|Изображение|PDF документ|FILE_PARSE_ERROR|Не удалось извлечь)[^\]]*\]/g;

function stripNonContentMarkers(text: string): string {
  return (text || '').replace(NON_CONTENT_MARKER_PATTERN, '').trim();
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // 1. Auth
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Необходима авторизация' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Неавторизованный доступ' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 2. Parse body
    const body: RequestBody = await req.json();
    const { mode, messages, prompt_id, fileContents, images, fileNames, conversation_id } = body;

    if (!messages || !Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: 'messages обязательны' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 3. File guards
    if (fileNames && fileNames.length > MAX_FILES) {
      return new Response(JSON.stringify({ error: `Максимум ${MAX_FILES} файлов` }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (fileNames) {
      for (const fn of fileNames) {
        if (!validateFileExtension(fn)) {
          return new Response(JSON.stringify({ error: `Недопустимый тип файла: ${fn}` }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }
    }
    if (images) {
      if (images.length > MAX_FILES) {
        return new Response(JSON.stringify({ error: `Максимум ${MAX_FILES} файлов` }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      let totalBytes = 0;
      for (const img of images) {
        if (img.mimeType && !validateMimeType(img.mimeType)) {
          return new Response(JSON.stringify({ error: `Недопустимый MIME: ${img.mimeType}` }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        totalBytes += (img.base64.length * 3) / 4;
      }
      if (totalBytes > MAX_TOTAL_BYTES) {
        return new Response(JSON.stringify({ error: 'Суммарный размер файлов превышает 10MB' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // 4. Initialize metadata and timing
    const metadata: Record<string, any> = {};
    const startTime = Date.now();
    const hasImages = !!(images && images.length > 0);
    metadata.images_present = hasImages;
    metadata.ai_mode = mode === 'prompt' ? 'prompt' : 'chat';

    // 4.1 Hard cap на длину одного user-message
    const lastUserContent = messages?.[messages.length - 1]?.content || '';
    if (lastUserContent.length > HARD_USER_MESSAGE_CHARS) {
      const hasAttachment = !!fileContents || (fileNames && fileNames.length > 0) || hasImages;
      const errMsg = (lastUserContent.length >= 20_000 || hasAttachment)
        ? 'Сократите ввод или загрузите файл отдельным вложением (предел 50 000 символов на сообщение).'
        : 'Сократите запрос (предел 50 000 символов на сообщение).';
      return new Response(JSON.stringify({ error: errMsg, code: 'message_too_long' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 5. Truncate fileContents
    let processedFileContents = fileContents || '';
    const originalTextLength = processedFileContents.length;
    metadata.original_text_length = originalTextLength;

    if (processedFileContents && processedFileContents.length > MAX_TEXT_CHARS) {
      processedFileContents = processedFileContents.substring(0, MAX_TEXT_CHARS);
      metadata.file_truncated = true;
    }


    // 6. Load prompt if prompt_id provided
    const serviceClient = createClient(supabaseUrl, supabaseServiceKey);
    let promptData: any = null;

    if (prompt_id && mode === 'prompt') {
      const { data: prompt, error: promptError } = await serviceClient
        .from('ai_user_prompts')
        .select('*')
        .eq('id', prompt_id)
        .eq('is_active', true)
        .eq('is_archived', false)
        .eq('is_visible_in_chat', true)
        .single();

      if (promptError || !prompt) {
        return new Response(JSON.stringify({ error: 'Сценарий недоступен или не найден' }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      promptData = prompt;
      metadata.prompt_id = prompt.id;
      metadata.prompt_title_snapshot = prompt.title;
      metadata.launcher_title_snapshot = prompt.launcher_title;
      metadata.scenario_type = prompt.type;
      metadata.scenario_code = prompt.code || null;
    }

    // 6.1 Access check (entitlements-based). Default-deny при ошибке.
    const scenarioCode = promptData?.code || null;
    const access = await resolveAiAccess(serviceClient, user.id);
    metadata.access_tier = access.tier;
    const accessCheck = isModeAllowed(access, mode, scenarioCode);
    if (!accessCheck.allowed) {
      metadata.routing_reason = 'access_denied';
      metadata.denial_reason = accessCheck.reason;
      await writeAccessAudit(serviceClient, user.id, 'ai_chat.access_denied', {
        mode, scenario_code: scenarioCode, reason: accessCheck.reason, access_tier: access.tier,
      });
      return new Response(JSON.stringify({
        error: 'Эта функция AI недоступна на вашем тарифе.',
        code: 'access_denied_for_mode',
        denial_reason: accessCheck.reason,
        cta: { business_url: '/buhgalteria-kak-biznes', club_url: '/gorbova-club' },
      }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 6.2 Quota check (по нормализованным ai_mode / scenario_code)
    const limitKey: 'chat' | 'balance_analysis' | '107NK' | 'default_prompt' =
      mode === 'chat'
        ? 'chat'
        : (scenarioCode === 'balance_analysis' ? 'balance_analysis'
          : scenarioCode === '107NK' ? '107NK' : 'default_prompt');
    const limits = limitsForKey(limitKey);
    const used = await countUserMessages(serviceClient, user.id, mode === 'chat'
      ? { ai_mode: 'chat' }
      : { scenario_code: scenarioCode || undefined });
    metadata.quota_limit = limits;
    metadata.quota_used = used;
    if (used.daily >= limits.daily || used.monthly >= limits.monthly) {
      metadata.routing_reason = 'quota_denied';
      metadata.denial_reason = used.daily >= limits.daily ? 'daily_limit_reached' : 'monthly_limit_reached';
      await writeAccessAudit(serviceClient, user.id, 'ai_chat.quota_denied', {
        mode, scenario_code: scenarioCode, limit_key: limitKey, used, limits,
      });
      return new Response(JSON.stringify({
        error: `Достигнут лимит сообщений (${used.daily >= limits.daily ? `${limits.daily} в день` : `${limits.monthly} в месяц`}). Попробуйте позже.`,
        code: 'rate_limited_for_mode',
        limits, used,
      }), {
        status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 7. Unsupported files guard (BEFORE quality gate)

    const unsupportedFiles = body.unsupported_files;
    const hasUsableText = stripNonContentMarkers(processedFileContents).length > 0;
    const allFilesUnsupported =
      Array.isArray(fileNames) && fileNames.length > 0
      && Array.isArray(unsupportedFiles) && unsupportedFiles.length === fileNames.length
      && !hasImages
      && !hasUsableText;

    if (unsupportedFiles && unsupportedFiles.length > 0) {
      metadata.unsupported_files_count = unsupportedFiles.length;
      metadata.unsupported_reasons = unsupportedFiles.map(f => f.reason);
      metadata.unsupported_file_names = unsupportedFiles.map(f => f.name);
      metadata.unsupported_all_files = allFilesUnsupported;
    }

    if (allFilesUnsupported) {
      const convId = conversation_id || crypto.randomUUID();
      metadata.blocked = true;
      metadata.analysis_blocked_reason = 'unsupported_format';
      metadata.processing_time_ms = Date.now() - startTime;

      const blockedByUnsupportedReason: Record<string, string> = {
        binary_doc_not_supported: 'Формат .doc не поддерживается для извлечения текста. Пересохраните файл в .docx, PDF или загрузите изображение/скриншот документа.',
      };
      const firstReason = unsupportedFiles![0].reason;
      const blockedContent = blockedByUnsupportedReason[firstReason]
        ?? 'Формат файла не поддерживается. Загрузите файл в другом формате (PDF, .docx, изображение).';

      const lastUserMsg = messages[messages.length - 1];
      if (lastUserMsg) {
        await serviceClient.from('ai_chat_messages').insert({
          conversation_id: convId,
          user_id: user.id,
          role: 'user',
          content: lastUserMsg.content,
          metadata: fileNames ? { file_names: fileNames } : null,
        });
      }

      await serviceClient.from('ai_chat_messages').insert({
        conversation_id: convId,
        user_id: user.id,
        role: 'assistant',
        content: blockedContent,
        metadata,
      });

      return new Response(JSON.stringify({
        content: blockedContent,
        conversation_id: convId,
        blocked: true,
        metadata,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 8. Quality gate — block ONLY on empty (not low)
    const qualityResult = assessExtractQuality(processedFileContents);
    metadata.extract_quality = qualityResult.quality;
    metadata.cleaned_text_length = qualityResult.cleanedLength;
    metadata.extracted_text_length = qualityResult.cleanedLength;

    const filesWereProvided = !!(fileNames && fileNames.length > 0);
    metadata.parse_failed = filesWereProvided && !hasImages && qualityResult.quality === 'empty';

    const scenarioType = promptData?.type;
    const shouldBlock = BLOCKED_SCENARIOS.includes(scenarioType)
      && qualityResult.quality === 'empty'
      && !hasImages;

    if (shouldBlock) {
      const convId = conversation_id || crypto.randomUUID();
      metadata.blocked = true;
      metadata.analysis_blocked_reason = 'insufficient_data';
      metadata.processing_time_ms = Date.now() - startTime;

      const blockedByCode: Record<string, string> = {
        balance_analysis: 'Файл не содержит распознаваемых данных для анализа. Проверьте, что файл заполнен и содержит бухгалтерские показатели, или загрузите файл в другом формате (Excel, PDF, фото).',
      };
      const blockedByType: Record<string, string> = {
        file_analysis: 'Файл не содержит распознаваемых данных для анализа. Проверьте, что файл заполнен, или загрузите файл в другом формате (Excel, PDF, фото).',
        document_review: 'Файл не содержит распознаваемого текста для анализа. Загрузите документ в формате PDF, Word или фото.',
      };
      const defaultBlockedMsg = 'Файл не содержит распознаваемых данных для анализа. Проверьте, что файл заполнен, или загрузите файл в другом формате.';
      const blockedContent =
        (promptData?.code ? blockedByCode[promptData.code] : undefined) ??
        (promptData?.type ? blockedByType[promptData.type] : undefined) ??
        defaultBlockedMsg;

      const lastUserMsg = messages[messages.length - 1];
      if (lastUserMsg) {
        await serviceClient.from('ai_chat_messages').insert({
          conversation_id: convId,
          user_id: user.id,
          role: 'user',
          content: lastUserMsg.content,
          metadata: fileNames ? { file_names: fileNames } : null,
        });
      }

      await serviceClient.from('ai_chat_messages').insert({
        conversation_id: convId,
        user_id: user.id,
        role: 'assistant',
        content: blockedContent,
        metadata,
      });

      return new Response(JSON.stringify({
        content: blockedContent,
        conversation_id: convId,
        blocked: true,
        metadata,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Not blocked
    metadata.blocked = false;

    // 8. Build system prompt
    let systemPrompt = WEB_SYSTEM_PROMPT;

    // 8.1 Load and inject knowledge base from prompt attachments
    let knowledgeContext = '';
    if (promptData) {
      const { data: kbAttachments } = await serviceClient
        .from('ai_prompt_attachments')
        .select('extracted_text, file_name')
        .eq('prompt_id', promptData.id)
        .in('extraction_status', ['ready', 'truncated'])
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true });

      if (kbAttachments?.length) {
        const kbParts: string[] = [];
        let totalKbChars = 0;
        const KNOWLEDGE_LIMIT = 500000;

        for (const att of kbAttachments) {
          if (!att.extracted_text) continue;
          if (totalKbChars + att.extracted_text.length > KNOWLEDGE_LIMIT) {
            metadata.knowledge_truncated = true;
            break;
          }
          kbParts.push(`--- Файл: ${att.file_name} ---\n${att.extracted_text}\n--- Конец файла ---`);
          totalKbChars += att.extracted_text.length;
        }

        metadata.knowledge_files_used = kbParts.length;
        metadata.knowledge_total_chars = totalKbChars;

        if (kbParts.length) {
          knowledgeContext = '\n\n--- БАЗА ЗНАНИЙ СЦЕНАРИЯ ---\n' + kbParts.join('\n\n') + '\n--- КОНЕЦ БАЗЫ ЗНАНИЙ ---';
        }
      }
    }

    if (knowledgeContext) {
      systemPrompt += knowledgeContext;
    }

    // 9. Inject scenario prompt_text + anti-hallucination suffix
    if (promptData) {
      systemPrompt += '\n\n--- ИНСТРУКЦИЯ СЦЕНАРИЯ ---\n' + promptData.prompt_text;

      if (promptData.response_format) {
        systemPrompt += '\n\nФормат ответа (следуй этой структуре):\n' + JSON.stringify(promptData.response_format, null, 2);
      }

      systemPrompt += ANTI_HALLUCINATION_SUFFIX;

      // Partial analysis mode for low quality in file scenarios
      if (qualityResult.quality === 'low' && BLOCKED_SCENARIOS.includes(scenarioType)) {
        metadata.partial_analysis_mode = true;
        systemPrompt += PARTIAL_ANALYSIS_INSTRUCTION;
      }
    }

    // 10. Build messages for AI (с усечением истории + off-topic для chat)
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: 'AI сервис не настроен' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 10.1 Truncation
    const dialog = messages.filter(m => m.role === 'user' || m.role === 'assistant');
    const fileContextMsg = processedFileContents
      ? `--- СОДЕРЖИМОЕ ЗАГРУЖЕННЫХ ФАЙЛОВ ---\n${processedFileContents}\n--- КОНЕЦ ФАЙЛОВ ---`
      : null;
    const trunc = truncateHistory(dialog, systemPrompt, fileContextMsg);
    metadata.truncated = trunc.truncated;
    metadata.dropped_messages_count = trunc.dropped_messages_count;
    metadata.dropped_chars = trunc.dropped_chars;
    metadata.context_messages_count = trunc.context_messages_count;
    metadata.context_chars = trunc.context_chars;

    // 10.2 Off-topic — ТОЛЬКО для свободного чата
    if (mode === 'chat' && !hasImages && !fileContextMsg) {
      const topicResult = await classifyOffTopic(LOVABLE_API_KEY, lastUserContent);
      metadata.topic_check = topicResult;
      if (!topicResult.on_topic) {
        metadata.routing_reason = 'offtopic_blocked';
        metadata.model_used = 'shortcut_template';
        const convId = conversation_id || crypto.randomUUID();
        const reply = 'Я помогаю по вопросам бизнеса, налогов и бухгалтерии РБ. Для общих и бытовых вопросов воспользуйтесь, пожалуйста, другим сервисом.';

        await serviceClient.from('ai_chat_messages').insert({
          conversation_id: convId, user_id: user.id, role: 'user', content: lastUserContent,
          metadata: { ai_mode: 'chat' },
        });
        await serviceClient.from('ai_chat_messages').insert({
          conversation_id: convId, user_id: user.id, role: 'assistant', content: reply,
          metadata: { ...metadata, processing_time_ms: Date.now() - startTime },
        });

        return new Response(JSON.stringify({ content: reply, conversation_id: convId, metadata }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    const aiMessages: any[] = [{ role: 'system', content: systemPrompt }];
    if (fileContextMsg) {
      aiMessages.push({ role: 'user', content: fileContextMsg });
      metadata.file_names = fileNames || [];
    }
    for (const msg of trunc.messages) {
      aiMessages.push({ role: msg.role, content: msg.content });
    }

    if (hasImages) {
      const lastUserIdx = aiMessages.length - 1;
      if (lastUserIdx >= 0 && aiMessages[lastUserIdx].role === 'user') {
        const textContent = aiMessages[lastUserIdx].content;
        aiMessages[lastUserIdx].content = [
          { type: 'text', text: textContent },
          ...images!.map(img => ({
            type: 'image_url',
            image_url: {
              url: `data:${img.mimeType || 'image/jpeg'};base64,${img.base64}`,
            },
          })),
        ];
      }
    }

    // 11. Call Lovable AI Gateway — модель по режиму
    const chosenModel = mode === 'chat' ? MODEL_CHAT : MODEL_PROMPT;
    metadata.model_used = chosenModel;
    metadata.routing_reason = mode === 'chat' ? 'free_chat_flash' : 'scenario_pro';

    const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: chosenModel,
        messages: aiMessages,
        stream: false,
      }),
    });


    if (!aiResponse.ok) {
      const status = aiResponse.status;
      if (status === 429) {
        return new Response(JSON.stringify({ error: 'Слишком много запросов. Попробуйте позже.' }), {
          status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (status === 402) {
        return new Response(JSON.stringify({ error: 'Исчерпан лимит AI. Обратитесь к администратору.' }), {
          status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const errText = await aiResponse.text();
      console.error('AI gateway error:', status, errText);
      return new Response(JSON.stringify({ error: 'Ошибка AI сервиса' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const aiResult = await aiResponse.json();
    const assistantContent = aiResult.choices?.[0]?.message?.content || 'Нет ответа от AI';

    // 12. Save messages
    const convId = conversation_id || crypto.randomUUID();
    metadata.processing_time_ms = Date.now() - startTime;

    const lastUserMsg = messages[messages.length - 1];
    if (lastUserMsg) {
      await serviceClient.from('ai_chat_messages').insert({
        conversation_id: convId,
        user_id: user.id,
        role: 'user',
        content: lastUserMsg.content,
        metadata: {
          ai_mode: metadata.ai_mode,
          scenario_code: metadata.scenario_code || null,
          ...(fileNames ? { file_names: fileNames } : {}),
        },
      });
    }


    await serviceClient.from('ai_chat_messages').insert({
      conversation_id: convId,
      user_id: user.id,
      role: 'assistant',
      content: assistantContent,
      metadata,
    });

    return new Response(JSON.stringify({
      content: assistantContent,
      conversation_id: convId,
      metadata,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('gorbova-ai-chat error:', err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : 'Внутренняя ошибка' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
