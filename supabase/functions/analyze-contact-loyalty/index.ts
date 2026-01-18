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

interface CommunicationStyle {
  tone: string;
  keywords_to_use: string[];
  topics_to_avoid: string[];
  recommendations: string;
}

interface PainPoint {
  description: string;
  keywords: string[];
  sentiment_score: number;
}

interface LoyaltyAnalysisResult {
  score: number;
  status_label: string;
  ai_summary: string;
  reason: string;
  proofs: LoyaltyProof[];
  messages_analyzed: number;
  communication_style: CommunicationStyle;
  pain_points?: PainPoint[];
}

// Tool schema for structured output
const loyaltyAnalysisTool = {
  type: "function",
  function: {
    name: "analyze_loyalty",
    description: "Analyze customer loyalty based on their messages and return structured results",
    parameters: {
      type: "object",
      properties: {
        score: {
          type: "number",
          description: "Loyalty score from 1 to 10"
        },
        status_label: {
          type: "string",
          enum: ["Хейтер", "Недоволен", "Нейтрально", "Лояльный", "Адепт/Фанат"],
          description: "Status label based on score"
        },
        ai_summary: {
          type: "string",
          description: "Brief summary of customer attitude (2-3 sentences)"
        },
        reason: {
          type: "string",
          description: "Explanation for the score"
        },
        proofs: {
          type: "array",
          items: {
            type: "object",
            properties: {
              quote: { type: "string", description: "Exact quote from message" },
              date: { type: "string", description: "Message date in ISO format" },
              sentiment: { type: "string", enum: ["positive", "negative", "neutral"] },
              context: { type: "string", description: "Brief context (optional)" }
            },
            required: ["quote", "date", "sentiment"],
            additionalProperties: false
          },
          description: "Up to 10 key quotes as evidence"
        },
        communication_style: {
          type: "object",
          properties: {
            tone: { 
              type: "string", 
              enum: ["Деловой", "Дружеский", "Экспертный", "Неформальный"],
              description: "Preferred communication tone"
            },
            keywords_to_use: {
              type: "array",
              items: { type: "string" },
              description: "Words/phrases the customer uses and responds to"
            },
            topics_to_avoid: {
              type: "array",
              items: { type: "string" },
              description: "Topics that caused negative reactions"
            },
            recommendations: {
              type: "string",
              description: "Brief recommendations for manager (1-2 sentences)"
            }
          },
          required: ["tone", "keywords_to_use", "topics_to_avoid", "recommendations"],
          additionalProperties: false,
          description: "Communication style recommendations"
        },
        pain_points: {
          type: "array",
          items: {
            type: "object",
            properties: {
              description: { type: "string" },
              keywords: { type: "array", items: { type: "string" } },
              sentiment_score: { type: "number" }
            },
            required: ["description", "keywords", "sentiment_score"],
            additionalProperties: false
          },
          description: "Customer pain points"
        }
      },
      required: ["score", "status_label", "ai_summary", "reason", "proofs", "communication_style"],
      additionalProperties: false
    }
  }
};

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
      .select("id, text, created_at, from_display_name, chat_id, message_ts")
      .eq("from_tg_user_id", targetTelegramUserId)
      .not("text", "is", null)
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
          communication_style: null,
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
      .map(m => `[${m.message_ts || m.created_at}] ${m.from_display_name || "User"}: ${m.text}`)
      .join("\n");

    // System prompt for tool calling
    const systemPrompt = `Ты эксперт по анализу клиентской лояльности и коммуникаций. Проанализируй сообщения клиента и вызови функцию analyze_loyalty с результатами.

Твоя задача:
1. Оценить общий тон сообщений (позитивный/негативный/нейтральный)
2. Найти признаки лояльности (благодарности, рекомендации, довольные отзывы)
3. Найти признаки недовольства (жалобы, критика, негатив)
4. Выбрать до 10 ключевых цитат-доказательств
5. Выставить итоговый балл от 1 до 10
6. ОБЯЗАТЕЛЬНО определить предпочтительный стиль общения клиента (communication_style)
7. Выявить болевые точки для сохранения в аналитику

ВАЖНО: 
- Детектируй сарказм! Если клиент пишет "Ну спасибо, очень 'быстро' ответили" - это негатив, не позитив.
- ОБЯЗАТЕЛЬНО заполни communication_style с рекомендациями по общению!

Шкала оценок:
1-2: Хейтер (активно критикует, негативные отзывы)
3-4: Недоволен (есть жалобы, разочарование)
5-6: Нейтрально (нет выраженных эмоций, обычные вопросы)
7-8: Лояльный (позитивные отзывы, благодарности)
9-10: Адепт/Фанат (восторженные отзывы, рекомендует другим)`;

    const userPrompt = `Проанализируй эти ${messagesCount} сообщений клиента и вызови функцию analyze_loyalty:\n\n${messagesText}`;

    if (!lovableApiKey) {
      console.error("[analyze-contact-loyalty] LOVABLE_API_KEY not configured");
      return new Response(
        JSON.stringify({ error: "AI API key not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Use tool calling for structured output
    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${lovableApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        tools: [loyaltyAnalysisTool],
        tool_choice: { type: "function", function: { name: "analyze_loyalty" } },
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
      if (aiResponse.status === 402) {
        return new Response(
          JSON.stringify({ error: "Payment required, please add credits" }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
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

    // Extract tool call result
    let analysisResult: LoyaltyAnalysisResult;
    
    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
    if (toolCall && toolCall.function?.arguments) {
      try {
        analysisResult = JSON.parse(toolCall.function.arguments);
        console.log(`[analyze-contact-loyalty] Tool call success: score=${analysisResult.score}, hasCommunicationStyle=${!!analysisResult.communication_style}, keywordsCount=${analysisResult.communication_style?.keywords_to_use?.length || 0}`);
      } catch (parseError) {
        console.error("[analyze-contact-loyalty] Failed to parse tool call arguments:", parseError);
        throw new Error("Failed to parse tool call result");
      }
    } else {
      // Fallback: try to parse content as JSON (legacy mode)
      const aiContent = aiData.choices?.[0]?.message?.content || "";
      console.log("[analyze-contact-loyalty] No tool call, trying content parse. Length:", aiContent.length);
      
      try {
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
        console.error("[analyze-contact-loyalty] Failed to parse AI JSON content:", parseError);
        
        // Create fallback result with default communication_style
        const scoreMatch = aiContent.match(/score["\s:]+(\d+)/i);
        const extractedScore = scoreMatch ? parseInt(scoreMatch[1]) : 5;
        
        analysisResult = {
          score: extractedScore,
          status_label: extractedScore <= 4 ? "Недоволен" : extractedScore >= 7 ? "Лояльный" : "Нейтрально",
          ai_summary: "Не удалось получить полный анализ от AI",
          reason: "Требуется повторный анализ",
          proofs: [],
          messages_analyzed: messagesCount,
          communication_style: {
            tone: "Деловой",
            keywords_to_use: [],
            topics_to_avoid: [],
            recommendations: "Рекомендуется повторно запустить анализ для получения рекомендаций по общению"
          }
        };
      }
    }

    // Ensure communication_style exists (fallback)
    if (!analysisResult.communication_style) {
      console.log("[analyze-contact-loyalty] communication_style missing, adding fallback");
      analysisResult.communication_style = {
        tone: "Деловой",
        keywords_to_use: [],
        topics_to_avoid: [],
        recommendations: "Стиль общения не определён, рекомендуется повторный анализ"
      };
    }

    // Normalize communication_style keys (handle camelCase/snake_case variations)
    const commStyle = analysisResult.communication_style as any;
    const normalizedCommStyle: CommunicationStyle = {
      tone: commStyle.tone || commStyle.Tone || "Деловой",
      keywords_to_use: commStyle.keywords_to_use || commStyle.keywordsToUse || commStyle.keywords || [],
      topics_to_avoid: commStyle.topics_to_avoid || commStyle.topicsToAvoid || commStyle.avoid || [],
      recommendations: commStyle.recommendations || commStyle.recommendation || ""
    };

    // Validate and clamp score
    const validScore = Math.min(10, Math.max(1, Math.round(analysisResult.score || 5)));

    console.log(`[analyze-contact-loyalty] Saving: score=${validScore}, commStyleTone=${normalizedCommStyle.tone}, keywordsCount=${normalizedCommStyle.keywords_to_use.length}, topicsCount=${normalizedCommStyle.topics_to_avoid.length}`);

    // Update profile with analysis results including communication_style
    const { error: updateError } = await supabase
      .from("profiles")
      .update({
        loyalty_score: validScore,
        loyalty_ai_summary: analysisResult.ai_summary || null,
        loyalty_status_reason: analysisResult.reason || null,
        loyalty_proofs: analysisResult.proofs || [],
        loyalty_analyzed_messages_count: messagesCount,
        loyalty_updated_at: new Date().toISOString(),
        communication_style: normalizedCommStyle,
      })
      .eq("id", targetProfileId);

    if (updateError) {
      console.error("[analyze-contact-loyalty] Error updating profile:", updateError);
      throw updateError;
    }

    // Save pain points to marketing_insights table
    if (analysisResult.pain_points && analysisResult.pain_points.length > 0) {
      console.log(`[analyze-contact-loyalty] Saving ${analysisResult.pain_points.length} pain points to marketing_insights`);
      
      for (const painPoint of analysisResult.pain_points) {
        try {
          await supabase.from("marketing_insights").upsert({
            insight_type: "complaint",
            content: painPoint.description,
            source_type: "telegram_chat",
            profile_id: targetProfileId,
            sentiment_score: painPoint.sentiment_score || -0.5,
            keywords: painPoint.keywords || [],
            is_actionable: true,
            extracted_by: "ai_loyalty_analysis",
          }, { 
            onConflict: "profile_id,content",
            ignoreDuplicates: true 
          });
        } catch (insertError) {
          // Non-critical, just log and continue
          console.warn("[analyze-contact-loyalty] Failed to save pain point:", insertError);
        }
      }
    }

    console.log(`[analyze-contact-loyalty] Updated profile ${targetProfileId} with score ${validScore}`);

    return new Response(
      JSON.stringify({
        success: true,
        profile_id: targetProfileId,
        score: validScore,
        status_label: analysisResult.status_label,
        ai_summary: analysisResult.ai_summary,
        reason: analysisResult.reason,
        proofs: analysisResult.proofs || [],
        proofs_count: analysisResult.proofs?.length || 0,
        messages_analyzed: messagesCount,
        communication_style: normalizedCommStyle,
        pain_points_saved: analysisResult.pain_points?.length || 0,
        loyalty_updated_at: new Date().toISOString(),
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
