import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { title, category, deadline_date, deadline_time } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const today = new Date().toISOString().split('T')[0];
    const deadlineInfo = deadline_date 
      ? `Дедлайн: ${deadline_date}${deadline_time ? ` ${deadline_time}` : ""} (сегодня: ${today})` 
      : "Дедлайн не установлен";
    const categoryInfo = category ? `Сфера: ${category}` : "Сфера не указана";

    const prompt = `Ты эксперт по продуктивности и тайм-менеджменту. Определи приоритет задачи для Матрицы Эйзенхауэра.

Задача: "${title}"
${categoryInfo}
${deadlineInfo}

Критерии оценки:
- Q1 (Срочно и Важно): Критические задачи с близким дедлайном, влияющие на ключевые цели
- Q2 (Важно, не Срочно): Стратегические задачи развития, без острого дедлайна
- Q3 (Срочно, не Важно): Рутинные срочные дела, можно делегировать
- Q4 (Не Срочно, не Важно): Развлечения, отвлекающие задачи

Ответь ТОЛЬКО в формате JSON:
{"quadrant": "q1" | "q2" | "q3" | "q4", "reason": "краткое объяснение на русском (1 предложение)"}`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: "Ты эксперт по продуктивности. Отвечай только в JSON формате." },
          { role: "user", content: prompt },
        ],
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Слишком много запросов, попробуйте позже" }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Необходимо пополнить баланс" }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      return new Response(JSON.stringify({ error: "Ошибка AI сервиса" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";
    
    // Parse JSON from response
    let result;
    try {
      // Try to extract JSON from markdown code block if present
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/) || content.match(/\{[\s\S]*\}/);
      const jsonStr = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : content;
      result = JSON.parse(jsonStr.trim());
    } catch {
      console.error("Failed to parse AI response:", content);
      // Default to Q2 if parsing fails
      result = { quadrant: "q2", reason: "Рекомендуется запланировать" };
    }

    // Map quadrant names
    const quadrantMap: Record<string, string> = {
      q1: "urgent-important",
      q2: "not-urgent-important",
      q3: "urgent-not-important",
      q4: "not-urgent-not-important",
    };

    return new Response(JSON.stringify({
      quadrant: quadrantMap[result.quadrant] || "not-urgent-important",
      reason: result.reason || "AI рекомендация",
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in analyze-task-priority:", error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : "Неизвестная ошибка" 
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
