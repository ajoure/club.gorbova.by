import { createClient } from 'npm:@supabase/supabase-js@2';
import { MNS_SCENARIO_CODE, MNS_UNAVAILABLE, mnsReplyNeedsClarification } from '../gorbova-ai-chat/mns-current-law.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

// Compatibility endpoint for the audits page and already-open old clients.
// No second legal prompt, model call, access bypass, or document-history write.
Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return reply({ error: 'Метод не поддерживается' }, 405);
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) return reply({ error: 'Необходима авторизация' }, 401);
    const url = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return reply({ error: 'Неавторизованный доступ' }, 401);

    let body: any;
    try { body = await req.json(); } catch { return reply({ error: 'Некорректный запрос' }, 400); }
    if (!body || typeof body !== 'object') return reply({ error: 'Некорректный запрос' }, 400);
    const { requestText, conversationHistory, imageBase64, originalRequest, conversation_id } = body;
    if ((requestText != null && typeof requestText !== 'string')
      || (originalRequest != null && typeof originalRequest !== 'string')
      || (imageBase64 != null && typeof imageBase64 !== 'string')
      || (conversation_id != null && (typeof conversation_id !== 'string' || !/^[0-9a-f-]{36}$/i.test(conversation_id)))
      || (conversationHistory != null && (!Array.isArray(conversationHistory) || conversationHistory.length > 100
        || conversationHistory.some((m: any) => !m || !['user', 'assistant'].includes(m.role) || typeof m.content !== 'string' || m.content.length > 100000)))) {
      return reply({ error: 'Некорректные данные диалога' }, 400);
    }
    const messages = [...(conversationHistory || [])];
    if (requestText?.trim()) messages.push({ role: 'user', content: requestText.trim() });
    if (!messages.length && imageBase64?.trim()) messages.push({ role: 'user', content: 'Подготовь ответ на приложенный запрос МНС по авторскому сценарию 107НК.' });
    if (!messages.length || messages.at(-1)?.role !== 'user') return reply({ error: 'Введите текст запроса или загрузите файл' }, 400);
    if (imageBase64 && !/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=\s]+$/.test(imageBase64)) {
      return reply({ error: 'Недопустимое изображение запроса' }, 400);
    }

    const serviceClient = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: prompts, error } = await serviceClient.from('ai_user_prompts').select('id')
      .eq('code', MNS_SCENARIO_CODE).eq('is_active', true).eq('is_archived', false).eq('is_visible_in_chat', true);
    if (error || prompts?.length !== 1) return reply({ error: MNS_UNAVAILABLE, code: 'mns_corpus_unavailable' }, 503);
    const imageMatch = imageBase64 ? /^data:([^;]+);base64,(.*)$/s.exec(imageBase64) : null;
    const response = await fetch(`${url}/functions/v1/gorbova-ai-chat`, {
      method: 'POST', headers: { Authorization: authHeader, apikey: anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'prompt', prompt_id: prompts[0].id, messages, conversation_id,
        // Original text must survive follow-ups; old clients fall back to their
        // first user turn. Canonical handler also restores its owned context.
        fileContents: originalRequest?.trim() || requestText?.trim() || messages.find(m => m.role === 'user')?.content,
        ...(imageMatch ? { images: [{ base64: imageMatch[2], mimeType: imageMatch[1], filename: 'request-image.' + (imageMatch[1].endsWith('jpeg') ? 'jpg' : imageMatch[1].split('/')[1]) }] } : {}),
      }),
      signal: AbortSignal.timeout(110000),
    });
    const result = await response.json();
    if (!response.ok) return reply(result, response.status);
    if (result.blocked || result.metadata?.blocked) return reply({ error: result.content, code: 'mns_input_unreadable' }, 422);
    if (typeof result.content !== 'string' || !result.content.trim()) return reply({ error: 'ИИ не вернул ответ. Повторите запрос.' }, 502);
    const responseText = result.content;
    const needsClarification = mnsReplyNeedsClarification(responseText);
    const documents = /стать[а-яё]*\s+79\b|ст\.?\s*79\b/i.test(responseText);
    const summons = /стать[а-яё]*\s+80\b|ст\.?\s*80\b/i.test(responseText);
    return reply({ responseText, needsClarification, requestType: documents && summons ? 'combined' : documents ? 'documents' : summons ? 'summons' : needsClarification ? 'clarification' : 'unknown', conversation_id: result.conversation_id, metadata: result.metadata });
  } catch {
    return reply({ error: 'Не удалось подготовить ответ МНС. Проверьте историю перед повторным запросом.' }, 503);
  }
});
