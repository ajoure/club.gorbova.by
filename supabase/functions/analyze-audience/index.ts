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

    // Fetch ALL audience messages with pagination (not from Katerina)
    const KATERINA_USER_ID = 99340019;
    let allMessages: any[] = [];
    let offset = 0;
    const batchSize = 1000;

    console.log("[analyze-audience] Fetching all messages with pagination...");

    while (true) {
      const { data: batch, error: fetchError } = await supabase
        .from("tg_chat_messages")
        .select("id, text, message_ts, from_display_name, from_tg_user_id")
        .not("text", "is", null)
        .neq("from_tg_user_id", KATERINA_USER_ID)
        .order("message_ts", { ascending: false })
        .range(offset, offset + batchSize - 1);

      if (fetchError) {
        throw new Error(`Failed to fetch messages: ${fetchError.message}`);
      }

      if (!batch || batch.length === 0) break;

      allMessages = [...allMessages, ...batch];
      offset += batchSize;
      console.log(`[analyze-audience] Fetched ${allMessages.length} messages so far...`);

      if (batch.length < batchSize) break;
    }

    console.log(`[analyze-audience] Total messages fetched: ${allMessages.length}`);

    if (allMessages.length < 10) {
      return new Response(JSON.stringify({
        success: false,
        error: "Недостаточно сообщений для анализа. Минимум: 10 сообщений.",
        message_count: allMessages.length,
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Filter meaningful messages (at least 10 characters)
    const meaningfulMessages = allMessages.filter(m => m.text && m.text.trim().length >= 10);
    console.log(`[analyze-audience] Meaningful messages: ${meaningfulMessages.length}`);

    // Analyze in batches of 800 messages for better context
    const BATCH_SIZE_FOR_AI = 800;
    const batches: string[][] = [];
    
    for (let i = 0; i < meaningfulMessages.length; i += BATCH_SIZE_FOR_AI) {
      const batch = meaningfulMessages.slice(i, i + BATCH_SIZE_FOR_AI);
      batches.push(batch.map(m => `[${m.from_display_name || 'Пользователь'}]: ${m.text}`));
    }

    console.log(`[analyze-audience] Split into ${batches.length} batches for AI analysis`);

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    // Analyze each batch and collect insights
    let allInsights: AudienceInsight[] = [];
    let allSummaries: string[] = [];

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      console.log(`[analyze-audience] Analyzing batch ${batchIndex + 1}/${batches.length} (${batch.length} messages)`);

      const messagesForAnalysis = batch.join("\n\n");

      const aiPrompt = `Проанализируй сообщения пользователей из чата с коучем/консультантом и выдели ключевые инсайты для маркетинга.

СООБЩЕНИЯ ПОЛЬЗОВАТЕЛЕЙ (часть ${batchIndex + 1} из ${batches.length}):
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
  "summary": "Краткое резюме аудитории этой части (2-3 предложения)"
}`;

      const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "Authorization": `Bearer ${LOVABLE_API_KEY}`,
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-pro", // Using Pro for better analysis of large context
          messages: [{ role: "user", content: aiPrompt }],
        }),
      });

      if (!aiResponse.ok) {
        const errorText = await aiResponse.text();
        console.error(`[analyze-audience] AI API error for batch ${batchIndex + 1}:`, aiResponse.status, errorText);
        // Continue with other batches if one fails
        continue;
      }

      // Safely parse AI response with error handling
      let aiData;
      try {
        const responseText = await aiResponse.text();
        if (!responseText || responseText.trim() === "") {
          console.error(`[analyze-audience] Empty response for batch ${batchIndex + 1}`);
          continue;
        }
        aiData = JSON.parse(responseText);
      } catch (parseError) {
        console.error(`[analyze-audience] Failed to parse AI response for batch ${batchIndex + 1}:`, parseError);
        continue;
      }

      const aiContent = aiData.choices?.[0]?.message?.content || "";

      try {
        const jsonMatch = aiContent.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error("No JSON in response");
        const batchResult = JSON.parse(jsonMatch[0]);
        
        if (batchResult.insights && Array.isArray(batchResult.insights)) {
          allInsights = [...allInsights, ...batchResult.insights];
        }
        if (batchResult.summary) {
          allSummaries.push(batchResult.summary);
        }
      } catch (parseError) {
        console.error(`[analyze-audience] Parse error for batch ${batchIndex + 1}:`, parseError);
        // Continue with other batches
      }
    }

    console.log(`[analyze-audience] Total insights collected: ${allInsights.length}`);

    // Deduplicate and merge similar insights
    const mergedInsights = mergeInsights(allInsights);
    console.log(`[analyze-audience] After merging: ${mergedInsights.length} unique insights`);

    // Generate final summary if we have multiple batches
    let finalSummary = allSummaries.join(" ");
    if (batches.length > 1 && allSummaries.length > 0) {
      try {
        const summaryPrompt = `Объедини эти резюме в одно краткое (2-3 предложения) о целевой аудитории:\n\n${allSummaries.join("\n\n")}`;
        
        const summaryResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: { 
            "Content-Type": "application/json",
            "Authorization": `Bearer ${LOVABLE_API_KEY}`,
          },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash",
            messages: [{ role: "user", content: summaryPrompt }],
          }),
        });

        if (summaryResponse.ok) {
          const summaryData = await summaryResponse.json();
          finalSummary = summaryData.choices?.[0]?.message?.content || finalSummary;
        }
      } catch (e) {
        console.error("[analyze-audience] Error generating final summary:", e);
      }
    }

    // Get date range from messages
    const sortedMsgs = [...allMessages].sort(
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
    } else {
      // Clear all insights if no channel_id
      await supabase
        .from("audience_insights")
        .delete()
        .is("channel_id", null);
    }

    const insightsToInsert = mergedInsights.map(insight => ({
      channel_id: channel_id || null,
      insight_type: insight.insight_type,
      title: insight.title,
      description: insight.description,
      examples: insight.examples,
      frequency: insight.frequency,
      sentiment: insight.sentiment,
      relevance_score: insight.relevance_score,
      source_message_count: allMessages.length,
      first_seen_at: firstSeen,
      last_seen_at: lastSeen,
      meta: { summary: finalSummary, batches_analyzed: batches.length },
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
        messages_analyzed: allMessages.length,
        meaningful_messages: meaningfulMessages.length,
        batches_processed: batches.length,
        insights_found: mergedInsights.length,
        summary: finalSummary,
      },
    });

    return new Response(JSON.stringify({
      success: true,
      messages_analyzed: allMessages.length,
      meaningful_messages: meaningfulMessages.length,
      batches_processed: batches.length,
      insights_count: mergedInsights.length,
      insights: mergedInsights,
      summary: finalSummary,
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

// Helper function to merge similar insights
function mergeInsights(insights: AudienceInsight[]): AudienceInsight[] {
  const merged: Map<string, AudienceInsight> = new Map();

  for (const insight of insights) {
    // Create a key based on type and normalized title
    const key = `${insight.insight_type}:${insight.title.toLowerCase().trim()}`;
    
    if (merged.has(key)) {
      // Merge with existing
      const existing = merged.get(key)!;
      existing.frequency = Math.min(10, existing.frequency + insight.frequency);
      existing.relevance_score = Math.max(existing.relevance_score, insight.relevance_score);
      // Add unique examples
      const existingExamples = new Set(existing.examples);
      for (const example of insight.examples) {
        if (!existingExamples.has(example) && existing.examples.length < 5) {
          existing.examples.push(example);
        }
      }
    } else {
      merged.set(key, { ...insight });
    }
  }

  // Sort by relevance score
  return Array.from(merged.values()).sort((a, b) => b.relevance_score - a.relevance_score);
}
