import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { url } = await req.json();
    
    if (!url) {
      return new Response(
        JSON.stringify({ success: false, error: 'URL is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[ilex-fetch] Fetching URL:', url);

    // iLex requires JavaScript rendering, so we use Firecrawl
    const firecrawlApiKey = Deno.env.get('FIRECRAWL_API_KEY');
    
    if (!firecrawlApiKey) {
      // Fallback: try direct fetch without auth (some pages might be public)
      console.log('[ilex-fetch] No Firecrawl API key, trying direct fetch...');
      
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
        },
      });
      
      if (!response.ok) {
        return new Response(
          JSON.stringify({ 
            success: false, 
            error: `Direct fetch failed: ${response.status}. Configure FIRECRAWL_API_KEY for full access.` 
          }),
          { status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      const html = await response.text();
      const text = extractTextFromHtml(html);
      const links = extractLinksFromHtml(html, url);
      const title = extractTitleFromHtml(html);
      
      return new Response(
        JSON.stringify({ 
          success: true, 
          title,
          text,
          links: links.slice(0, 100),
          htmlLength: html.length,
          textLength: text.length,
          method: 'direct'
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Use Firecrawl to scrape with JavaScript rendering
    console.log('[ilex-fetch] Using Firecrawl to scrape with JS rendering...');
    
    const firecrawlResponse = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${firecrawlApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url,
        formats: ['markdown', 'html', 'links'],
        onlyMainContent: false, // Get full page for legal docs
        waitFor: 3000, // Wait for JS to render
        location: {
          country: 'BY',
          languages: ['ru', 'be'],
        },
      }),
    });

    const firecrawlData = await firecrawlResponse.json();
    
    if (!firecrawlResponse.ok) {
      console.error('[ilex-fetch] Firecrawl error:', firecrawlData);
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: firecrawlData.error || `Firecrawl error: ${firecrawlResponse.status}` 
        }),
        { status: firecrawlResponse.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Handle nested data structure
    const data = firecrawlData.data || firecrawlData;
    
    console.log('[ilex-fetch] Firecrawl success, markdown length:', data.markdown?.length || 0);
    
    return new Response(
      JSON.stringify({ 
        success: true, 
        title: data.metadata?.title || '',
        text: data.markdown || '',
        html: data.html || '',
        links: (data.links || []).slice(0, 100),
        metadata: data.metadata || {},
        method: 'firecrawl'
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[ilex-fetch] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

function extractTextFromHtml(html: string): string {
  let text = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  
  text = text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<\/td>/gi, ' | ')
    .replace(/<\/th>/gi, ' | ')
    .replace(/<h[1-6][^>]*>/gi, '\n\n### ')
    .replace(/<\/h[1-6]>/gi, '\n')
    .replace(/<[^>]+>/g, '')
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

function extractTitleFromHtml(html: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? match[1].trim() : '';
}

function extractLinksFromHtml(html: string, baseUrl: string): Array<{ url: string; text: string }> {
  const links: Array<{ url: string; text: string }> = [];
  const linkMatches = html.matchAll(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi);
  
  const urlBase = new URL(baseUrl).origin;
  
  for (const match of linkMatches) {
    const href = match[1];
    const linkText = match[2].replace(/<[^>]+>/g, '').trim();
    if (href && linkText && !href.startsWith('#') && !href.startsWith('javascript:')) {
      links.push({ 
        url: href.startsWith('http') ? href : `${urlBase}${href.startsWith('/') ? '' : '/'}${href}`,
        text: linkText 
      });
    }
  }
  
  return links;
}
