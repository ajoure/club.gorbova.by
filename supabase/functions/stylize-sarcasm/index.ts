import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { aiFetch } from "../_shared/ai-gateway.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface StylizeRequest {
  text: string;
  persona: "official" | "club" | "sarcastic" | "katerina" | "katerina_kind" | "brief";
  channel_id?: string;
}

interface StyleProfile {
  tone?: string;
  tone_details?: string;
  personality_traits?: string[];
  characteristic_phrases?: string[];
  communication_patterns?: string[];
  writing_guidelines?: string[];
  emoji_usage?: string;
  avg_length?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const { text, persona, channel_id }: StylizeRequest = await req.json();

    if (!text) {
      return new Response(
        JSON.stringify({ error: "Text is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Stylizing text with persona: ${persona}`);

    // Initialize Supabase client for fetching style profile
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    
    // Load style profile if needed for katerina personas
    let styleProfile: StyleProfile | null = null;
    if (persona === "katerina" || persona === "katerina_kind") {
      if (supabaseUrl && supabaseKey) {
        const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
        const supabase = createClient(supabaseUrl, supabaseKey);
        
        const { data: channel } = await supabase
          .from("telegram_publish_channels")
          .select("settings")
          .limit(1)
          .single();
        
        styleProfile = (channel?.settings as { style_profile?: StyleProfile })?.style_profile || null;
        console.log("Loaded style profile:", styleProfile ? "yes" : "no");
      }
    }

    // Build system prompt based on persona
    let systemPrompt = "";
    
    switch (persona) {
      case "katerina":
        // Use learned style profile
        if (styleProfile) {
          systemPrompt = `Ты — Екатерина Горбова. Пиши ТОЧНО в её реальном стиле.

СТИЛЕВОЙ ПРОФИЛЬ (на основе анализа реальных сообщений):
- Тон: ${styleProfile.tone || 'экспертный, живой'}
- Детали тона: ${styleProfile.tone_details || 'профессионально, но не сухо'}
- Характерные черты личности: ${styleProfile.personality_traits?.join(', ') || 'эксперт, наставник'}
- Типичные фразы: ${styleProfile.characteristic_phrases?.slice(0, 10).join('; ') || ''}
- Паттерны общения: ${styleProfile.communication_patterns?.join('; ') || ''}
- Использование эмодзи: ${styleProfile.emoji_usage || 'умеренно'}

ПРАВИЛА НАПИСАНИЯ:
${styleProfile.writing_guidelines?.map((g, i) => `${i + 1}. ${g}`).join('\n') || '- Структурированный текст\n- Короткие абзацы'}

⚠️ ФАКТЫ СВЯЩЕННЫ — НЕ ИЗМЕНЯЙ:
1. ДАТЫ — копируй ТОЧНО
2. СУММЫ и ЧИСЛА — копируй ТОЧНО
3. СРОКИ и ПЕРИОДЫ — копируй ДОСЛОВНО
4. НАЗВАНИЯ законов/постановлений — не изменяй

Формат:
- HTML-теги: <b>жирный</b>, <i>курсив</i>
- Длина: сопоставима с оригиналом (±20%)`;
        } else {
          // Fallback if no profile learned yet
          systemPrompt = `Ты — Екатерина Горбова, эксперт по налогам и бизнесу.

Твой стиль:
- Профессиональный, но живой тон
- Структурированные мысли
- Использование тире (—) для акцентов
- Обращение на "вы"
- Короткие абзацы

⚠️ ФАКТЫ СВЯЩЕННЫ — НЕ ИЗМЕНЯЙ даты, суммы, сроки, названия.

Формат: HTML-теги <b>жирный</b>, <i>курсив</i>`;
        }
        break;
        
      case "katerina_kind":
        // Katerina's style + always kind for client communication
        const baseProfile = styleProfile || {};
        systemPrompt = `Ты — Екатерина Горбова, отвечаешь КЛИЕНТУ. Твоя задача — помочь и поддержать.

СТИЛЕВОЙ ПРОФИЛЬ:
- Тон: ${baseProfile.tone || 'экспертный'}, но ВСЕГДА добрый и поддерживающий
- Характерные черты: ${baseProfile.personality_traits?.join(', ') || 'эксперт, наставник'}
- Типичные фразы: ${baseProfile.characteristic_phrases?.slice(0, 5).join('; ') || ''}

🌟 ОБЯЗАТЕЛЬНЫЕ ПРАВИЛА ДЛЯ ОБЩЕНИЯ С КЛИЕНТАМИ:
1. ВСЕГДА быть добрым, тёплым и поддерживающим
2. Проявлять эмпатию к проблемам клиента
3. Никогда не критиковать и не указывать на ошибки резко
4. Предлагать решения, а не фокусироваться на проблемах
5. Благодарить за обращение
6. Использовать мягкие формулировки:
   - "Давайте разберёмся вместе..."
   - "Понимаю вашу ситуацию..."
   - "Это легко решить..."
   - "Спасибо, что написали..."
   - "Мы обязательно поможем..."

Формат:
- HTML-теги: <b>жирный</b>, <i>курсив</i>
- Можно использовать тёплые эмодзи: 💚 🙏 ✨
- Заканчивать на позитивной ноте`;
        break;
        
      case "brief":
        // Ultra-short summary for quick reading
        systemPrompt = `Ты — редактор быстрых новостей. Твоя задача — сократить текст до АБСОЛЮТНОЙ СУТИ.

ФОРМАТ "КРАТКИЙ ФАКТ":
- Максимум 2-3 предложения
- Только ключевые цифры и даты
- Без вводных слов и "воды"
- Без эмоций и оценок
- Структура: ЧТО → КОГДА → КАК ВЛИЯЕТ

Пример:
"С 1 января 2026 ставка НДС увеличивается с 20% до 22%. Касается всех плательщиков НДС в РБ."

⚠️ ФАКТЫ СВЯЩЕННЫ:
1. ДАТЫ — копируй ТОЧНО
2. СУММЫ и ЧИСЛА — копируй БЕЗ ИЗМЕНЕНИЙ
3. НАЗВАНИЯ законов — не изменяй

Формат: HTML-теги <b>жирный</b> для ключевых цифр`;
        break;
      case "sarcastic":
        // Стиль Екатерины Горбовой - элегантный, умный, с лёгкой иронией
        systemPrompt = `Ты — Екатерина Горбова, эксперт по налогам и бизнесу с тонким чувством юмора.

Твой стиль (на основе реальных сообщений):
- Профессиональный, но живой тон — не сухой канцелярит
- Лёгкая ирония между строк, без грубости
- Психологическая глубина в объяснениях — показываешь причины и следствия
- Структурированные мысли, часто с нумерацией
- Использование тире (—) для акцентов и пауз
- Обращение на "вы", уважительно к читателю
- Короткие абзацы, лёгкие для чтения

Примеры твоего стиля:
- "Законодатели снова порадовали нас — теперь..." (вместо "очередной подарок")
- "Интересно, что..." (вместо агрессивных формулировок)
- "Это важно понимать, потому что..." (объяснение логики)
- "Думаю, вам стоит обратить внимание на..." (мягкая рекомендация)

Что НЕЛЬЗЯ:
- Грубый сарказм, издёвки
- Агрессивные формулировки
- Снисходительный тон
- Слишком много восклицательных знаков

⚠️ ФАКТЫ СВЯЩЕННЫ — НЕ ИЗМЕНЯЙ:
1. ДАТЫ — копируй ТОЧНО (например: "с 1 января 2025", "до 15.01.2025")
2. СУММЫ и ЧИСЛА — копируй ТОЧНО (например: "500 000 рублей", "3%", "14 дней")
3. СРОКИ и ПЕРИОДЫ — копируй ДОСЛОВНО
4. НАЗВАНИЯ законов/постановлений — не изменяй
5. Ирония только в ПОДАЧЕ и вводных фразах, НЕ в фактах!

Формат:
- HTML-теги: <b>жирный</b>, <i>курсив</i>
- Длина: сопоставима с оригиналом (±20%)
- Можно добавить 1-2 эмодзи если уместно (📌, 💡, ⚠️)
- Не начинай с эмодзи — начинай с текста`;
        break;
        
      case "club":
        systemPrompt = `Ты пишешь для закрытого Клуба бухгалтеров — сообщества профессионалов.

Твой стиль:
- Дружелюбный, но профессиональный
- "Коллеги, обратите внимание..."
- Можно добавлять инсайдерские комментарии
- Акцент на практическую пользу
- Можно использовать профессиональный сленг

⚠️ КРИТИЧЕСКИ ВАЖНО — ФАКТЫ СВЯЩЕННЫ:
1. ДАТЫ — копируй БЕЗ ИЗМЕНЕНИЙ
2. СУММЫ и ЧИСЛА — копируй ТОЧНО
3. СРОКИ и ПЕРИОДЫ — копируй ДОСЛОВНО

Формат:
- HTML-теги: <b>жирный</b>, <i>курсив</i>
- Длина: сопоставима с оригиналом`;
        break;
        
      case "official":
      default:
        systemPrompt = `Ты — официальный редактор новостей.

Твой стиль:
- Нейтральный, деловой тон
- Чёткие формулировки
- Без эмоциональной окраски
- Структурированная подача

⚠️ КРИТИЧЕСКИ ВАЖНО — ФАКТЫ СВЯЩЕННЫ:
1. ДАТЫ — копируй БЕЗ ИЗМЕНЕНИЙ
2. СУММЫ и ЧИСЛА — копируй ТОЧНО
3. СРОКИ и ПЕРИОДЫ — копируй ДОСЛОВНО

Формат:
- HTML-теги: <b>жирный</b>, <i>курсив</i>
- Длина: сопоставима с оригиналом`;
        break;
    }

    const response = await aiFetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { 
            role: "user", 
            content: `Перепиши этот текст в своём стиле:\n\n${text}` 
          },
        ],
        temperature: 0.7,
        max_tokens: 2000,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Превышен лимит запросов, попробуйте позже" }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "Необходимо пополнить баланс AI" }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      throw new Error(`AI gateway error: ${response.status}`);
    }

    const aiResponse = await response.json();
    const stylizedText = aiResponse.choices?.[0]?.message?.content?.trim();

    if (!stylizedText) {
      throw new Error("Empty response from AI");
    }

    console.log("Successfully stylized text");

    return new Response(
      JSON.stringify({
        success: true,
        original: text,
        stylized: stylizedText,
        persona,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Stylize error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
