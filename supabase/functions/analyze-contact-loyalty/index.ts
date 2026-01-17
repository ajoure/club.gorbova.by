import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface LoyaltyProof {
  quote: string;
  date: string;
  sentiment: "positive" | "negative" | "neutral";
  context?: string;
}

interface LoyaltyAnalysisResult {
  score: number;
  status_label: string;
  ai_summary: string;
  reason: string;
  proofs: LoyaltyProof[];
  messages_analyzed: number;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY");
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { profile_id, telegram_user_id } = await req.json();

    if (!profile_id && !telegram_user_id) {
      return new Response(
        JSON.stringify({ error: "profile_id or telegram_user_id required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[analyze-contact-loyalty] Starting analysis for profile_id=${profile_id}, telegram_user_id=${telegram_user_id}`);

    // Get profile if only telegram_user_id provided
    let targetProfileId = profile_id;
    let targetTelegramUserId = telegram_user_id;

    if (!targetProfileId && targetTelegramUserId) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("id, telegram_user_id, first_name, last_name")
        .eq("telegram_user_id", targetTelegramUserId)
        .maybeSingle();
      
      if (profile) {
        targetProfileId = profile.id;
      }
    }

    if (!targetTelegramUserId && targetProfileId) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("telegram_user_id, first_name, last_name")
        .eq("id", targetProfileId)
        .maybeSingle();
      
      if (profile?.telegram_user_id) {
        targetTelegramUserId = profile.telegram_user_id;
      }
    }

    // Fetch all messages from this user
    const { data: messages, error: messagesError } = await supabase
      .from("tg_chat_messages")
      .select("id, message_text, created_at, sender_name, chat_id")
      .eq("telegram_user_id", targetTelegramUserId)
      .not("message_text", "is", null)
      .order("created_at", { ascending: false })
      .limit(500);

    if (messagesError) {
      console.error("[analyze-contact-loyalty] Error fetching messages:", messagesError);
      throw messagesError;
    }

    const messagesCount = messages?.length || 0;
    console.log(`[analyze-contact-loyalty] Found ${messagesCount} messages for user ${targetTelegramUserId}`);

    // If no messages, set score to null
    if (!messages || messages.length === 0) {
      const { error: updateError } = await supabase
        .from("profiles")
        .update({
          loyalty_score: null,
          loyalty_ai_summary: "Нет сообщений для анализа",
          loyalty_status_reason: "Клиент не оставлял сообщений в чатах",
          loyalty_proofs: [],
          loyalty_analyzed_messages_count: 0,
          loyalty_updated_at: new Date().toISOString(),
        })
        .eq("id", targetProfileId);

      if (updateError) {
        console.error("[analyze-contact-loyalty] Error updating profile:", updateError);
      }

      return new Response(
        JSON.stringify({ 
          success: true, 
          score: null, 
          messages_analyzed: 0,
          message: "No messages to analyze" 
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Prepare messages for AI analysis
    const messagesText = messages
      .map(m => `[${m.created_at}] ${m.sender_name || "User"}: ${m.message_text}`)
      .join("\n");

    // Send to AI for analysis
    const systemPrompt = `Ты эксперт по анализу клиентской лояльности. Проанализируй сообщения клиента и определи его уровень лояльности к бренду/продукту.

Твоя задача:
1. Оценить общий тон сообщений (позитивный/негативный/нейтральный)
2. Найти признаки лояльности (благодарности, рекомендации, довольные отзывы)
3. Найти признаки недовольства (жалобы, критика, негатив)
4. Выбрать до 10 ключевых цитат-доказательств
5. Выставить итоговый балл от 1 до 10

Ответь СТРОГО в формате JSON:
{
  "score": число от 1 до 10,
  "status_label": "Хейтер" | "Недоволен" | "Нейтрально" | "Лояльный" | "Адепт/Фанат",
  "ai_summary": "Краткое резюме об отношении клиента (2-3 предложения)",
  "reason": "Почему выставлен такой балл (объяснение для админа)",
  "proofs": [
    {
      "quote": "точная цитата из сообщения",
      "date": "дата сообщения в ISO формате",
      "sentiment": "positive" | "negative" | "neutral",
      "context": "краткий контекст (опционально)"
    }
  ]
}

Шкала оценок:
1-2: Хейтер (активно критикует, негативные отзывы)
3-4: Недоволен (есть жалобы, разочарование)
5-6: Нейтрально (нет выраженных эмоций, обычные вопросы)
7-8: Лояльный (позитивные отзывы, благодарности)
9-10: Адепт/Фанат (восторженные отзывы, рекомендует другим)`;

    const userPrompt = `Проанализируй эти ${messagesCount} сообщений клиента:\n\n${messagesText}`;

    if (!lovableApiKey) {
      console.error("[analyze-contact-loyalty] LOVABLE_API_KEY not configured");
      return new Response(
        JSON.stringify({ error: "AI API key not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${lovableApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.3,
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error("[analyze-contact-loyalty] AI API error:", aiResponse.status, errorText);
      
      if (aiResponse.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded, please try again later" }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      throw new Error(`AI API error: ${aiResponse.status}`);
    }

    let aiData;
    try {
      const responseText = await aiResponse.text();
      if (!responseText || responseText.trim() === "") {
        throw new Error("Empty AI response");
      }
      aiData = JSON.parse(responseText);
    } catch (parseError) {
      console.error("[analyze-contact-loyalty] Failed to parse AI response:", parseError);
      throw new Error("Failed to parse AI response");
    }

    const aiContent = aiData.choices?.[0]?.message?.content || "";
    console.log("[analyze-contact-loyalty] AI response length:", aiContent.length);

    // Parse AI response
    let analysisResult: LoyaltyAnalysisResult;
    try {
      // Clean up the response - remove markdown code blocks if present
      let cleanContent = aiContent.trim();
      if (cleanContent.startsWith("```json")) {
        cleanContent = cleanContent.slice(7);
      }
      if (cleanContent.startsWith("```")) {
        cleanContent = cleanContent.slice(3);
      }
      if (cleanContent.endsWith("```")) {
        cleanContent = cleanContent.slice(0, -3);
      }
      
      analysisResult = JSON.parse(cleanContent.trim());
    } catch (parseError) {
      console.error("[analyze-contact-loyalty] Failed to parse AI JSON:", parseError, aiContent);
      
      // Fallback: extract score from text if possible
      const scoreMatch = aiContent.match(/score["\s:]+(\d+)/i);
      const extractedScore = scoreMatch ? parseInt(scoreMatch[1]) : 5;
      
      analysisResult = {
        score: extractedScore,
        status_label: extractedScore <= 4 ? "Недоволен" : extractedScore >= 7 ? "Лояльный" : "Нейтрально",
        ai_summary: "Не удалось получить полный анализ от AI",
        reason: "Требуется повторный анализ",
        proofs: [],
        messages_analyzed: messagesCount,
      };
    }

    // Validate and clamp score
    const validScore = Math.min(10, Math.max(1, Math.round(analysisResult.score || 5)));

    // Update profile with analysis results
    const { error: updateError } = await supabase
      .from("profiles")
      .update({
        loyalty_score: validScore,
        loyalty_ai_summary: analysisResult.ai_summary || null,
        loyalty_status_reason: analysisResult.reason || null,
        loyalty_proofs: analysisResult.proofs || [],
        loyalty_analyzed_messages_count: messagesCount,
        loyalty_updated_at: new Date().toISOString(),
      })
      .eq("id", targetProfileId);

    if (updateError) {
      console.error("[analyze-contact-loyalty] Error updating profile:", updateError);
      throw updateError;
    }

    console.log(`[analyze-contact-loyalty] Updated profile ${targetProfileId} with score ${validScore}`);

    return new Response(
      JSON.stringify({
        success: true,
        profile_id: targetProfileId,
        score: validScore,
        status_label: analysisResult.status_label,
        ai_summary: analysisResult.ai_summary,
        proofs_count: analysisResult.proofs?.length || 0,
        messages_analyzed: messagesCount,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("[analyze-contact-loyalty] Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
