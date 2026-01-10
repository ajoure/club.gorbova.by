import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ParsedLesson {
  title: string;
  description?: string;
  content?: string;
  video_url?: string;
  content_type: "video" | "audio" | "article" | "document" | "mixed";
  duration_minutes?: number;
  attachments?: { file_name: string; file_url: string }[];
}

interface ParsedModule {
  title: string;
  description?: string;
  external_id: string;
  lessons: ParsedLesson[];
}

interface ParsedTraining {
  title: string;
  description?: string;
  external_id: string;
  modules: ParsedModule[];
}

function upsertCookies(cookieJar: Map<string, string>, setCookieValues: string[]) {
  for (const setCookie of setCookieValues) {
    const pair = setCookie.split(";")[0];
    const eqIndex = pair.indexOf("=");
    if (eqIndex === -1) continue;
    const name = pair.slice(0, eqIndex).trim();
    const value = pair.slice(eqIndex + 1).trim();
    if (name) cookieJar.set(name, value);
  }
}

function cookieHeaderFromJar(cookieJar: Map<string, string>) {
  return Array.from(cookieJar.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

function getSetCookieValues(res: Response): string[] {
  // Deno supports getSetCookie(); keep a fallback for environments that don't.
  const denoValues = (res.headers as any).getSetCookie?.();
  if (Array.isArray(denoValues)) return denoValues;

  const raw = res.headers.get("set-cookie");
  if (!raw) return [];

  // Best-effort split: commas that start a new cookie typically followed by "<name>=".
  return raw.split(/,(?=[^;=]+=)/g).map(s => s.trim()).filter(Boolean);
}

async function scrapeWithFirecrawl(opts: {
  url: string;
  apiKey: string;
  cookies: string;
  waitFor?: number;
}) {
  const res = await fetch("https://api.firecrawl.dev/v1/scrape", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      url: opts.url,
      formats: ["html", "markdown", "rawHtml"],
      onlyMainContent: false,
      waitFor: opts.waitFor ?? 4000,
      headers: { Cookie: opts.cookies },
    }),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json?.error || `Firecrawl request failed (${res.status})`;
    throw new Error(msg);
  }

  const data = json?.data ?? json;
  return {
    html: data?.html || data?.rawHtml || "",
    markdown: data?.markdown || "",
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { action, training_url } = await req.json();
    
    const email = Deno.env.get("GETCOURSE_EMAIL");
    const password = Deno.env.get("GETCOURSE_PASSWORD");
    const firecrawlApiKey = Deno.env.get("FIRECRAWL_API_KEY");

    if (!email || !password) {
      return new Response(
        JSON.stringify({ success: false, error: "GetCourse credentials not configured" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!firecrawlApiKey) {
      return new Response(
        JSON.stringify({ success: false, error: "Firecrawl API key not configured" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Determine base URL from training_url or use default
    const baseUrl = training_url 
      ? new URL(training_url).origin 
      : "https://gorbova.getcourse.ru";

    console.log("Base URL:", baseUrl);

    // Step 1: Login to GetCourse
    console.log("Logging into GetCourse...");

    const cookieJar = new Map<string, string>();

    const loginResponse = await fetch(`${baseUrl}/cms/system/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        email,
        password,
        action: "processXd498",
      }),
      redirect: "manual",
    });

    upsertCookies(cookieJar, getSetCookieValues(loginResponse));

    // Follow redirects (some instances set extra cookies on redirect)
    let redirectUrl = loginResponse.headers.get("location");
    for (let i = 0; i < 3 && redirectUrl; i++) {
      const resolved = redirectUrl.startsWith("http") ? redirectUrl : `${baseUrl}${redirectUrl}`;
      const follow = await fetch(resolved, {
        method: "GET",
        headers: { Cookie: cookieHeaderFromJar(cookieJar) },
        redirect: "manual",
      });
      upsertCookies(cookieJar, getSetCookieValues(follow));
      redirectUrl = follow.headers.get("location");
    }

    const cookies = cookieHeaderFromJar(cookieJar);

    if (!cookieJar.has("PHPSESSID")) {
      console.error("Login failed - no PHPSESSID cookie received");
      return new Response(
        JSON.stringify({ success: false, error: "Login failed - check credentials" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Login successful, got session cookies");

    if (action === "list_trainings") {
      // Step 2: Get list of trainings
      console.log("Fetching training list...");
      const trainingsPage = await fetch(`${baseUrl}/teach/control/stream`, {
        headers: { Cookie: cookies },
      });
      const trainingsHtml = await trainingsPage.text();

      // Parse trainings from HTML using Firecrawl for better extraction
      const scrapeResponse = await fetch("https://api.firecrawl.dev/v1/scrape", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${firecrawlApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          url: `${baseUrl}/teach/control/stream`,
          formats: ["html", "markdown"],
          headers: { Cookie: cookies },
        }),
      });

      const scrapeData = await scrapeResponse.json();
      
      // Extract training links from the page
      const trainings: { id: string; title: string; url: string }[] = [];
      const html = scrapeData.data?.html || trainingsHtml;
      
      // Parse training links (GetCourse structure)
      const trainingRegex = /href="\/teach\/control\/stream\/view\/id\/(\d+)[^"]*"[^>]*>\s*<[^>]+>\s*([^<]+)/gi;
      let match;
      while ((match = trainingRegex.exec(html)) !== null) {
        trainings.push({
          id: match[1],
          title: match[2].trim(),
          url: `${baseUrl}/teach/control/stream/view/id/${match[1]}`,
        });
      }

      // Alternative parsing if above didn't work
      if (trainings.length === 0) {
        const altRegex = /\/teach\/control\/stream\/view\/id\/(\d+)[^"]*"[^>]*title="([^"]+)"/gi;
        while ((match = altRegex.exec(html)) !== null) {
          trainings.push({
            id: match[1],
            title: match[2].trim(),
            url: `${baseUrl}/teach/control/stream/view/id/${match[1]}`,
          });
        }
      }

      console.log(`Found ${trainings.length} trainings`);

      return new Response(
        JSON.stringify({ success: true, trainings }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "parse_training" && training_url) {
      // Step 3: Parse a specific training
      console.log("Parsing training:", training_url);

      // Get training page with structure
      let html = "";
      let markdown = "";

      try {
        const scraped = await scrapeWithFirecrawl({
          url: training_url,
          apiKey: firecrawlApiKey,
          cookies,
          waitFor: 6000,
        });
        html = scraped.html;
        markdown = scraped.markdown;
      } catch (e) {
        console.error("Firecrawl scrape failed, falling back to direct fetch:", e);
      }

      // Fallback: direct fetch (non-JS) if Firecrawl didn't return HTML
      if (!html) {
        const directRes = await fetch(training_url, { headers: { Cookie: cookies } });
        html = await directRes.text();
      }

      // Detect if we got redirected to a login page / access denied
      if (/cms\/system\/login|name=["']email["']|Войти|Sign in/i.test(html)) {
        throw new Error("Не удалось получить доступ к тренингу (похоже, требуется доступ/логин). Проверьте, что аккаунт имеет доступ к этому тренингу.");
      }

      // Extract training title
      const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/i) || 
                         html.match(/class="training-title[^>]*>([^<]+)/i);
      const trainingTitle = titleMatch ? titleMatch[1].trim() : "Untitled Training";

      // Extract training ID
      const idMatch = training_url.match(/\/id\/(\d+)/);
      const trainingId = idMatch ? idMatch[1] : "unknown";

      // Parse modules and lessons
      const modules: ParsedModule[] = [];
      
      // GetCourse structure: modules are in sections, lessons are links
      const moduleRegex = /class="[^"]*module[^"]*"[^>]*>[\s\S]*?<[^>]+title[^>]*>([^<]+)[\s\S]*?(<div class="lessons[\s\S]*?<\/div>)/gi;
      const lessonRegex = /href="([^"]*lesson[^"]*\/id\/(\d+)[^"]*)"[^>]*>[\s\S]*?<[^>]+>([^<]+)/gi;
      
      // Simpler approach: extract all lesson links with their sections
      const sectionRegex = /<div[^>]*class="[^"]*(?:block|section|module)[^"]*"[^>]*>[\s\S]*?<h[23][^>]*>([^<]+)<\/h[23]>[\s\S]*?(<(?:div|ul)[^>]*class="[^"]*(?:lessons|items)[^"]*"[\s\S]*?<\/(?:div|ul)>)/gi;
      
      let sectionMatch;
      let moduleIndex = 0;
      
      while ((sectionMatch = sectionRegex.exec(html)) !== null) {
        const moduleTitle = sectionMatch[1].trim();
        const lessonsHtml = sectionMatch[2];
        const lessons: ParsedLesson[] = [];
        
        let lessonMatch;
        lessonRegex.lastIndex = 0;
        
        while ((lessonMatch = lessonRegex.exec(lessonsHtml)) !== null) {
          lessons.push({
            title: lessonMatch[3].trim(),
            content_type: "video", // Default, will be updated when parsing individual lessons
          });
        }
        
        if (lessons.length > 0 || moduleTitle) {
          modules.push({
            title: moduleTitle || `Модуль ${moduleIndex + 1}`,
            external_id: `module_${moduleIndex}`,
            lessons,
          });
          moduleIndex++;
        }
      }

      // If no modules found with structure, try to extract flat lesson list
      if (modules.length === 0) {
        const flatLessons: ParsedLesson[] = [];
        const flatLessonRegex = /href="([^"]*\/lesson[^"]*\/id\/(\d+)[^"]*)"[^>]*>(?:<[^>]+>)*([^<]+)/gi;
        
        let flatMatch;
        while ((flatMatch = flatLessonRegex.exec(html)) !== null) {
          flatLessons.push({
            title: flatMatch[3].trim(),
            content_type: "video",
          });
        }
        
        if (flatLessons.length > 0) {
          modules.push({
            title: trainingTitle,
            external_id: `module_0`,
            lessons: flatLessons,
          });
        }
      }

      const training: ParsedTraining = {
        title: trainingTitle,
        external_id: trainingId,
        modules,
      };

      console.log(`Parsed training: ${trainingTitle} with ${modules.length} modules`);

      return new Response(
        JSON.stringify({ success: true, training }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "parse_lesson") {
      const { lesson_url } = await req.json();
      
      if (!lesson_url) {
        return new Response(
          JSON.stringify({ success: false, error: "Lesson URL required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      console.log("Parsing lesson:", lesson_url);

      // Scrape lesson content
      const lessonResponse = await fetch("https://api.firecrawl.dev/v1/scrape", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${firecrawlApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          url: lesson_url,
          formats: ["html", "markdown"],
          headers: { Cookie: cookies },
          waitFor: 3000,
        }),
      });

      const lessonData = await lessonResponse.json();
      const html = lessonData.data?.html || "";
      const markdown = lessonData.data?.markdown || "";

      // Extract lesson title
      const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
      const title = titleMatch ? titleMatch[1].trim() : "Untitled Lesson";

      // Extract Kinescope video
      let video_url: string | undefined;
      const kinescopeMatch = html.match(/kinescope\.io\/(?:embed\/)?([a-zA-Z0-9]+)/i);
      if (kinescopeMatch) {
        video_url = `https://kinescope.io/embed/${kinescopeMatch[1]}`;
      }

      // Try YouTube
      if (!video_url) {
        const youtubeMatch = html.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]+)/i);
        if (youtubeMatch) {
          video_url = `https://www.youtube.com/embed/${youtubeMatch[1]}`;
        }
      }

      // Try Vimeo
      if (!video_url) {
        const vimeoMatch = html.match(/(?:player\.)?vimeo\.com\/(?:video\/)?(\d+)/i);
        if (vimeoMatch) {
          video_url = `https://player.vimeo.com/video/${vimeoMatch[1]}`;
        }
      }

      // Extract text content
      const contentMatch = html.match(/<div[^>]*class="[^"]*(?:lesson-content|content-text|text-block)[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
      const content = contentMatch ? contentMatch[1] : undefined;

      // Extract attachments
      const attachments: { file_name: string; file_url: string }[] = [];
      const attachmentRegex = /href="([^"]+)"[^>]*download[^>]*>([^<]+)|href="([^"]+\.(?:pdf|doc|docx|xls|xlsx|ppt|pptx|zip|rar))"[^>]*>([^<]+)/gi;
      let attachMatch;
      while ((attachMatch = attachmentRegex.exec(html)) !== null) {
        const url = attachMatch[1] || attachMatch[3];
        const name = (attachMatch[2] || attachMatch[4]).trim();
        if (url && name) {
          attachments.push({ file_name: name, file_url: url });
        }
      }

      // Determine content type
      let content_type: ParsedLesson["content_type"] = "article";
      if (video_url) {
        content_type = content ? "mixed" : "video";
      }

      const lesson: ParsedLesson = {
        title,
        content,
        video_url,
        content_type,
        attachments,
      };

      console.log(`Parsed lesson: ${title}, video: ${video_url ? "yes" : "no"}`);

      return new Response(
        JSON.stringify({ success: true, lesson }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ success: false, error: "Unknown action" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Error in getcourse-content-scraper:", error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error instanceof Error ? error.message : "Unknown error" 
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
