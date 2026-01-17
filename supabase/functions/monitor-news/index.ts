import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface NewsSource {
  id: string;
  name: string;
  url: string;
  country: string;
  category: string;
  priority: number;
  scrape_config: Record<string, unknown>;
}

interface ScrapedItem {
  title: string;
  url: string;
  content: string;
  date?: string;
}

interface AIAnalysis {
  is_relevant: boolean;
  title: string;
  summary: string;
  effective_date: string | null;
  category: "digest" | "comments" | "urgent";
  keywords: string[];
}

// Keywords for filtering relevant business news
const RELEVANCE_KEYWORDS = [
  // Taxes
  "налог", "ндс", "подоходн", "прибыль", "налогообложен",
  // Accounting
  "бухучет", "бухгалтер", "отчетност", "баланс", "учет",
  // Inspections
  "проверк", "контрол", "кгк", "мнс", "аудит",
  // Social security
  "фсзн", "пенси", "пособи", "страхов", "соцстрах",
  // Currency & Finance
  "валют", "курс", "нацбанк", "ставк", "кредит",
  // Sanctions & Restrictions
  "санкци", "ограничен", "запрет", "блокиров",
  // Licensing
  "лицензи", "разрешен", "сертификат",
  // Business support
  "субсиди", "льгот", "поддержк", "грант",
  // Legal
  "кодекс", "закон", "постановлен", "указ", "декрет", "нпа",
  // Other
  "ип", "предпринимат", "юрлиц", "организаци",
];

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const firecrawlKey = Deno.env.get("FIRECRAWL_API_KEY");
    const lovableKey = Deno.env.get("LOVABLE_API_KEY");

    const supabase = createClient(supabaseUrl, supabaseKey);

    const { sourceId, limit = 5 } = await req.json().catch(() => ({}));

    // Get active sources
    let query = supabase
      .from("news_sources")
      .select("*")
      .eq("is_active", true)
      .order("priority", { ascending: false });

    if (sourceId) {
      query = query.eq("id", sourceId);
    } else {
      query = query.limit(limit);
    }

    const { data: sources, error: sourcesError } = await query;

    if (sourcesError) {
      throw new Error(`Failed to fetch sources: ${sourcesError.message}`);
    }

    console.log(`[monitor-news] Processing ${sources?.length || 0} sources`);

    const results: { source: string; items: number; errors: string[] }[] = [];

    for (const source of sources || []) {
      const sourceResult = { source: source.name, items: 0, errors: [] as string[] };

      try {
        // Scrape source using Firecrawl
        const scrapedItems = await scrapeSource(source, firecrawlKey);
        console.log(`[monitor-news] ${source.name}: scraped ${scrapedItems.length} items`);

        for (const item of scrapedItems) {
          try {
            // Check if already exists
            const { data: existing } = await supabase
              .from("news_content")
              .select("id")
              .eq("source_url", item.url)
              .maybeSingle();

            if (existing) {
              console.log(`[monitor-news] Skipping duplicate: ${item.url}`);
              continue;
            }

            // Quick relevance check
            const contentLower = (item.title + " " + item.content).toLowerCase();
            const isQuickRelevant = RELEVANCE_KEYWORDS.some((kw) =>
              contentLower.includes(kw)
            );

            if (!isQuickRelevant) {
              console.log(`[monitor-news] Skipping irrelevant: ${item.title.slice(0, 50)}`);
              continue;
            }

            // AI analysis
            const analysis = await analyzeWithAI(item, lovableKey);

            if (!analysis.is_relevant) {
              console.log(`[monitor-news] AI marked as irrelevant: ${item.title.slice(0, 50)}`);
              continue;
            }

            // Save to database
            // IMPORTANT: category must be one of: digest, comments, urgent (CHECK constraint)
            // Use AI-determined category, not source.category (which is: government, npa, media)
            const { error: insertError } = await supabase.from("news_content").insert({
              title: analysis.title || item.title,
              summary: analysis.summary,
              source: source.name,
              source_url: item.url,
              country: source.country,
              category: analysis.category || "digest", // AI returns: digest | comments | urgent
              source_id: source.id,
              raw_content: item.content.slice(0, 10000),
              ai_summary: analysis.summary,
              effective_date: analysis.effective_date,
              keywords: analysis.keywords,
              news_priority: analysis.category === "urgent" ? "urgent" : "normal",
              telegram_status: "draft",
              scraped_at: new Date().toISOString(),
              is_published: false,
              created_by: null,
            });

            if (insertError) {
              sourceResult.errors.push(`Insert error: ${insertError.message}`);
            } else {
              sourceResult.items++;
            }
          } catch (itemError) {
            sourceResult.errors.push(`Item error: ${itemError instanceof Error ? itemError.message : String(itemError)}`);
          }
        }

        // Update source last_scraped_at
        await supabase
          .from("news_sources")
          .update({
            last_scraped_at: new Date().toISOString(),
            last_error: sourceResult.errors.length > 0 ? sourceResult.errors.join("; ") : null,
          })
          .eq("id", source.id);
      } catch (sourceError) {
        const errMsg = sourceError instanceof Error ? sourceError.message : String(sourceError);
        sourceResult.errors.push(`Source error: ${errMsg}`);
        await supabase
          .from("news_sources")
          .update({ last_error: errMsg })
          .eq("id", source.id);
      }

      results.push(sourceResult);
    }

    const totalItems = results.reduce((sum, r) => sum + r.items, 0);
    console.log(`[monitor-news] Completed: ${totalItems} new items from ${results.length} sources`);

    return new Response(
      JSON.stringify({
        success: true,
        results,
        totalItems,
        sourcesProcessed: results.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[monitor-news] Error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function scrapeSource(
  source: NewsSource,
  firecrawlKey: string | undefined
): Promise<ScrapedItem[]> {
  if (!firecrawlKey) {
    console.log(`[monitor-news] No Firecrawl key, using mock data for ${source.name}`);
    return [];
  }

  try {
    const response = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${firecrawlKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: source.url,
        formats: ["markdown"],
        onlyMainContent: true,
        waitFor: 3000,
        location: {
          country: source.country === "by" ? "BY" : "RU",
          languages: ["ru"],
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Firecrawl error ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    const markdown = data.data?.markdown || "";

    // Parse markdown to extract news items
    const items = parseNewsFromMarkdown(markdown, source.url);
    return items;
  } catch (error) {
    console.error(`[monitor-news] Scrape error for ${source.name}:`, error);
    return [];
  }
}

function parseNewsFromMarkdown(markdown: string, baseUrl: string): ScrapedItem[] {
  const items: ScrapedItem[] = [];

  // Split by headers or list items
  const sections = markdown.split(/\n(?=#{1,3}\s|\*\s|\d+\.\s)/);

  for (const section of sections) {
    if (section.trim().length < 50) continue;

    // Extract title from first line
    const lines = section.trim().split("\n");
    const titleLine = lines[0].replace(/^[#*\d.]+\s*/, "").trim();

    if (titleLine.length < 10) continue;

    // Extract URL if present
    const urlMatch = section.match(/\[([^\]]+)\]\(([^)]+)\)/);
    const url = urlMatch ? urlMatch[2] : baseUrl;

    // Clean content
    const content = lines.slice(1).join("\n").trim();

    if (titleLine && content.length > 20) {
      items.push({
        title: titleLine.slice(0, 300),
        url: url.startsWith("http") ? url : new URL(url, baseUrl).href,
        content: content.slice(0, 5000),
      });
    }
  }

  return items.slice(0, 10); // Limit to 10 items per source
}

async function analyzeWithAI(
  item: ScrapedItem,
  lovableKey: string | undefined
): Promise<AIAnalysis> {
  if (!lovableKey) {
    // Fallback without AI
    return {
      is_relevant: true,
      title: item.title,
      summary: item.content.slice(0, 500),
      effective_date: null,
      category: "digest",
      keywords: [],
    };
  }

  try {
    const systemPrompt = `Ты — редактор бизнес-издания для бухгалтеров и предпринимателей Беларуси и России.

Проанализируй новость и верни JSON:
{
  "is_relevant": true/false,
  "title": "Краткий заголовок до 100 символов",
  "summary": "Описание до 200 слов: что изменилось, кого касается, что делать",
  "effective_date": "YYYY-MM-DD или null",
  "category": "urgent|digest|comments",
  "keywords": ["налоги", "ФСЗН", ...]
}

Критерии релевантности (is_relevant = true):
- Изменения в налоговом законодательстве
- Новые требования для бизнеса
- Административные процедуры
- Проверки и контроль
- Изменения ставок, сроков, форм
- ФСЗН, пенсии, пособия
- Валютное регулирование

НЕ релевантно (is_relevant = false):
- Общие новости экономики без конкретных изменений
- Политические новости
- Спорт, развлечения
- Статистика без практического значения

Категории:
- urgent: срочные изменения, вступающие в силу в ближайшие 30 дней
- digest: обычные новости для дайджеста
- comments: требует комментария эксперта

Отвечай ТОЛЬКО валидным JSON без markdown.`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovableKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: `Заголовок: ${item.title}\n\nТекст:\n${item.content.slice(0, 3000)}`,
          },
        ],
        max_tokens: 500,
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      console.error("[monitor-news] AI error:", response.status);
      return {
        is_relevant: true,
        title: item.title,
        summary: item.content.slice(0, 500),
        effective_date: null,
        category: "digest",
        keywords: [],
      };
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content?.trim() || "";

    // Parse JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        is_relevant: parsed.is_relevant ?? true,
        title: parsed.title || item.title,
        summary: parsed.summary || item.content.slice(0, 500),
        effective_date: parsed.effective_date || null,
        category: parsed.category || "digest",
        keywords: parsed.keywords || [],
      };
    }

    throw new Error("No valid JSON in response");
  } catch (error) {
    console.error("[monitor-news] AI parse error:", error);
    return {
      is_relevant: true,
      title: item.title,
      summary: item.content.slice(0, 500),
      effective_date: null,
      category: "digest",
      keywords: [],
    };
  }
}
