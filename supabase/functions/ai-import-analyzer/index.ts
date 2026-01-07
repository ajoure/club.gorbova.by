import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface AnalyzeRequest {
  type: "columns" | "tariffs";
  headers?: string[];
  sampleRows?: Record<string, unknown>[];
  uniqueOffers?: { name: string; count: number; samples?: Record<string, unknown>[] }[];
  existingTariffs?: { id: string; code: string; name: string }[];
  existingRules?: { pattern: string; tariff_id: string }[];
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

    const body: AnalyzeRequest = await req.json();
    const { type, headers, sampleRows, uniqueOffers, existingTariffs, existingRules } = body;

    let systemPrompt = "";
    let userPrompt = "";

    if (type === "columns") {
      systemPrompt = `Ты эксперт по анализу данных из CRM-систем и LMS-платформ.
Твоя задача - проанализировать заголовки колонок Excel-файла с заказами/сделками и определить маппинг на стандартные поля.

Верни JSON с маппингом колонок:
{
  "mapping": {
    "email": "название колонки с email",
    "phone": "название колонки с телефоном",
    "fullName": "название колонки с ФИО",
    "firstName": "название колонки с именем (если есть отдельно)",
    "lastName": "название колонки с фамилией (если есть отдельно)",
    "offerName": "название колонки с названием оффера/продукта",
    "amount": "название колонки с суммой",
    "currency": "название колонки с валютой",
    "status": "название колонки со статусом",
    "createdAt": "название колонки с датой создания",
    "paidAt": "название колонки с датой оплаты",
    "externalId": "название колонки с ID заказа"
  },
  "tariffField": "название колонки с тарифом (если есть отдельная)",
  "additionalFields": ["другие полезные колонки"],
  "confidence": 0.95,
  "notes": "примечания по маппингу"
}

Если какое-то поле не найдено, оставь null.`;

      userPrompt = `Проанализируй эти заголовки колонок и первые строки данных:

ЗАГОЛОВКИ:
${JSON.stringify(headers, null, 2)}

ПРИМЕРЫ ДАННЫХ (первые 3 строки):
${JSON.stringify(sampleRows?.slice(0, 3), null, 2)}

Определи какие колонки соответствуют стандартным полям заказа.`;
    } else if (type === "tariffs") {
      systemPrompt = `Ты эксперт по сопоставлению продуктов и тарифов из разных систем.
Твоя задача - сопоставить названия офферов из импорта с существующими тарифами.

Существующие тарифы:
${JSON.stringify(existingTariffs, null, 2)}

${existingRules?.length ? `Существующие правила маппинга:\n${JSON.stringify(existingRules, null, 2)}` : ""}

Верни JSON с предложениями маппинга:
{
  "suggestions": [
    {
      "pattern": "название оффера из импорта",
      "count": 100,
      "action": "map_to_tariff" | "use_secondary_field" | "skip" | "create_rule",
      "targetTariffId": "id тарифа если map_to_tariff",
      "targetTariffCode": "код тарифа",
      "secondaryField": "название поля с тарифом если use_secondary_field",
      "confidence": 0.9,
      "reason": "объяснение почему такой маппинг"
    }
  ],
  "unmappedCount": 0,
  "notes": "общие примечания"
}

Логика маппинга:
- "Клуб: chat" / "Клуб Chat" → тариф с кодом chat
- "Клуб: full" / "Клуб Full" → тариф с кодом full  
- "Клуб: business" / "Клуб Business" → тариф с кодом business
- "Клуб 07/2022" без указания тарифа → проверь дополнительное поле "Выбрать тариф клуба"
- Если в samples есть поле с "chat"/"full"/"business" → use_secondary_field`;

      userPrompt = `Проанализируй эти уникальные офферы и предложи маппинг на тарифы:

УНИКАЛЬНЫЕ ОФФЕРЫ:
${JSON.stringify(uniqueOffers?.map(o => ({
  name: o.name,
  count: o.count,
  sampleFields: o.samples?.[0] ? Object.keys(o.samples[0]) : []
})), null, 2)}

ПРИМЕРЫ ДАННЫХ ДЛЯ КАЖДОГО ОФФЕРА:
${JSON.stringify(uniqueOffers?.map(o => ({
  name: o.name,
  sample: o.samples?.[0]
})).slice(0, 10), null, 2)}`;
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
          { role: "user", content: userPrompt },
        ],
        temperature: 0.2,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("AI Gateway error:", response.status, errorText);
      
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded, please try again later" }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Payment required, please add credits" }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      
      throw new Error(`AI Gateway error: ${response.status}`);
    }

    const aiResponse = await response.json();
    const content = aiResponse.choices?.[0]?.message?.content || "";

    // Parse JSON from response
    let result;
    try {
      // Extract JSON from markdown code blocks if present
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
      const jsonStr = jsonMatch ? jsonMatch[1].trim() : content.trim();
      result = JSON.parse(jsonStr);
    } catch (parseErr) {
      console.error("Failed to parse AI response:", content);
      result = { 
        error: "Failed to parse AI response", 
        raw: content,
        type 
      };
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("AI Import Analyzer error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
