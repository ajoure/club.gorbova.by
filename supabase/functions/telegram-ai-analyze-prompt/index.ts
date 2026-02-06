import { createClient } from "npm:@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

interface AnalyzeRequest {
  content: string
  fileName: string
  existingPackages?: string[]
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const { content, fileName, existingPackages = [] }: AnalyzeRequest = await req.json()

    if (!content?.trim()) {
      throw new Error("Пустой контент для анализа")
    }

    // Truncate if too long
    const maxLength = 15000
    const truncatedContent = content.length > maxLength 
      ? content.substring(0, maxLength) + "\n\n[...содержимое обрезано...]"
      : content

    const systemPrompt = `Ты анализируешь загруженный материал для обучения AI-бота поддержки "Олег".

Бот Олег работает в Telegram для клуба "Буква закона" Катерины Горбовой.
Твоя задача — понять стиль общения, описанный в материале, и создать системный промпт для бота.

ПРАВИЛА АНАЛИЗА:
1. Извлеки ключевые правила коммуникации (что можно, что нельзя)
2. Определи тон общения (формальный/неформальный, тёплый/сухой)
3. Найди характерные фразы и обращения
4. Определи ограничения и запреты
5. Сформулируй краткое резюме "что я понял"
6. Покажи пример ответа в этом стиле

ВАЖНО:
- Код пакета должен быть уникальным (snake_case, на английском)
- Существующие пакеты: ${existingPackages.join(', ') || 'нет'}
- Категория: tone (стиль), support (поддержка), sales (продажи), policy (правила)

Верни ТОЛЬКО валидный JSON без markdown-обёртки:
{
  "suggestedName": "Название пакета по-русски",
  "suggestedCode": "unique_code_snake_case",
  "summary": "Из этого материала я понял, что должен: [краткое описание 2-3 предложения]",
  "exampleResponse": "Пример ответа в этом стиле (1-2 предложения)",
  "extractedRules": ["Правило 1", "Правило 2", "..."],
  "processedContent": "Полный системный промпт для бота на основе материала",
  "category": "tone"
}`

    const userPrompt = `Файл: ${fileName}

Содержимое для анализа:
---
${truncatedContent}
---

Проанализируй этот материал и создай пакет промптов для бота Олег.`

    // Call Lovable AI
    const response = await fetch("https://ai.lovable.dev/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${Deno.env.get("LOVABLE_API_KEY") || ""}`,
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 2000,
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error("[analyze-prompt] AI error:", errorText)
      throw new Error("Ошибка AI-анализа")
    }

    const aiResult = await response.json()
    const aiContent = aiResult.choices?.[0]?.message?.content || ""

    // Parse JSON from response
    let parsed
    try {
      // Try to extract JSON if wrapped in markdown
      const jsonMatch = aiContent.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0])
      } else {
        throw new Error("JSON не найден")
      }
    } catch (parseErr) {
      console.error("[analyze-prompt] Parse error:", parseErr, "Content:", aiContent)
      
      // Fallback response
      parsed = {
        suggestedName: fileName.replace(/\.[^.]+$/, ''),
        suggestedCode: fileName.replace(/\.[^.]+$/, '').toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, ''),
        summary: "Материал загружен. Олег будет использовать эти правила при ответах клиентам.",
        exampleResponse: "Здравствуйте! Чем могу помочь?",
        extractedRules: ["Использовать правила из загруженного материала"],
        processedContent: truncatedContent,
        category: "custom",
      }
    }

    // Ensure unique code
    if (existingPackages.includes(parsed.suggestedCode)) {
      parsed.suggestedCode = `${parsed.suggestedCode}_${Date.now().toString(36)}`
    }

    console.log("[analyze-prompt] Success:", {
      fileName,
      suggestedCode: parsed.suggestedCode,
      contentLength: content.length,
    })

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })

  } catch (error) {
    console.error("[analyze-prompt] Error:", error)
    return new Response(
      JSON.stringify({ error: error.message || "Ошибка анализа" }),
      { 
        status: 500, 
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    )
  }
})
