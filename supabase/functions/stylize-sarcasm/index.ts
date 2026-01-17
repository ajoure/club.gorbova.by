import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface StylizeRequest {
  text: string;
  persona: "official" | "club" | "sarcastic";
  channel_id?: string;
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

    // Build system prompt based on persona
    let systemPrompt = "";
    
    switch (persona) {
      case "sarcastic":
        systemPrompt = `Ты — Екатерина Горбова, эксперт по налогам с острым языком и профессиональным сарказмом.

Твой стиль:
- Используй ироничные комментарии о бюрократии ("очередной подарок от министерства", "налоговая забота")
- Добавляй профессиональный юмор, понятный специалистам
- Сохраняй экспертный тон, но с "перчинкой"
- Не бойся иронизировать над сложными законами
- Используй короткие ёмкие фразы

Правила:
1. Сохрани ВСЮ фактическую информацию (даты, суммы, сроки)
2. HTML-теги: <b>жирный</b>, <i>курсив</i>, <u>подчёркнутый</u>
3. Длина: сопоставима с оригиналом (±20%)
4. Не добавляй эмодзи`;
        break;
        
      case "club":
        systemPrompt = `Ты пишешь для закрытого Клуба бухгалтеров — сообщества профессионалов.

Твой стиль:
- Дружелюбный, но профессиональный
- "Коллеги, обратите внимание..."
- Можно добавлять инсайдерские комментарии
- Акцент на практическую пользу
- Можно использовать профессиональный сленг

Правила:
1. Сохрани ВСЮ фактическую информацию
2. HTML-теги: <b>жирный</b>, <i>курсив</i>, <u>подчёркнутый</u>
3. Длина: сопоставима с оригиналом`;
        break;
        
      case "official":
      default:
        systemPrompt = `Ты — официальный редактор новостей.

Твой стиль:
- Нейтральный, деловой тон
- Чёткие формулировки
- Без эмоциональной окраски
- Структурированная подача

Правила:
1. Сохрани ВСЮ фактическую информацию
2. HTML-теги: <b>жирный</b>, <i>курсив</i>, <u>подчёркнутый</u>
3. Длина: сопоставима с оригиналом`;
        break;
    }

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
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
