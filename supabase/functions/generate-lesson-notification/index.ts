import { createClient } from "npm:@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface StyleProfile {
  tone?: string;
  tone_details?: string;
  writing_guidelines?: string[];
  characteristic_phrases?: string[];
  emojis?: {
    used?: boolean;
    frequency?: string;
    examples?: string[];
  };
  vocabulary_level?: string;
  communication_patterns?: string[];
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { 
      status: 405, 
      headers: { ...corsHeaders, "Content-Type": "application/json" } 
    });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { 
        status: 401, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY");

    if (!lovableApiKey) {
      console.error("LOVABLE_API_KEY not configured");
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY not configured" }), { 
        status: 500, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    }

    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } },
    });

    // Admin client for reading style profile
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // Verify user
    const { data: userData, error: authError } = await supabase.auth.getUser();
    if (authError || !userData?.user?.id) {
      return new Response(JSON.stringify({ error: "Invalid token" }), { 
        status: 401, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    }

    const body = await req.json();
    const { lessonTitle, episodeNumber, questions, lessonUrl } = body;

    if (!lessonTitle && !episodeNumber) {
      return new Response(JSON.stringify({ error: "Title or episode number required" }), { 
        status: 400, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    }

    // Fetch Katerina's style profile from telegram_publish_channels
    let styleProfile: StyleProfile | null = null;
    try {
      const { data: channels } = await adminClient
        .from("telegram_publish_channels")
        .select("settings")
        .not("settings->style_profile", "is", null)
        .limit(1);

      if (channels && channels.length > 0 && channels[0].settings?.style_profile) {
        styleProfile = channels[0].settings.style_profile as StyleProfile;
        console.log("Found Katerina's style profile:", Object.keys(styleProfile));
      }
    } catch (e) {
      console.warn("Could not fetch style profile:", e);
    }

    // Build context for AI
    const title = lessonTitle || `Выпуск №${episodeNumber}`;
    const questionsList = questions?.slice(0, 5)?.map((q: { title: string }) => q.title).join("\n- ") || "";
    
    // Build style instructions from profile
    let styleInstructions = "";
    if (styleProfile) {
      const parts: string[] = [];
      
      if (styleProfile.tone_details) {
        parts.push(`Стиль общения: ${styleProfile.tone_details}`);
      } else if (styleProfile.tone) {
        parts.push(`Тон: ${styleProfile.tone}`);
      }
      
      if (styleProfile.writing_guidelines && styleProfile.writing_guidelines.length > 0) {
        parts.push(`\nКлючевые правила написания:\n${styleProfile.writing_guidelines.slice(0, 5).map((g, i) => `${i + 1}. ${g}`).join("\n")}`);
      }
      
      if (styleProfile.characteristic_phrases && styleProfile.characteristic_phrases.length > 0) {
        parts.push(`\nХарактерные фразы (используй подобные): ${styleProfile.characteristic_phrases.slice(0, 5).join(", ")}`);
      }
      
      if (styleProfile.emojis?.used) {
        const freq = styleProfile.emojis.frequency || "умеренно";
        const examples = styleProfile.emojis.examples?.slice(0, 5).join(" ") || "💡 📌 🔥";
        parts.push(`\nЭмодзи: использовать ${freq}, примеры: ${examples}`);
      }
      
      if (styleProfile.communication_patterns && styleProfile.communication_patterns.length > 0) {
        parts.push(`\nПаттерны общения:\n${styleProfile.communication_patterns.slice(0, 3).map(p => `- ${p}`).join("\n")}`);
      }
      
      styleInstructions = parts.join("\n");
    }
    
    const prompt = `Ты — Екатерина Горбова, эксперт по бухгалтерии и юридическим вопросам для предпринимателей.
Напиши теплое и искреннее уведомление для Telegram о выходе нового видеоответа.

${styleInstructions ? `=== ТВОЙ СТИЛЕВОЙ ПРОФИЛЬ ===\n${styleInstructions}\n\n` : ""}Данные урока:
- Название: ${title}
${questionsList ? `- Вопросы в этом выпуске:\n- ${questionsList}` : ""}

Требования к тексту:
1. Пиши в своём стиле${styleProfile?.tone ? ` (${styleProfile.tone})` : " — теплом, искреннем, современном"}
2. Начать с эмодзи (🎬, 📚, 💡 или подобные)
3. Кратко анонсировать содержание (2-3 предложения)
4. НЕ использовать официальный или сухой тон
5. Заканчивать призывом к действию (посмотреть)
6. Длина: 3-5 строк максимум
7. Подпись: Катерина 🤍

Верни ТОЛЬКО текст сообщения, без кавычек и пояснений.`;

    console.log("Generating notification with AI using style profile...");

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovableApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7,
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error("AI API error:", errorText);
      
      // Fallback to template
      const fallbackMessage = `🎬 Новый выпуск уже доступен!\n\n📚 ${title}\n\nПереходите по ссылке, чтобы посмотреть 👇\n\nКатерина 🤍`;
      
      return new Response(JSON.stringify({ 
        messageText: fallbackMessage,
        buttonText: "Смотреть",
        source: "template"
      }), { 
        status: 200, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    }

    const aiData = await aiResponse.json();
    const messageText = aiData.choices?.[0]?.message?.content?.trim() || "";

    if (!messageText) {
      const fallbackMessage = `🎬 Новый выпуск уже доступен!\n\n📚 ${title}\n\nПереходите по ссылке, чтобы посмотреть 👇\n\nКатерина 🤍`;
      
      return new Response(JSON.stringify({ 
        messageText: fallbackMessage,
        buttonText: "Смотреть",
        source: "template"
      }), { 
        status: 200, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    }

    console.log("Generated notification:", messageText.slice(0, 100) + "...");
    console.log("Used style profile:", !!styleProfile);

    return new Response(JSON.stringify({ 
      messageText,
      buttonText: "Смотреть",
      source: styleProfile ? "ai_with_style" : "ai",
      styleProfileUsed: !!styleProfile
    }), { 
      status: 200, 
      headers: { ...corsHeaders, "Content-Type": "application/json" } 
    });

  } catch (error: unknown) {
    console.error("Error in generate-lesson-notification:", error);
    const message = error instanceof Error ? error.message : "Internal error";
    return new Response(JSON.stringify({ error: message }), { 
      status: 500, 
      headers: { ...corsHeaders, "Content-Type": "application/json" } 
    });
  }
});
