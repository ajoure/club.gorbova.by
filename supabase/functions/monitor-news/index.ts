// @ts-nocheck
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";

// Declare EdgeRuntime for background tasks
declare const EdgeRuntime: {
  waitUntil: (promise: Promise<unknown>) => void;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ============ P0.9.1: ScrapeConfig interface ============
interface ScrapeConfig {
  type?: string;
  rss_url?: string;
  fallback_url?: string;
  proxy_mode?: "auto" | "enhanced";
  country?: "BY" | "RU" | "AUTO";
  requires_auth?: boolean;
}

// Default config values
const DEFAULT_SCRAPE_CONFIG: ScrapeConfig = {
  proxy_mode: "auto",
  country: "AUTO",
};

interface NewsSource {
  id: string;
  name: string;
  url: string;
  country: string;
  category: string;
  priority: number;
  scrape_config: ScrapeConfig | null;
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

// ============ P0.9.3: Error classification ============
type ErrorClass = 
  | "URL_INVALID"       // 404, 410
  | "BAD_REQUEST"       // 400
  | "BLOCKED_OR_AUTH"   // 401, 403
  | "RATE_LIMIT"        // 429
  | "TIMEOUT_RENDER"    // timeout, network error
  | "SERVER_ERROR"      // 5xx
  | "PARSER_ERROR"      // parse/json/xml errors
  | "NO_API_KEY"        // missing Firecrawl key
  | "UNKNOWN";

function classifyError(statusCode: string | number | undefined, message?: string): ErrorClass {
  const code = String(statusCode || "");
  
  // P0.9.1-3: Handle RSS prefixed codes (recursive)
  if (code.startsWith("RSS_HTTP_")) {
    return classifyError(code.replace("RSS_HTTP_", ""), message);
  }
  if (code.startsWith("RSS_") && (code.includes("TIMEOUT") || code.includes("ERROR"))) {
    return "TIMEOUT_RENDER";
  }
  
  // Handle auth/session codes
  if (code === "auth_required" || code === "no_session") return "BLOCKED_OR_AUTH";
  if (code === "no_api_key") return "NO_API_KEY";
  
  // HTTP status codes
  if (code === "404" || code === "410") return "URL_INVALID";
  if (code === "400") return "BAD_REQUEST";
  if (code === "401" || code === "403") return "BLOCKED_OR_AUTH";
  if (code === "408") return "TIMEOUT_RENDER"; // Request Timeout
  if (code === "429") return "RATE_LIMIT";
  if (/^5\d{2}$/.test(code)) return "SERVER_ERROR";
  
  // Timeout/network patterns
  if (code === "timeout" || message?.toLowerCase().includes("timeout") || message?.toLowerCase().includes("network")) {
    return "TIMEOUT_RENDER";
  }
  
  // Parse errors
  if (message?.toLowerCase().includes("parse") || message?.toLowerCase().includes("json") || message?.toLowerCase().includes("xml")) {
    return "PARSER_ERROR";
  }
  
  return "UNKNOWN";
}

// Extended keywords for filtering relevant business news
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
  // Additional business terms
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

// Helper to get iLex session cookie for authenticated scraping
async function getIlexSession(): Promise<string | null> {
  const login = Deno.env.get('ILEX_LOGIN');
  const password = Deno.env.get('ILEX_PASSWORD');
  
  if (!login || !password) {
    console.log('[monitor-news] iLex credentials not configured');
    return null;
  }
  
  try {
    console.log('[monitor-news] Authenticating with iLex...');
    const response = await fetch('https://ilex-private.ilex.by/public/service-login', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      body: JSON.stringify({ login, password }),
    });
    
    if (!response.ok) {
      console.error('[monitor-news] iLex auth failed:', response.status);
      return null;
    }
    
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) {
      console.log('[monitor-news] iLex session obtained');
      return setCookie;
    }
    
    const body = await response.json().catch(() => null);
    if (body?.token) {
      return `Authorization: Bearer ${body.token}`;
    }
    
    return null;
  } catch (error) {
    console.error('[monitor-news] iLex auth error:', error);
    return null;
  }
}

Deno.serve(async (req) => {
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

    EdgeRuntime.waitUntil(
      runScraping(supabase, firecrawlKey, lovableKey, sourceId, limit, scrapeLogId)
    );

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

// ============================================================
// BY-egress config type
// ============================================================
interface ByEgressConfig {
  base_url: string;
  token: string;
  allowlist: string[];
  enabled: boolean;
}

// Load BY-egress config from integration_instances (service_role, one read per run)
async function loadByEgressConfig(supabase: SupabaseClient): Promise<ByEgressConfig | null> {
  try {
    const { data } = await supabase
      .from("integration_instances")
      .select("config")
      .eq("provider", "hosterby")
      .eq("category", "other")
      .maybeSingle();

    if (!data?.config) return null;
    const c = data.config as Record<string, unknown>;
    if (!c.egress_enabled || !c.egress_base_url || !c.egress_token) return null;

    const rawAllowlist = (c.egress_allowlist as string) || "";
    return {
      base_url: c.egress_base_url as string,
      token: c.egress_token as string,
      allowlist: rawAllowlist.split(",").map((d: string) => d.trim()).filter(Boolean),
      enabled: true,
    };
  } catch (e) {
    console.error("[monitor-news] Failed to load BY-egress config:", e);
    return null;
  }
}

// SSRF guard — inline (no shared module needed)
function isByEgressUrlSafe(url: string): boolean {
  try {
    const h = new URL(url).hostname.toLowerCase();
    if (h === "localhost" || h === "::1") return false;
    if (/^127\./.test(h)) return false;
    if (/^10\./.test(h)) return false;
    if (/^192\.168\./.test(h)) return false;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return false;
    if (/^169\.254\./.test(h)) return false;
    return true;
  } catch { return false; }
}

function isByEgressDomainAllowed(url: string, allowlist: string[]): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return allowlist.some(
      (d) => hostname === d.toLowerCase() || hostname.endsWith("." + d.toLowerCase())
    );
  } catch { return false; }
}

// Helper: detect RSS URLs to skip BY-egress for them
function isRssUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return lower.includes('/rss') || lower.includes('/feed') || lower.includes('.xml') || lower.includes('atom') || lower.includes('format=rss');
}

// Helper: convert raw HTML to basic markdown-like text for parseNewsFromMarkdown
function htmlToBasicMarkdown(html: string): string {
  let text = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');

  // Convert links to markdown
  text = text.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, linkText) => {
    const cleanText = linkText.replace(/<[^>]+>/g, '').trim();
    if (cleanText && href && !href.startsWith('#') && !href.startsWith('javascript:')) {
      return `[${cleanText}](${href})`;
    }
    return cleanText;
  });

  // Convert headers
  text = text.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '\n# $1\n');
  text = text.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '\n## $1\n');
  text = text.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '\n### $1\n');
  text = text.replace(/<h[4-6][^>]*>([\s\S]*?)<\/h[4-6]>/gi, '\n### $1\n');

  // Convert structure
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/p>/gi, '\n\n');
  text = text.replace(/<\/div>/gi, '\n');
  text = text.replace(/<li[^>]*>/gi, '* ');
  text = text.replace(/<\/li>/gi, '\n');

  // Strip remaining tags
  text = text.replace(/<[^>]+>/g, '');

  // Decode entities
  text = text
    .replace(/&nbsp;/g, ' ')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&laquo;/g, '«')
    .replace(/&raquo;/g, '»')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code)))
    .replace(/\n\s*\n\s*\n/g, '\n\n')
    .trim();

  return text;
}

// BY-egress fetch: GET /fetch + X-Target-URL header + Authorization: Bearer
// VPS protocol: proxy always returns HTTP 200, real target status in X-Target-Status, final URL in X-Final-URL
async function fetchViaByEgress(
  targetUrl: string,
  egressConfig: ByEgressConfig
): Promise<{ content: string | null; httpStatus?: number; error?: string; finalUrl?: string }> {
  if (!isByEgressUrlSafe(egressConfig.base_url)) {
    return { content: null, error: "SSRF_BLOCKED" };
  }
  if (!isByEgressDomainAllowed(targetUrl, egressConfig.allowlist)) {
    return { content: null, error: "NOT_IN_ALLOWLIST" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);

  const domain = (() => { try { return new URL(targetUrl).hostname; } catch { return targetUrl; } })();

  try {
    const resp = await fetch(`${egressConfig.base_url}/fetch`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${egressConfig.token}`,
        "X-Target-URL": targetUrl,
      },
      signal: controller.signal,
    });

    // proxy error (token wrong / proxy down)
    if (resp.status !== 200) {
      const body = await resp.text().catch(() => "");
      if (resp.status === 401) {
        console.error(`[monitor-news] CRITICAL: BY-egress proxy 401 for ${domain} — check egress token!`);
      }
      console.log(`[monitor-news] fetch_via=by_egress domain=${domain} proxy_status=${resp.status} error=proxy_error body_len=${body.length}`);
      clearTimeout(timer);
      return { content: null, httpStatus: resp.status, error: `proxy_${resp.status}` };
    }

    // real target status from headers
    const targetStatusRaw = resp.headers.get("x-target-status") || "200";
    const targetStatus = Number.parseInt(targetStatusRaw, 10);
    const finalUrl = resp.headers.get("x-final-url") || targetUrl;

    const body = await resp.text();
    console.log(`[monitor-news] fetch_via=by_egress domain=${domain} proxy_status=200 target_status=${targetStatus} final_url=${finalUrl} content_length=${body.length}`);

    clearTimeout(timer);

    if (!Number.isFinite(targetStatus)) {
      return { content: null, error: "BAD_TARGET_STATUS_HEADER" };
    }

    if (targetStatus >= 400) {
      return { content: null, httpStatus: targetStatus, error: `target_${targetStatus}`, finalUrl };
    }

    return { content: body, httpStatus: targetStatus, finalUrl };
  } catch (e) {
    clearTimeout(timer);
    const isAbort = e instanceof Error && e.name === "AbortError";
    const errCode = isAbort ? "TIMEOUT" : (e instanceof Error ? e.message : String(e));
    console.log(`[monitor-news] fetch_via=by_egress_failed domain=${domain} error=${errCode}`);
    return { content: null, error: errCode };
  }
}

// Main scraping function
async function runScraping(
  supabase: SupabaseClient,
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

  // BY-egress: load config ONCE per run (service_role, cached)
  const byEgressConfig = await loadByEgressConfig(supabase);
  if (byEgressConfig) {
    console.log(`[monitor-news] BY-egress active. Allowlist: ${byEgressConfig.allowlist.join(",")}`);
  }

  try {
    // Fetch audience interests from last 48 hours
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

    // Get iLex session for authenticated sources
    const ilexSession = await getIlexSession();

    // P0.9.1-6: Get active sources with rotation (oldest first, NULL first)
    // SOURCES_PER_RUN can be configured, default 25, hard cap 50
    const sourcesPerRun = Math.min(Math.max(limit, 25), 50);
    
    let query = supabase
      .from("news_sources")
      .select("*")
      .eq("is_active", true);

    if (sourceId) {
      query = query.eq("id", sourceId);
    } else {
      // P0.9.1-6: Order by oldest last_scraped_at (NULL = never scraped = highest priority)
      query = query
        .order("last_scraped_at", { ascending: true, nullsFirst: true })
        .limit(sourcesPerRun);
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
      let lastErrorCode: string | null = null;
      let lastErrorDetails: Record<string, unknown> | null = null;
      const sourceStartTime = Date.now();

      try {
        // P0.9.4: New fallback chain scraping
        const { items: scrapedItems, errorCode, errorDetails, stage } = await scrapeSourceWithFallback(
          source,
          firecrawlKey,
          ilexSession,
          supabase,
          byEgressConfig
        );
        
        console.log(`[monitor-news] ${source.name}: scraped ${scrapedItems.length} items via ${stage || 'unknown'}`);

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

            // Quick relevance check
            const contentLower = (item.title + " " + item.content).toLowerCase();
            const isQuickRelevant = RELEVANCE_KEYWORDS.some((kw) =>
              contentLower.includes(kw)
            );

            if (!isQuickRelevant) {
              console.log(`[monitor-news] Skipping irrelevant: ${item.title.slice(0, 50)}`);
              continue;
            }

            // AI analysis with style profile
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
          stats.sources_failed++;
        } else {
          stats.sources_success++;
        }
      } catch (sourceError) {
        stats.sources_failed++;
        const errMsg = sourceError instanceof Error ? sourceError.message : String(sourceError);
        sourceResult.errors.push(`Source error: ${errMsg}`);
        
        const errorCodeMatch = errMsg.match(/(\d{3})/);
        lastErrorCode = errorCodeMatch ? errorCodeMatch[1] : "unknown";
        lastErrorDetails = { message: errMsg.slice(0, 200), timestamp: new Date().toISOString() };
        
        stats.errors.push({
          source: source.name,
          error: errMsg,
          code: lastErrorCode,
        });
        
        // P0.9.3: Log scrape attempt with error classification
        await logScrapeAttempt(supabase, source, "exception", source.url, "auto", lastErrorCode, errMsg, Date.now() - sourceStartTime, 0);
        
        await supabase
          .from("news_sources")
          .update({ 
            last_error: errMsg.slice(0, 500),
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

// ============ P0.9.3: Audit log helper ============
async function logScrapeAttempt(
  supabase: SupabaseClient,
  source: NewsSource,
  stage: string,
  urlUsed: string,
  proxyMode: string,
  statusCode: string | null,
  errorMessage: string | null,
  elapsedMs: number,
  itemsFound: number
) {
  try {
    await supabase.from("audit_logs").insert({
      action: "news_scrape_attempt",
      actor_type: "system",
      actor_user_id: null,
      meta: {
        source_id: source.id,
        source_name: source.name,
        stage,
        url_used: urlUsed,
        proxy_mode: proxyMode,
        status_code: statusCode,
        error_class: statusCode ? classifyError(statusCode, errorMessage || undefined) : null,
        elapsed_ms: elapsedMs,
        items_found: itemsFound,
      },
    });
  } catch (err) {
    console.error("[monitor-news] Failed to log audit:", err);
  }
}

// ============ P0.9.2: RSS Parser ============
async function parseRssFeed(url: string): Promise<{ items: ScrapedItem[]; error?: string }> {
  const RSS_TIMEOUT = 15000;
  const RSS_MAX_ITEMS = 30;
  const CONTENT_MAX_LENGTH = 5000;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), RSS_TIMEOUT);
    
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept": "application/rss+xml, application/xml, text/xml, */*",
      },
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);

    if (!response.ok) {
      return { items: [], error: `RSS_HTTP_${response.status}` };
    }

    const xml = await response.text();
    const items: ScrapedItem[] = [];

    // Parse RSS XML without heavy dependencies
    // P0.9.1-1: Improved regex with \b to match <item> with attributes
    const itemMatches = xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi);
    
    let count = 0;
    for (const match of itemMatches) {
      if (count >= RSS_MAX_ITEMS) break;
      
      const itemXml = match[1];
      
      // Extract fields with CDATA support
      const title = extractXmlField(itemXml, "title");
      const link = extractXmlField(itemXml, "link");
      const description = extractXmlField(itemXml, "description");
      const content = extractXmlField(itemXml, "content:encoded") || extractXmlField(itemXml, "content");
      const pubDate = extractXmlField(itemXml, "pubDate") || extractXmlField(itemXml, "dc:date");

      if (title && link) {
        items.push({
          title: decodeHtmlEntities(title).slice(0, 300),
          url: link,
          content: decodeHtmlEntities(content || description || "").slice(0, CONTENT_MAX_LENGTH),
          date: pubDate ? normalizeDate(pubDate) : undefined,
        });
        count++;
      }
    }

    console.log(`[monitor-news] RSS parsed: ${items.length} items from ${url}`);
    return { items };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    if (errMsg.includes("abort")) {
      return { items: [], error: "RSS_TIMEOUT" };
    }
    return { items: [], error: `RSS_ERROR: ${errMsg.slice(0, 100)}` };
  }
}

// P0.9.1-1: Improved extractXmlField with proper CDATA handling
function extractXmlField(xml: string, fieldName: string): string | null {
  // Escape special regex characters in field name (e.g., content:encoded)
  const escapedName = fieldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  
  // Match opening tag with optional attributes, then CDATA or plain content, then closing tag
  const regex = new RegExp(
    `<${escapedName}(?:\\s[^>]*)?>` +           // Opening tag with optional attributes
    `(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|` +    // CDATA content (group 1) OR
    `([\\s\\S]*?))` +                            // Plain content (group 2)
    `</${escapedName}>`,
    'i'
  );
  
  const match = xml.match(regex);
  if (!match) return null;
  
  // Return CDATA content (group 1) or plain content (group 2)
  const content = match[1] ?? match[2];
  return content?.trim() ?? null;
}

// P0.9.1-1: Improved decodeHtmlEntities with full entity support
function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/<[^>]+>/g, "")   // Remove HTML tags
    .replace(/\s+/g, " ")       // Normalize whitespace
    .trim();
}

function normalizeDate(dateStr: string): string | undefined {
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return undefined;
    return date.toISOString();
  } catch {
    return undefined;
  }
}

// ============ P0.9.4: Unified fallback chain ============
async function scrapeSourceWithFallback(
  source: NewsSource,
  firecrawlKey: string | undefined,
  ilexSession: string | null,
  supabase: SupabaseClient,
  byEgressConfig: ByEgressConfig | null = null
): Promise<{ items: ScrapedItem[]; errorCode?: string; errorDetails?: Record<string, unknown>; stage?: string }> {
  const config: ScrapeConfig = { ...DEFAULT_SCRAPE_CONFIG, ...(source.scrape_config || {}) };
  const startTime = Date.now();
  let lastError: { code?: string; details?: Record<string, unknown> } = {};
  
  // STOP-guards
  const MAX_RUNTIME_MS = 90000; // 90 seconds per source
  const MAX_ITEMS = 30;
  
  const checkTimeout = () => Date.now() - startTime > MAX_RUNTIME_MS;

  // Check if this is iLex source that requires authentication
  const isIlexSource = source.url.includes('ilex-private.ilex.by');
  if (isIlexSource || config.requires_auth) {
    if (!ilexSession) {
      console.log(`[monitor-news] ${source.name} requires auth but no session available`);
      await logScrapeAttempt(supabase, source, "auth_check", source.url, "none", "auth_required", "No iLex session", Date.now() - startTime, 0);
      return { 
        items: [], 
        errorCode: 'auth_required',
        errorDetails: { message: 'Source requires authentication but no session available' },
        stage: 'auth_check',
      };
    }
    console.log(`[monitor-news] Using authenticated session for ${source.name}`);
  }

  // ===== STAGE 1: RSS (if configured) =====
  if (config.rss_url) {
    console.log(`[monitor-news] ${source.name}: STAGE 1 - trying RSS...`);
    const rssResult = await parseRssFeed(config.rss_url);
    
    await logScrapeAttempt(
      supabase, source, "rss", config.rss_url, "rss",
      rssResult.error || null, rssResult.error || null,
      Date.now() - startTime, rssResult.items.length
    );
    
    if (rssResult.items.length > 0) {
      console.log(`[monitor-news] ${source.name}: RSS SUCCESS, ${rssResult.items.length} items`);
      return { items: rssResult.items.slice(0, MAX_ITEMS), stage: "rss" };
    }
    
    if (rssResult.error) {
      lastError = { code: rssResult.error, details: { stage: "rss", url: config.rss_url } };
    }
  }

  if (checkTimeout()) {
    return { items: [], errorCode: "timeout", errorDetails: { stage: "rss", elapsed_ms: Date.now() - startTime }, stage: "timeout" };
  }

  // ===== STAGE 1.5: BY-egress (VPS proxy for allowlisted domains) =====
  if (byEgressConfig?.enabled && !isRssUrl(source.url) && isByEgressDomainAllowed(source.url, byEgressConfig.allowlist)) {
    const egressDomain = (() => { try { return new URL(source.url).hostname; } catch { return source.url; } })();
    console.log(`[monitor-news] ${source.name}: STAGE 1.5 - trying BY-egress for ${egressDomain}...`);
    
    const egressResult = await fetchViaByEgress(source.url, byEgressConfig);
    
    const egressStatusCode = egressResult.httpStatus ? String(egressResult.httpStatus) : (egressResult.error || null);
    
    // Log 401 as CRITICAL (wrong token)
    if (egressResult.httpStatus === 401) {
      console.error(`[monitor-news] CRITICAL: BY-egress 401 for ${egressDomain} — check egress token!`);
    }
    
    await logScrapeAttempt(
      supabase, source, "by_egress", source.url, "by_egress",
      egressStatusCode, egressResult.error || null,
      Date.now() - startTime, 0
    );

    if (egressResult.content) {
      // BY-egress returns raw HTML — convert to markdown for parseNewsFromMarkdown
      const markdownContent = htmlToBasicMarkdown(egressResult.content);
      // IMPORTANT: use finalUrl as baseUrl (after redirects resolved by VPS)
      const baseUrl = egressResult.finalUrl || source.url;
      const items = parseNewsFromMarkdown(markdownContent, baseUrl);
      
      console.log(`[monitor-news] stage=by_egress domain=${egressDomain} target_status=${egressResult.httpStatus || 'ok'} final_url=${egressResult.finalUrl || source.url} bytes=${egressResult.content.length} items=${items.length}`);
      
      if (items.length > 0) {
        console.log(`[monitor-news] ${source.name}: BY-egress SUCCESS, ${items.length} items`);
        return { items: items.slice(0, MAX_ITEMS), stage: "by_egress" };
      }
    }

    if (egressResult.error || egressResult.httpStatus) {
      lastError = { 
        code: egressStatusCode || "by_egress_fail", 
        details: { stage: "by_egress", domain: egressDomain, error: egressResult.error } 
      };
    }
    
    console.log(`[monitor-news] ${source.name}: BY-egress no items, falling back to Firecrawl`);
  }

  if (checkTimeout()) {
    return { items: [], errorCode: "timeout", errorDetails: { stage: "by_egress", elapsed_ms: Date.now() - startTime }, stage: "timeout" };
  }

  // ===== STAGE 2: HTML scrape (proxy: auto) =====
  if (!firecrawlKey) {
    console.log(`[monitor-news] ${source.name}: No Firecrawl key, stopping`);
    await logScrapeAttempt(supabase, source, "no_api_key", source.url, "none", "no_api_key", "Firecrawl API key not configured", Date.now() - startTime, 0);
    return { 
      items: [], 
      errorCode: "no_api_key", 
      errorDetails: { message: "Firecrawl API key not configured" },
      stage: "no_api_key",
    };
  }

  const effectiveCountry = config.country === "AUTO" ? (source.country || "RU") : config.country;
  const initialProxyMode = config.proxy_mode || "auto";
  
  console.log(`[monitor-news] ${source.name}: STAGE 2 - HTML scrape (proxy: ${initialProxyMode})...`);
  // P0.9.1-2: Pass ilexSession to scrapeUrlWithProxy
  const htmlResult1 = await scrapeUrlWithProxy(source.url, firecrawlKey as string, effectiveCountry, initialProxyMode, ilexSession);
  
  await logScrapeAttempt(
    supabase, source, `html_${initialProxyMode}`, source.url, initialProxyMode,
    htmlResult1.errorCode || null, htmlResult1.errorCode || null,
    Date.now() - startTime, 0
  );

  if (htmlResult1.content) {
    const items = parseNewsFromMarkdown(htmlResult1.content, source.url);
    if (items.length > 0) {
      console.log(`[monitor-news] ${source.name}: HTML ${initialProxyMode} SUCCESS, ${items.length} items`);
      return { items: items.slice(0, MAX_ITEMS), stage: `html_${initialProxyMode}` };
    }
  }

  if (htmlResult1.errorCode) {
    lastError = { code: htmlResult1.errorCode, details: htmlResult1.errorDetails };
  }

  if (checkTimeout()) {
    return { items: [], errorCode: "timeout", errorDetails: { stage: `html_${initialProxyMode}`, elapsed_ms: Date.now() - startTime }, stage: "timeout" };
  }

  // ===== STAGE 3: HTML enhanced (if auto failed with retryable error) =====
  if (initialProxyMode !== "enhanced" && shouldRetryWithEnhanced(htmlResult1.errorCode)) {
    console.log(`[monitor-news] ${source.name}: STAGE 3 - retrying with enhanced proxy...`);
    // P0.9.1-2: Pass ilexSession to retry
    const htmlResult2 = await scrapeUrlWithProxy(source.url, firecrawlKey as string, effectiveCountry, "enhanced", ilexSession);
    
    await logScrapeAttempt(
      supabase, source, "html_enhanced", source.url, "enhanced",
      htmlResult2.errorCode || null, htmlResult2.errorCode || null,
      Date.now() - startTime, 0
    );

    if (htmlResult2.content) {
      const items = parseNewsFromMarkdown(htmlResult2.content, source.url);
      if (items.length > 0) {
        console.log(`[monitor-news] ${source.name}: HTML enhanced SUCCESS, ${items.length} items`);
        return { items: items.slice(0, MAX_ITEMS), stage: "html_enhanced" };
      }
    }

    if (htmlResult2.errorCode) {
      lastError = { code: htmlResult2.errorCode, details: htmlResult2.errorDetails };
    }
  }

  if (checkTimeout()) {
    return { items: [], errorCode: "timeout", errorDetails: { stage: "html_enhanced", elapsed_ms: Date.now() - startTime }, stage: "timeout" };
  }

  // ===== STAGE 4: Fallback URL (if configured) =====
  if (config.fallback_url) {
    console.log(`[monitor-news] ${source.name}: STAGE 4 - trying fallback URL...`);
    
    // Try fallback with enhanced proxy directly
    // P0.9.1-2: Pass ilexSession to fallback
    const fallbackResult = await scrapeUrlWithProxy(config.fallback_url, firecrawlKey as string, effectiveCountry, "enhanced", ilexSession);
    
    await logScrapeAttempt(
      supabase, source, "fallback", config.fallback_url, "enhanced",
      fallbackResult.errorCode || null, fallbackResult.errorCode || null,
      Date.now() - startTime, 0
    );

    if (fallbackResult.content) {
      const items = parseNewsFromMarkdown(fallbackResult.content, source.url);
      if (items.length > 0) {
        console.log(`[monitor-news] ${source.name}: Fallback URL SUCCESS, ${items.length} items`);
        return { items: items.slice(0, MAX_ITEMS), stage: "fallback" };
      }
    }

    if (fallbackResult.errorCode) {
      lastError = { code: fallbackResult.errorCode, details: fallbackResult.errorDetails };
    }
  }

  console.log(`[monitor-news] ${source.name}: all stages failed, last error: ${lastError.code}`);
  return { items: [], errorCode: lastError.code, errorDetails: lastError.details, stage: "failed" };
}

// P0.9.1-4: Fixed shouldRetryWithEnhanced with actual HTTP codes
function shouldRetryWithEnhanced(errorCode: string | undefined): boolean {
  if (!errorCode) return false;
  // Only real HTTP codes that scrapeUrlWithProxy returns
  return ["400", "401", "403", "408", "429", "timeout", "500", "502", "503", "504"].includes(errorCode);
}

// P0.9.1-2: Helper to extract just the cookie NAME=VALUE from set-cookie header
function extractCookieValue(setCookie: string): string {
  // set-cookie: JSESSIONID=abc123; Path=/; HttpOnly → JSESSIONID=abc123
  const match = setCookie.match(/^([^;]+)/);
  return match ? match[1] : setCookie;
}

// P0.9.1-2: Helper to scrape a single URL with Firecrawl (with sessionCookie support)
async function scrapeUrlWithProxy(
  url: string,
  firecrawlKey: string,
  country: string,
  proxyMode: "auto" | "enhanced",
  sessionCookie?: string | null  // P0.9.1-2: Added sessionCookie param
): Promise<{ content: string | null; errorCode?: string; errorDetails?: Record<string, unknown> }> {
  try {
    const requestBody: Record<string, unknown> = {
      url,
      formats: ["markdown"],
      onlyMainContent: true,
      waitFor: proxyMode === "enhanced" ? 5000 : 3000,
      timeout: 30000,
      location: {
        country: country.toUpperCase() === "BY" ? "BY" : "RU",
        languages: ["ru"],
      },
    };

    // Build headers object
    const headers: Record<string, string> = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      "Accept-Language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7",
    };

    // P0.9.1-2: Add session cookie if provided (for authenticated sources like iLex)
    if (sessionCookie) {
      headers["Cookie"] = extractCookieValue(sessionCookie);
    }

    // P0.9.4: Use stealth headers for enhanced mode (NOT premium which causes 400)
    if (proxyMode === "enhanced") {
      headers["Cache-Control"] = "no-cache";
      requestBody.mobile = false;
    }

    requestBody.headers = headers;

    const response = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${firecrawlKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      return {
        content: null,
        errorCode: String(response.status),
        errorDetails: {
          status: response.status,
          statusText: response.statusText,
          body: errorBody.slice(0, 200), // STOP-guard: truncate error body
          url,
          proxyMode,
        },
      };
    }

    const data = await response.json();
    return { content: data.data?.markdown || "" };
  } catch (error) {
    return {
      content: null,
      errorCode: "timeout",
      errorDetails: {
        message: (error instanceof Error ? error.message : String(error)).slice(0, 200),
        url,
        proxyMode,
      },
    };
  }
}

function parseNewsFromMarkdown(markdown: string, baseUrl: string): ScrapedItem[] {
  const items: ScrapedItem[] = [];

  // Split by headers or list items
  const sections = markdown.split(/\n(?=#{1,3}\s|\*\s|\d+\.\s)/);

  for (const section of sections) {
    if (section.trim().length < 50) continue;

    const lines = section.trim().split("\n");
    const titleLine = lines[0].replace(/^[#*\d.]+\s*/, "").trim();

    if (titleLine.length < 10) continue;

    // Extract URL - prioritize non-image URLs
    let url = baseUrl;
    const urlMatches = section.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g);
    for (const match of urlMatches) {
      const extractedUrl = match[2];
      if (!extractedUrl.match(/\.(jpg|jpeg|png|gif|webp|svg)(\?|$)/i)) {
        url = extractedUrl;
        break;
      }
    }

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
- Форматирование: ${(styleProfile.formatting as Record<string, unknown>)?.html_tags_used || '<b>, <i>'}`;
  }

  // Build audience context
  let audienceContext = '';
  if (audienceTopics.length > 0) {
    audienceContext = `\n\nАУДИТОРИЯ СЕЙЧАС ОБСУЖДАЕТ (если новость связана - акцентируй):
${audienceTopics.slice(0, 10).join(', ')}`;
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
