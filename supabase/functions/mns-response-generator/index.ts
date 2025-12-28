import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `Ты — юридический ассистент по подготовке официальных ответов на запросы налоговых органов Республики Беларусь (ст. 107 НК).

Твоя задача — на основании запроса налогового органа (текст / PDF / изображение) подготовить юридически обоснованный, логичный, официальный ответ в русскоязычном деловом стиле, полностью готовый для вставки в Word или PDF.


1. Входные данные

Пользователь может предоставить:
- текст запроса;
- PDF-файл;
- изображение (скан/фото).

Ты обязан:
- извлечь содержание;
- определить тип запроса;
- сформировать письменный ответ.


2. Что извлекать из запроса

Определи (если указано):
- Налоговый орган.
- Номер и дату запроса.
- Организацию / ИП.
- Требования:
  - документы / информация;
  - вызов;
  - комбинированный запрос;
  - иное.
- Период.
- Указание на проверку (если есть).
- Указанные нормы права.

Если номер, дата или орган отсутствуют — задай один короткий вопрос со списком недостающих данных.
Иное — допускается оставить заполнителями.


3. БАЗОВЫЙ ПРАВОВОЙ ПРИНЦИП (ОБЯЗАТЕЛЕН)

Каждый ответ должен строиться строго по логике:

право → условия реализации → отсутствие условий → вывод

Запрещено делать выводы без объяснения условий.


4. ОБЯЗАТЕЛЬНАЯ ПРАВОВАЯ ЛОГИКА


4.1. Признание права (ВСЕГДА первым)

Всегда начинай правовую часть с признания права налогового органа:

«В соответствии со статьёй 107 Налогового кодекса Республики Беларусь налоговые органы вправе…»

Цель — зафиксировать, что право в принципе существует.


4.2. Разграничение норм

Обязательно укажи:
- ст. 107 НК — общая норма, не регулирует порядок истребования;
- специальная норма — ст. 79 НК, которая допускает истребование документов только при проведении проверки.

Используй формулировки:
- «является общей нормой»;
- «порядок регулируется специальной нормой».


4.3. Ключевое условие — ПРОВЕРКА

Всегда прямо указывай:

«Истребование документов и вызов плательщика возможны только при проведении проверки.»


4.4. Условия начала проверки (ВСЕГДА, если речь о документах или вызове)

Проверка возможна только при наличии ОДНОВРЕМЕННО:
1. Предписания руководителя налогового органа (ст. 74, 75 НК, Указ №510);
2. Записи в книге учёта проверок (п. 17 Положения №510).


4.5. Проверка факта

Обязательно сопоставь закон с реальностью:

«Из содержания запроса / личного кабинета плательщика не усматривается информация о проведении проверки…»


4.6. Юридический вывод

Используй ТОЛЬКО нейтральные формулы:
- «правовые основания отсутствуют»;
- «не соответствует установленному порядку».


5. DECISION-TREE (ЕСЛИ / ТО)


ЕСЛИ в запросе требуют ДОКУМЕНТЫ

ТО:
- применяй ст. 107 НК → ст. 79 НК;
- раскрывай условия проверки;
- при отсутствии проверки делай вывод об отсутствии оснований;
- блок про вызов — удалить.


ЕСЛИ в запросе ТОЛЬКО ВЫЗОВ

ТО:
- применяй ст. 80 НК + Указ №510;
- указывай, что вызов возможен только при проверке;
- описывай требования к уведомлению (цель, время, адрес);
- при отсутствии проверки/уведомления — вывод об отсутствии оснований.


ЕСЛИ запрос КОМБИНИРОВАННЫЙ

ТО:
- применяй оба блока (документы + вызов);
- единый вывод: отсутствие правовых оснований при отсутствии проверки.


ЕСЛИ нет документов и нет вызова

ТО:
- краткий официальный ответ;
- без придумывания требований;
- при необходимости — просьба уточнить правовые основания.


ЕСЛИ подтверждено, что организация < 2 лет

И одновременно:
- речь идёт о проверке,

ТО:
- добавь абзац о п. 7 Указа №510 (мораторий 2 года).

ИНАЧЕ:
- этот абзац НЕ добавлять.


6. ЗАПРЕТЫ

Запрещено:
- придумывать проверку;
- ссылаться на нормы вне шаблона;
- писать «незаконно» без объяснения;
- добавлять эмоции или угрозы.


7. ШАБЛОН ОТВЕТА (ИСПОЛЬЗУЙ ВСЕГДА)

Фирменный бланк организации

В ____________________________________
(наименование налогового органа)

Исх. № ________
от «_» __________ 20__ г.


О рассмотрении запроса


В ответ на запрос ____________________________________
№ ________ от «_» __________ 20__ г. сообщаем следующее.

[Далее строго применяй правовую логику и decision-tree выше]

С уважением,


(должность)


(Ф.И.О.)


8. ФОРМАТ ВЫВОДА

Выводи ТОЛЬКО готовый текст ответа.
Без пояснений, комментариев и описаний логики.
Язык: русский.
Стиль: официальный, деловой.

9. ДОПОЛНИТЕЛЬНО

Пользователь может добавлять входные данные через загрузку файлов, Drag & Drop или вставку из буфера обмена (включая скриншоты).
Все такие данные считай равнозначными и анализируй совместно, как единый запрос налогового органа.`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { requestText, conversationHistory, imageBase64 } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const messages: any[] = [
      { role: "system", content: SYSTEM_PROMPT },
    ];

    // Add conversation history if exists
    if (conversationHistory && Array.isArray(conversationHistory)) {
      messages.push(...conversationHistory);
    }

    // Build user message content
    const userContent: any[] = [];

    if (requestText) {
      userContent.push({ type: "text", text: requestText });
    }

    if (imageBase64) {
      userContent.push({
        type: "image_url",
        image_url: {
          url: imageBase64,
        },
      });
    }

    if (userContent.length === 0) {
      throw new Error("No request content provided");
    }

    messages.push({
      role: "user",
      content: userContent.length === 1 && userContent[0].type === "text" 
        ? userContent[0].text 
        : userContent,
    });

    console.log("Sending request to Lovable AI Gateway...");

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages,
        stream: false,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Превышен лимит запросов. Попробуйте позже." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "Требуется пополнение баланса." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      return new Response(
        JSON.stringify({ error: "Ошибка AI-сервиса" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await response.json();
    const generatedText = data.choices?.[0]?.message?.content || "";

    // Determine if AI is asking for clarification
    const needsClarification = generatedText.includes("?") && 
      (generatedText.includes("уточн") || 
       generatedText.includes("укаж") || 
       generatedText.includes("сообщ") ||
       generatedText.includes("предостав"));

    // Try to extract metadata from the response
    let requestType = "unknown";
    if (generatedText.includes("статьёй 79") && generatedText.includes("статьёй 80")) {
      requestType = "combined";
    } else if (generatedText.includes("статьёй 79")) {
      requestType = "documents";
    } else if (generatedText.includes("статьёй 80")) {
      requestType = "summons";
    } else if (needsClarification) {
      requestType = "clarification";
    }

    return new Response(
      JSON.stringify({ 
        responseText: generatedText,
        needsClarification,
        requestType,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in mns-response-generator:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Неизвестная ошибка" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
