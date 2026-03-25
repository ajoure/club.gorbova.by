import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const ALLOWED_EXTENSIONS = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.jpg', '.jpeg', '.png', '.webp'];
const ALLOWED_MIME_PREFIXES = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats', 'application/vnd.ms-excel', 'image/jpeg', 'image/png', 'image/webp'];
const MAX_FILES = 5;
const MAX_TOTAL_BYTES = 10 * 1024 * 1024; // 10MB
const MAX_TEXT_CHARS = 100000;

interface RequestBody {
  mode: 'chat' | 'prompt';
  messages: Array<{ role: string; content: string }>;
  prompt_id?: string;
  fileContents?: string;
  images?: Array<{ base64: string; filename: string; mimeType?: string }>;
  fileNames?: string[];
  conversation_id?: string;
}

function validateFileExtension(filename: string): boolean {
  const ext = filename.toLowerCase().substring(filename.lastIndexOf('.'));
  return ALLOWED_EXTENSIONS.includes(ext);
}

function validateMimeType(mime: string): boolean {
  return ALLOWED_MIME_PREFIXES.some(prefix => mime.startsWith(prefix));
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

    const body: RequestBody = await req.json();
    const { mode, messages, prompt_id, fileContents, images, fileNames, conversation_id } = body;

    if (!messages || !Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: 'messages обязательны' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 2. Service client for DB reads
    const serviceClient = createClient(supabaseUrl, supabaseServiceKey);

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
        totalBytes += (img.base64.length * 3) / 4; // approximate decoded size
      }
      if (totalBytes > MAX_TOTAL_BYTES) {
        return new Response(JSON.stringify({ error: 'Суммарный размер файлов превышает 10MB' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }
    if (fileContents && fileContents.length > MAX_TEXT_CHARS) {
      return new Response(JSON.stringify({ error: `Текст файлов превышает ${MAX_TEXT_CHARS} символов` }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 4. Load system context from ai_prompt_packages
    const { data: packages } = await serviceClient
      .from('ai_prompt_packages')
      .select('content')
      .eq('enabled', true);

    let systemPrompt = 'Ты — gorbova AI, профессиональный бизнес-ассистент. Отвечай на русском языке. Будь полезным, точным и структурированным.';
    if (packages && packages.length > 0) {
      systemPrompt += '\n\n' + packages.map((p: any) => p.content).join('\n\n');
    }

    // 5. Load prompt if prompt_id provided
    let promptData: any = null;
    const metadata: Record<string, any> = {};
    const startTime = Date.now();

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

      // Add prompt instructions to system prompt
      systemPrompt += '\n\n--- ИНСТРУКЦИЯ СЦЕНАРИЯ ---\n' + prompt.prompt_text;

      // Add response_format as instruction if present
      if (prompt.response_format) {
        systemPrompt += '\n\nФормат ответа (следуй этой структуре):\n' + JSON.stringify(prompt.response_format, null, 2);
      }
    }

    // 6. Build messages for AI
    const aiMessages: any[] = [{ role: 'system', content: systemPrompt }];

    // Add file contents as context if present
    if (fileContents) {
      const fileContextMsg = `--- СОДЕРЖИМОЕ ЗАГРУЖЕННЫХ ФАЙЛОВ ---\n${fileContents}\n--- КОНЕЦ ФАЙЛОВ ---`;
      aiMessages.push({ role: 'user', content: fileContextMsg });
      metadata.file_names = fileNames || [];
    }

    // Add conversation messages
    for (const msg of messages) {
      if (msg.role === 'user' || msg.role === 'assistant') {
        aiMessages.push({ role: msg.role, content: msg.content });
      }
    }

    // Add images as multimodal content
    if (images && images.length > 0) {
      const lastUserIdx = aiMessages.length - 1;
      if (lastUserIdx >= 0 && aiMessages[lastUserIdx].role === 'user') {
        const textContent = aiMessages[lastUserIdx].content;
        aiMessages[lastUserIdx].content = [
          { type: 'text', text: textContent },
          ...images.map(img => ({
            type: 'image_url',
            image_url: {
              url: `data:${img.mimeType || 'image/jpeg'};base64,${img.base64}`,
            },
          })),
        ];
      }
    }

    // 7. Call Lovable AI Gateway
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: 'AI сервис не настроен' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-pro',
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

    // 8. Save messages to ai_chat_messages
    const convId = conversation_id || crypto.randomUUID();
    metadata.processing_time_ms = Date.now() - startTime;

    // Save user message (last one)
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

    // Save assistant response
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
