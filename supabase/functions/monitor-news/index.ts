import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// Declare EdgeRuntime for background tasks
declare const EdgeRuntime: {
  waitUntil: (promise: Promise<unknown>) => void;
};

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

interface ScrapeStats {
  sources_total: number;
  sources_success: number;
  sources_failed: number;
  news_found: number;
  news_saved: number;
  news_duplicates: number;
  errors: Array<{ source: string; error: string; code?: string }>;
}

// Extended keywords for filtering relevant business news (softened filter)
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
  // Additional business terms (expanded)
  "бизнес", "компани", "фирм", "предприят", "малый", "средний",
  "регистрац", "ликвидац", "реорганизац",
  "договор", "контракт", "сделк",
  "штраф", "ответственност", "нарушен",
  "тариф", "пошлин", "сбор", "плат",
  "трудов", "зарплат", "оклад", "выплат",
  "импорт", "экспорт", "внешнеэконом", "вэд",
  "банкрот", "неплатежеспособн",
  "электронн", "эцп", "цифров",
  "маркировк", "прослеживаем",
  "аренд", "недвижим", "имуществ",
  "госзакупк", "тендер", "конкурс",
  "минфин", "минэконом", "минтруд",
];

// Specific deep URLs for certain sources
const DEEP_URLS: Record<string, string[]> = {
  "pravo.by": [
    "/pravovaya-informatsiya/novosti-zakonodatelstva/",
    "/news/",
  ],
  "nalog.gov.by": [
    "/info/novosti/",
    "/news/",
  ],
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const firecrawlKey = Deno.env.get("FIRECRAWL_API_KEY");
  const lovableKey = Deno.env.get("LOVABLE_API_KEY");

  const supabase = createClient(supabaseUrl, supabaseKey);

  const { sourceId, limit = 10, async: runAsync = false } = await req.json().catch(() => ({}));

  // If async mode requested, start background task and return immediately
  if (runAsync) {
    // Create scrape log entry
    const { data: logEntry, error: logError } = await supabase
      .from("scrape_logs")
      .insert({
        status: "running",
        triggered_by: "manual",
      })
      .select()
      .single();

    if (logError) {
      console.error("[monitor-news] Failed to create log entry:", logError);
    }

    const scrapeLogId = logEntry?.id;

    // Start background processing
    EdgeRuntime.waitUntil(
      runScraping(supabase, firecrawlKey, lovableKey, sourceId, limit, scrapeLogId)
    );

    // Return immediately with 202 Accepted
    return new Response(
      JSON.stringify({
        success: true,
        status: "accepted",
        message: "Парсинг запущен в фоне",
        scrape_log_id: scrapeLogId,
      }),
      { 
        status: 202, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      }
    );
  }

  // Synchronous mode (for cron jobs or direct calls)
  try {
    const result = await runScraping(supabase, firecrawlKey, lovableKey, sourceId, limit, null);
    
    return new Response(
      JSON.stringify(result),
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

// Main scraping function
// deno-lint-ignore no-explicit-any
async function runScraping(
  supabase: any,
  firecrawlKey: string | undefined,
  lovableKey: string | undefined,
  sourceId: string | undefined,
  limit: number,
  scrapeLogId: string | null
) {
  const stats: ScrapeStats = {
    sources_total: 0,
    sources_success: 0,
    sources_failed: 0,
    news_found: 0,
    news_saved: 0,
    news_duplicates: 0,
    errors: [],
  };

  try {
    // Fetch audience interests from last 48 hours for resonance matching
    const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString().split('T')[0];
    const { data: recentTopics } = await supabase
      .from('audience_interests')
      .select('topic')
      .gte('last_discussed', twoDaysAgo);

    const audienceTopics: string[] = (recentTopics || []).map((t: { topic: string }) => t.topic.toLowerCase());
    console.log(`[monitor-news] Loaded ${audienceTopics.length} audience topics from last 48h`);

    // Fetch style profile for adaptive prompting
    const { data: channelData } = await supabase
      .from('telegram_publish_channels')
      .select('settings')
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();

    const styleProfile = channelData?.settings?.style_profile || null;

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

    stats.sources_total = sources?.length || 0;
    console.log(`[monitor-news] Processing ${stats.sources_total} sources`);

    const results: { source: string; items: number; errors: string[] }[] = [];

    for (const source of sources || []) {
      const sourceResult = { source: source.name, items: 0, errors: [] as string[] };
      let sourceSuccess = true;
      let lastErrorCode: string | null = null;
      let lastErrorDetails: Record<string, unknown> | null = null;

      try {
        // Scrape source using Firecrawl with improved depth
        const { items: scrapedItems, errorCode, errorDetails } = await scrapeSourceWithDepth(source, firecrawlKey);
        console.log(`[monitor-news] ${source.name}: scraped ${scrapedItems.length} items`);

        if (errorCode) {
          lastErrorCode = errorCode;
          lastErrorDetails = errorDetails || null;
        }

        stats.news_found += scrapedItems.length;

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
              stats.news_duplicates++;
              continue;
            }

            // Quick relevance check (softened - any match passes)
            const contentLower = (item.title + " " + item.content).toLowerCase();
            const isQuickRelevant = RELEVANCE_KEYWORDS.some((kw) =>
              contentLower.includes(kw)
            );

            if (!isQuickRelevant) {
              console.log(`[monitor-news] Skipping irrelevant: ${item.title.slice(0, 50)}`);
              continue;
            }

            // AI analysis with style profile for adaptive prompting
            const analysis = await analyzeWithAI(item, lovableKey, styleProfile, audienceTopics);

            if (!analysis.is_relevant) {
              console.log(`[monitor-news] AI marked as irrelevant: ${item.title.slice(0, 50)}`);
              continue;
            }

            // Check resonance with audience interests
            const newsKeywords = (analysis.keywords || []).map(k => k.toLowerCase());
            const matchedTopics = audienceTopics.filter((topic: string) =>
              newsKeywords.some(kw => 
                topic.includes(kw) || kw.includes(topic)
              ) ||
              item.title.toLowerCase().includes(topic) ||
              item.content.toLowerCase().includes(topic)
            );
            const isResonant = matchedTopics.length > 0;

            if (isResonant) {
              console.log(`[monitor-news] 🔥 Resonant news found! Topics: ${matchedTopics.join(', ')}`);
            }

            // Save to database
            const { error: insertError } = await supabase.from("news_content").insert({
              title: analysis.title || item.title,
              summary: analysis.summary,
              source: source.name,
              source_url: item.url,
              country: source.country,
              category: analysis.category || "digest",
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
              is_resonant: isResonant,
              resonance_topics: matchedTopics,
            });

            if (insertError) {
              sourceResult.errors.push(`Insert error: ${insertError.message}`);
            } else {
              sourceResult.items++;
              stats.news_saved++;
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
            last_error_code: lastErrorCode,
            last_error_details: lastErrorDetails,
          })
          .eq("id", source.id);

        if (sourceResult.errors.length === 0 && scrapedItems.length > 0) {
          stats.sources_success++;
        } else if (scrapedItems.length === 0 && lastErrorCode) {
          sourceSuccess = false;
          stats.sources_failed++;
        } else {
          stats.sources_success++;
        }
      } catch (sourceError) {
        sourceSuccess = false;
        stats.sources_failed++;
        const errMsg = sourceError instanceof Error ? sourceError.message : String(sourceError);
        sourceResult.errors.push(`Source error: ${errMsg}`);
        
        // Parse error code from message if possible
        const errorCodeMatch = errMsg.match(/(\d{3})/);
        lastErrorCode = errorCodeMatch ? errorCodeMatch[1] : "unknown";
        lastErrorDetails = { message: errMsg, timestamp: new Date().toISOString() };
        
        stats.errors.push({
          source: source.name,
          error: errMsg,
          code: lastErrorCode,
        });
        
        await supabase
          .from("news_sources")
          .update({ 
            last_error: errMsg,
            last_error_code: lastErrorCode,
            last_error_details: lastErrorDetails,
          })
          .eq("id", source.id);
      }

      results.push(sourceResult);
    }

    console.log(`[monitor-news] Completed: ${stats.news_saved} new items from ${stats.sources_success}/${stats.sources_total} sources`);

    // Update scrape log if exists
    if (scrapeLogId) {
      const summary = `Найдено ${stats.news_saved} новостей из ${stats.sources_success} источников` +
        (stats.sources_failed > 0 ? ` (${stats.sources_failed} ошибок)` : '');
      
      await supabase
        .from("scrape_logs")
        .update({
          status: "completed",
          completed_at: new Date().toISOString(),
          sources_total: stats.sources_total,
          sources_success: stats.sources_success,
          sources_failed: stats.sources_failed,
          news_found: stats.news_found,
          news_saved: stats.news_saved,
          news_duplicates: stats.news_duplicates,
          errors: stats.errors,
          summary,
        })
        .eq("id", scrapeLogId);
    }

    return {
      success: true,
      results,
      stats,
      totalItems: stats.news_saved,
      sourcesProcessed: stats.sources_total,
    };
  } catch (error) {
    console.error("[monitor-news] Fatal error:", error);
    
    // Update scrape log with failure
    if (scrapeLogId) {
      await supabase
        .from("scrape_logs")
        .update({
          status: "failed",
          completed_at: new Date().toISOString(),
          ...stats,
          errors: [...stats.errors, { source: "system", error: error instanceof Error ? error.message : String(error) }],
          summary: `Ошибка: ${error instanceof Error ? error.message : String(error)}`,
        })
        .eq("id", scrapeLogId);
    }
    
    throw error;
  }
}

// Scrape with depth - use Map to discover URLs, then scrape individual pages
async function scrapeSourceWithDepth(
  source: NewsSource,
  firecrawlKey: string | undefined
): Promise<{ items: ScrapedItem[]; errorCode?: string; errorDetails?: Record<string, unknown> }> {
  if (!firecrawlKey) {
    console.log(`[monitor-news] No Firecrawl key, skipping ${source.name}`);
    return { items: [] };
  }

  try {
    const hostname = new URL(source.url).hostname;
    const allItems: ScrapedItem[] = [];
    let errorCode: string | undefined;
    let errorDetails: Record<string, unknown> | undefined;

    // Step 1: Try to map the website to find article URLs
    let articleUrls: string[] = [];
    
    try {
      const mapResponse = await fetch("https://api.firecrawl.dev/v1/map", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${firecrawlKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          url: source.url,
          limit: 30,
          includeSubdomains: false,
        }),
      });

      if (mapResponse.ok) {
        const mapData = await mapResponse.json();
        articleUrls = (mapData.links || []).filter((url: string) => {
          // Filter out image URLs and non-article links
          const lowerUrl = url.toLowerCase();
          return !lowerUrl.match(/\.(jpg|jpeg|png|gif|webp|svg|pdf|doc|docx|xls|xlsx)(\?|$)/i) &&
                 !lowerUrl.includes("/tag/") &&
                 !lowerUrl.includes("/category/") &&
                 !lowerUrl.includes("/author/") &&
                 url.length > 30; // Likely to be article URLs
        }).slice(0, 15);
        console.log(`[monitor-news] ${source.name}: mapped ${articleUrls.length} article URLs`);
      } else {
        errorCode = String(mapResponse.status);
        errorDetails = { 
          type: "map_failed", 
          status: mapResponse.status,
          statusText: mapResponse.statusText,
        };
      }
    } catch (mapError) {
      console.log(`[monitor-news] Map failed for ${source.name}, falling back to scrape`);
      errorCode = "map_error";
      errorDetails = { type: "map_exception", message: mapError instanceof Error ? mapError.message : String(mapError) };
    }

    // Step 2: If no URLs from map, scrape the main page
    if (articleUrls.length === 0) {
      const { content: scrapeResult, errorCode: scrapeErr, errorDetails: scrapeDetails } = await scrapeUrl(source.url, firecrawlKey, source.country);
      if (scrapeErr) {
        errorCode = scrapeErr;
        errorDetails = scrapeDetails;
      }
      if (scrapeResult) {
        const items = parseNewsFromMarkdown(scrapeResult, source.url);
        allItems.push(...items);
      }
    } else {
      // Step 3: Scrape individual article URLs (limit to 5 to save API calls)
      for (const articleUrl of articleUrls.slice(0, 5)) {
        try {
          const { content: scrapeResult } = await scrapeUrl(articleUrl, firecrawlKey, source.country);
          if (scrapeResult && scrapeResult.length > 100) {
            // Extract article from scraped content
            const title = extractTitle(scrapeResult);
            if (title && title.length > 10) {
              allItems.push({
                title: title.slice(0, 300),
                url: articleUrl,
                content: scrapeResult.slice(0, 5000),
              });
            }
          }
        } catch (articleError) {
          console.log(`[monitor-news] Failed to scrape article: ${articleUrl}`);
        }
      }
    }

    return { items: allItems.slice(0, 10), errorCode, errorDetails };
  } catch (error) {
    console.error(`[monitor-news] Scrape error for ${source.name}:`, error);
    return { 
      items: [], 
      errorCode: "exception",
      errorDetails: { message: error instanceof Error ? error.message : String(error) }
    };
  }
}

// Helper to scrape a single URL
async function scrapeUrl(
  url: string, 
  firecrawlKey: string, 
  country: string
): Promise<{ content: string | null; errorCode?: string; errorDetails?: Record<string, unknown> }> {
  try {
    const response = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${firecrawlKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: url,
        formats: ["markdown"],
        onlyMainContent: true,
        waitFor: 3000,
        location: {
          country: country === "by" ? "BY" : "RU",
          languages: ["ru"],
        },
      }),
    });

    if (!response.ok) {
      return { 
        content: null, 
        errorCode: String(response.status),
        errorDetails: { 
          type: "scrape_failed",
          status: response.status,
          statusText: response.statusText,
          url,
        }
      };
    }

    const data = await response.json();
    return { content: data.data?.markdown || "" };
  } catch (error) {
    return { 
      content: null,
      errorCode: "timeout",
      errorDetails: { 
        type: "scrape_exception",
        message: error instanceof Error ? error.message : String(error),
        url,
      }
    };
  }
}

// Extract title from markdown
function extractTitle(markdown: string): string {
  // Try to find H1 or first header
  const h1Match = markdown.match(/^#\s+(.+)$/m);
  if (h1Match) return h1Match[1].trim();

  // Try first bold text
  const boldMatch = markdown.match(/\*\*(.+?)\*\*/);
  if (boldMatch) return boldMatch[1].trim();

  // First line
  const firstLine = markdown.split("\n").find(line => line.trim().length > 20);
  return firstLine?.replace(/^[#*\d.]+\s*/, "").trim() || "";
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

    // Extract URL - prioritize non-image URLs
    let url = baseUrl;
    const urlMatches = section.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g);
    for (const match of urlMatches) {
      const extractedUrl = match[2];
      // Skip image URLs
      if (!extractedUrl.match(/\.(jpg|jpeg|png|gif|webp|svg)(\?|$)/i)) {
        url = extractedUrl;
        break;
      }
    }

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

  return items.slice(0, 10);
}

async function analyzeWithAI(
  item: ScrapedItem,
  lovableKey: string | undefined,
  styleProfile: Record<string, unknown> | null = null,
  audienceTopics: string[] = []
): Promise<AIAnalysis> {
  if (!lovableKey) {
    return {
      is_relevant: true,
      title: item.title,
      summary: item.content.slice(0, 500),
      effective_date: null,
      category: "digest",
      keywords: [],
    };
  }

  // Build adaptive style guidance
  let styleGuidance = '';
  if (styleProfile) {
    styleGuidance = `\n\nСТИЛЕВОЙ ПРОФИЛЬ КАНАЛА (пиши в этом стиле):
- Тон: ${styleProfile.tone || 'деловой'}
- Длина: ${styleProfile.avg_length || 'средний'}
- Характерные фразы: ${(styleProfile.characteristic_phrases as string[] || []).slice(0, 5).join(', ')}
- Форматирование: ${(styleProfile.formatting as any)?.html_tags_used?.join(', ') || '<b>, <i>'}`;
  }

  // Build audience context
  let audienceContext = '';
  if (audienceTopics.length > 0) {
    audienceContext = `\n\nАУДИТОРИЯ СЕЙЧАС ОБСУЖДАЕТ (если новость связана - акцентируй):
${audienceTopics.slice(0, 10).join(', ')}`;
  }

  try {
    // Softened AI prompt - more inclusive for business news with adaptive style
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

Критерии релевантности (is_relevant = true) - ШИРОКИЙ ФИЛЬТР:
- Изменения в налоговом законодательстве
- Новые требования для бизнеса
- Административные процедуры
- Социальное страхование (ФСЗН, пенсии, пособия)
- Валютное регулирование
- Трудовое право, зарплаты
- Госзакупки и тендеры
- Регистрация/ликвидация бизнеса
- Маркировка товаров
- Электронный документооборот
- ВЭД, импорт/экспорт
- Любые изменения, которые МОГУТ затронуть бизнес${styleGuidance}${audienceContext}

НЕ релевантно (is_relevant = false) - только явно нерелевантное:
- Спорт, развлечения, культура
- Криминальная хроника (не связанная с бизнесом)
- Погода, природные явления
- Персональные новости политиков

Категории:
- urgent: срочные изменения, вступающие в силу в ближайшие 30 дней
- digest: обычные новости для дайджеста
- comments: требует комментария эксперта

ВАЖНО: Если сомневаешься в релевантности - ставь is_relevant = true

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
