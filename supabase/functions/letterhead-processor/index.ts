import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `Ты — ассистент по обработке фирменных бланков организаций.

ЗАДАЧА:
Из предоставленного текста или изображения бланка извлечь ТОЛЬКО постоянные реквизиты компании.

ЧТО ИЗВЛЕКАТЬ (реквизиты):
- Название организации (companyName)
- Форма собственности (legalForm): ООО, ОАО, ЗАО, ИП, УП и т.д.
- УНП (unp)
- Юридический адрес (legalAddress)
- Почтовый адрес (postalAddress)
- Телефон (phone)
- Факс (fax)
- E-mail (email)
- Сайт (website)
- Название банка (bankName)
- Расчётный счёт (bankAccount)
- БИК / код банка (bankCode)

ЧТО НЕ ИЗВЛЕКАТЬ (тело письма):
- Обращения ("Уважаемый...", "В адрес...")
- Темы конкретных писем ("О рассмотрении...", "На Ваш запрос...")
- Конкретные исходящие номера и даты ("Исх. № 123 от 01.01.2024")
- Подписи конкретных лиц с датами
- Любой текст, который является телом письма, а не постоянными реквизитами

ФОРМАТ ОТВЕТА (строго JSON):
{
  "requisites": {
    "companyName": "...",
    "legalForm": "...",
    "unp": "...",
    "legalAddress": "...",
    "postalAddress": "...",
    "phone": "...",
    "fax": "...",
    "email": "...",
    "website": "...",
    "bankName": "...",
    "bankAccount": "...",
    "bankCode": "..."
  },
  "cleanedText": "текст только реквизитов без тела письма"
}

Если какой-то реквизит не найден — оставь пустую строку.
Возвращай ТОЛЬКО JSON без пояснений.`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { rawText, imageBase64, fileType } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const userContent: any[] = [];

    if (rawText) {
      userContent.push({ 
        type: "text", 
        text: `Извлеки реквизиты из следующего текста бланка:\n\n${rawText}` 
      });
    }

    if (imageBase64) {
      userContent.push({
        type: "image_url",
        image_url: { url: imageBase64 },
      });
      userContent.push({
        type: "text",
        text: "Извлеки реквизиты компании из этого изображения бланка.",
      });
    }

    if (userContent.length === 0) {
      return new Response(
        JSON.stringify({ 
          requisites: {
            companyName: "",
            legalForm: "",
            unp: "",
            legalAddress: "",
            postalAddress: "",
            phone: "",
            fax: "",
            email: "",
            website: "",
            bankName: "",
            bankAccount: "",
            bankCode: "",
          },
          cleanedText: "",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Processing letterhead with AI...");

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userContent },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      throw new Error("AI processing failed");
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "{}";
    
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      console.error("Failed to parse AI response:", content);
      parsed = { requisites: {}, cleanedText: rawText || "" };
    }

    return new Response(
      JSON.stringify(parsed),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in letterhead-processor:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
