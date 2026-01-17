import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface AudienceInsight {
  insight_type: 'topic' | 'question' | 'problem' | 'pain_point' | 'objection' | 'interest';
  title: string;
  description: string;
  examples: string[];
  frequency: number;
  sentiment: 'positive' | 'negative' | 'neutral' | 'mixed';
  relevance_score: number;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json();
    const { channel_id, force = false } = body;

    console.log("[analyze-audience] Starting audience analysis");

    // Check if we already have recent analysis
    if (!force) {
      const { data: existingInsights } = await supabase
        .from("audience_insights")
        .select("updated_at")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existingInsights) {
        const lastUpdate = new Date(existingInsights.updated_at);
        const hoursSinceUpdate = (Date.now() - lastUpdate.getTime()) / (1000 * 60 * 60);
        
        if (hoursSinceUpdate < 24) {
          return new Response(JSON.stringify({
            success: true,
            cached: true,
            message: "Анализ уже проводился менее 24 часов назад. Используйте force=true для повторного анализа.",
          }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
    }

    // Fetch audience messages (not from Katerina)
    const KATERINA_USER_ID = 99340019;
    const { data: messages, error: fetchError } = await supabase
      .from("tg_chat_messages")
      .select("id, text, message_ts, from_display_name, from_tg_user_id")
      .not("text", "is", null)
      .neq("from_tg_user_id", KATERINA_USER_ID)
      .order("message_ts", { ascending: false })
      .limit(500);

    if (fetchError) {
      throw new Error(`Failed to fetch messages: ${fetchError.message}`);
    }

    if (!messages || messages.length < 10) {
      return new Response(JSON.stringify({
        success: false,
        error: "Недостаточно сообщений для анализа. Минимум: 10 сообщений.",
        message_count: messages?.length || 0,
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[analyze-audience] Analyzing ${messages.length} messages`);

    // Prepare messages for AI analysis
    const messagesForAnalysis = messages
      .filter(m => m.text && m.text.trim().length >= 10)
      .map(m => `[${m.from_display_name || 'Пользователь'}]: ${m.text}`)
      .slice(0, 300) // Limit for context
      .join("\n\n");

    // Call AI for analysis
    const aiPrompt = `Проанализируй сообщения пользователей из чата с коучем/консультантом и выдели ключевые инсайты для маркетинга.

СООБЩЕНИЯ ПОЛЬЗОВАТЕЛЕЙ:
${messagesForAnalysis}

ЗАДАЧА:
Выдели и структурируй информацию по категориям:

1. **Темы (topics)** - о чём спрашивают, что обсуждают
2. **Вопросы (questions)** - частые вопросы
3. **Проблемы (problems)** - с чем сталкиваются
4. **Боли (pain_points)** - глубинные боли и страхи
5. **Возражения (objections)** - сомнения и возражения
6. **Интересы (interests)** - что интересует, на что реагируют

Для каждого инсайта укажи:
- title: короткое название
- description: описание (1-2 предложения)
- examples: 2-3 примера из сообщений (цитаты)
- frequency: частота упоминания (1-10)
- sentiment: тональность (positive/negative/neutral/mixed)
- relevance_score: релевантность для маркетинга (0.0-1.0)

Ответь ТОЛЬКО валидным JSON в формате:
{
  "insights": [
    {
      "insight_type": "topic|question|problem|pain_point|objection|interest",
      "title": "...",
      "description": "...",
      "examples": ["...", "..."],
      "frequency": 5,
      "sentiment": "neutral",
      "relevance_score": 0.8
    }
  ],
  "summary": "Краткое резюме аудитории (2-3 предложения)"
}`;

    const aiResponse = await fetch("https://api.lovable.dev/api/v1/ai/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [{ role: "user", content: aiPrompt }],
      }),
    });

    if (!aiResponse.ok) {
      throw new Error(`AI API error: ${aiResponse.status}`);
    }

    const aiData = await aiResponse.json();
    const aiContent = aiData.choices?.[0]?.message?.content || "";

    // Parse AI response
    let analysisResult: { insights: AudienceInsight[]; summary: string };
    try {
      const jsonMatch = aiContent.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON in response");
      analysisResult = JSON.parse(jsonMatch[0]);
    } catch (parseError) {
      console.error("[analyze-audience] Parse error:", parseError);
      throw new Error("Не удалось распарсить ответ ИИ");
    }

    console.log(`[analyze-audience] Found ${analysisResult.insights.length} insights`);

    // Get date range from messages
    const sortedMsgs = [...messages].sort(
      (a, b) => new Date(a.message_ts).getTime() - new Date(b.message_ts).getTime()
    );
    const firstSeen = sortedMsgs[0]?.message_ts;
    const lastSeen = sortedMsgs[sortedMsgs.length - 1]?.message_ts;

    // Clear old insights and insert new ones
    if (channel_id) {
      await supabase
        .from("audience_insights")
        .delete()
        .eq("channel_id", channel_id);
    }

    const insightsToInsert = analysisResult.insights.map(insight => ({
      channel_id: channel_id || null,
      insight_type: insight.insight_type,
      title: insight.title,
      description: insight.description,
      examples: insight.examples,
      frequency: insight.frequency,
      sentiment: insight.sentiment,
      relevance_score: insight.relevance_score,
      source_message_count: messages.length,
      first_seen_at: firstSeen,
      last_seen_at: lastSeen,
      meta: { summary: analysisResult.summary },
    }));

    const { error: insertError } = await supabase
      .from("audience_insights")
      .insert(insightsToInsert);

    if (insertError) {
      console.error("[analyze-audience] Insert error:", insertError);
    }

    // Log the action
    await supabase.from("telegram_logs").insert({
      action: "ANALYZE_AUDIENCE",
      target: channel_id || "all",
      status: "ok",
      meta: {
        messages_analyzed: messages.length,
        insights_found: analysisResult.insights.length,
        summary: analysisResult.summary,
      },
    });

    return new Response(JSON.stringify({
      success: true,
      messages_analyzed: messages.length,
      insights_count: analysisResult.insights.length,
      insights: analysisResult.insights,
      summary: analysisResult.summary,
      period: {
        from: firstSeen,
        to: lastSeen,
      },
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("[analyze-audience] Error:", error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : "Unknown error",
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
