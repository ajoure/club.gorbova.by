import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface FormStep {
  id: string;
  title: string;
  description: string;
}

interface RequestBody {
  answers: Record<string, string>;
  steps: FormStep[];
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

    const { answers, steps } = await req.json() as RequestBody;

    // Validate input
    if (!answers || !steps || steps.length === 0) {
      return new Response(
        JSON.stringify({ error: "Missing answers or steps" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build context from answers
    const answersText = steps.map(step => {
      const answer = answers[step.id] || "(не заполнено)";
      return `**${step.title}**: ${answer}`;
    }).join("\n");

    const systemPrompt = `Ты — бизнес-консультант Катерины Горбовой по развитию бухгалтерского бизнеса.

На основе ответов пользователя о его "Точке B" (цель через 12 месяцев) создай структурированное заключение.

СТРУКТУРА ОТВЕТА:
## Портрет желаемого будущего
2-3 предложения, описывающие целевое состояние бизнеса через 12 месяцев.

## Ключевые фокусы
3-4 пункта списком — на чём сконцентрировать усилия для достижения цели.

## Риски и точки внимания  
2-3 пункта — потенциальные препятствия и на что обратить особое внимание.

## Мотивирующий вывод
1 короткое предложение с позитивным настроем на достижение цели.

ТРЕБОВАНИЯ:
- Тон: профессиональный, поддерживающий, конкретный
- Обращение: на "Вы"
- Формат: Markdown с заголовками ##
- Персонализация: используй конкретные цифры и факты из ответов
- Длина: 150-250 слов`;

    const userPrompt = `Вот ответы пользователя на 10 вопросов о Точке B:

${answersText}

Сформируй итоговое заключение.`;

    console.log("[generate-point-b-summary] Calling AI with", steps.length, "steps");

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_tokens: 800,
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Слишком много запросов. Попробуйте позже." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "Превышен лимит запросов AI." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const text = await response.text();
      console.error("[generate-point-b-summary] AI gateway error:", response.status, text);
      return new Response(
        JSON.stringify({ error: "Ошибка генерации итога" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await response.json();
    const summary = data.choices?.[0]?.message?.content?.trim();

    if (!summary) {
      throw new Error("Empty response from AI");
    }

    console.log("[generate-point-b-summary] Generated summary length:", summary.length);

    return new Response(
      JSON.stringify({ success: true, summary }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[generate-point-b-summary] Error:", error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : "Unknown error",
        success: false 
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
