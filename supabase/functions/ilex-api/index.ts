import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// iLex base URL
const ILEX_BASE_URL = 'https://ilex-private.ilex.by';

// User agents for human-like behavior
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
];

// Document types for advanced search
const DOCUMENT_TYPES = {
  all: '',
  law: 'закон',
  decree: 'указ',
  resolution: 'постановление',
  decision: 'решение',
  order: 'приказ',
  instruction: 'инструкция',
  regulation: 'положение',
};

// Session cache (in-memory for edge function instance)
let sessionCache: { 
  cookie: string; 
  expiresAt: number;
  authenticated: boolean;
} | null = null;

// Random delay to simulate human behavior
async function humanDelay(min = 500, max = 1500): Promise<void> {
  const delay = min + Math.random() * (max - min);
  await new Promise(r => setTimeout(r, delay));
}

// Get random user agent
function getRandomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

// Get common headers for requests
function getHeaders(sessionCookie?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'User-Agent': getRandomUserAgent(),
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
  };
  
  if (sessionCookie) {
    headers['Cookie'] = sessionCookie;
  }
  
  return headers;
}

// Authenticate and get session cookie using ASP.NET MVC flow
async function authenticate(login: string, password: string): Promise<{ 
  success: boolean; 
  sessionCookie?: string; 
  error?: string;
}> {
  try {
    console.log('Attempting iLex ASP.NET authentication...');
    
    // Step 1: GET login page to get cookies and CSRF token
    const loginPageUrl = `${ILEX_BASE_URL}/Account/Login`;
    console.log('Fetching login page:', loginPageUrl);
    
    const loginPageResponse = await fetch(loginPageUrl, {
      method: 'GET',
      headers: getHeaders(),
      redirect: 'manual',
    });
    
    console.log('Login page status:', loginPageResponse.status);
    
    // Collect initial cookies
    let cookies: string[] = [];
    const setCookieHeaders = loginPageResponse.headers.getSetCookie?.() || [];
    if (setCookieHeaders.length > 0) {
      cookies = setCookieHeaders.map(c => c.split(';')[0]);
      console.log('Initial cookies:', cookies.map(c => c.split('=')[0]).join(', '));
    }
    
    const html = await loginPageResponse.text();
    
    // Step 2: Extract __RequestVerificationToken from HTML
    const tokenPatterns = [
      /<input[^>]*name="__RequestVerificationToken"[^>]*value="([^"]+)"/i,
      /name="__RequestVerificationToken"\s+type="hidden"\s+value="([^"]+)"/i,
      /value="([^"]+)"[^>]*name="__RequestVerificationToken"/i,
      /__RequestVerificationToken[^>]*value="([^"]+)"/i,
    ];
    
    let verificationToken: string | null = null;
    for (const pattern of tokenPatterns) {
      const match = html.match(pattern);
      if (match) {
        verificationToken = match[1];
        break;
      }
    }
    
    if (!verificationToken) {
      console.log('Could not find __RequestVerificationToken in login page');
      console.log('Login page HTML length:', html.length);
      console.log('Contains form:', html.includes('<form'));
      console.log('Contains RequestVerification:', html.includes('RequestVerification'));
      
      // Maybe already authenticated?
      if (html.includes('logout') || html.includes('Выйти') || html.includes('/Account/LogOff')) {
        console.log('Appears already authenticated');
        return { 
          success: true, 
          sessionCookie: cookies.join('; '),
        };
      }
      
      return { success: false, error: 'CSRF токен не найден на странице входа' };
    }
    
    console.log('Found verification token:', verificationToken.substring(0, 30) + '...');
    
    await humanDelay();
    
    // Step 3: POST login form with token
    const formData = new URLSearchParams({
      __RequestVerificationToken: verificationToken,
      UserName: login,
      Password: password,
      RememberMe: 'true',
    });
    
    console.log('Submitting login form...');
    
    const loginResponse = await fetch(loginPageUrl, {
      method: 'POST',
      headers: {
        ...getHeaders(cookies.join('; ')),
        'Content-Type': 'application/x-www-form-urlencoded',
        'Referer': loginPageUrl,
        'Origin': ILEX_BASE_URL,
        'Cache-Control': 'no-cache',
      },
      body: formData.toString(),
      redirect: 'manual',
    });
    
    console.log('Login POST status:', loginResponse.status);
    console.log('Login POST headers:', Object.fromEntries(loginResponse.headers.entries()));
    
    // Collect new cookies (including auth cookie)
    const newCookies = loginResponse.headers.getSetCookie?.() || [];
    if (newCookies.length > 0) {
      const cookieValues = newCookies.map(c => c.split(';')[0]);
      cookies.push(...cookieValues);
      console.log('New cookies after login:', cookieValues.map(c => c.split('=')[0]).join(', '));
    }
    const finalCookies = cookies.join('; ');
    
    // Step 4: Check for successful auth
    const hasAuthCookie = finalCookies.includes('.ASPXAUTH') || 
                          finalCookies.includes('.AspNet.ApplicationCookie') ||
                          finalCookies.includes('ARRAffinity') ||
                          finalCookies.includes('auth');
    
    const location = loginResponse.headers.get('location');
    const isRedirectToHome = loginResponse.status >= 300 && 
                             loginResponse.status < 400 &&
                             location && !location.toLowerCase().includes('login');
    
    console.log('Has auth cookie:', hasAuthCookie);
    console.log('Redirect location:', location);
    console.log('Is redirect to home:', isRedirectToHome);
    
    if (hasAuthCookie || isRedirectToHome) {
      console.log('Authentication successful');
      
      // Follow redirect to confirm auth
      if (isRedirectToHome && location) {
        let redirectUrl = location;
        if (redirectUrl.startsWith('/')) {
          redirectUrl = ILEX_BASE_URL + redirectUrl;
        }
        
        await humanDelay(300, 600);
        
        const confirmResponse = await fetch(redirectUrl, {
          method: 'GET',
          headers: getHeaders(finalCookies),
          redirect: 'follow',
        });
        
        // Collect any additional cookies
        const confirmCookies = confirmResponse.headers.getSetCookie?.() || [];
        if (confirmCookies.length > 0) {
          cookies.push(...confirmCookies.map(c => c.split(';')[0]));
        }
        
        const confirmHtml = await confirmResponse.text();
        if (confirmHtml.includes('login') && confirmHtml.includes('пароль')) {
          console.log('Redirect led back to login - auth failed');
          return { success: false, error: 'Неверные учетные данные' };
        }
      }
      
      return { 
        success: true, 
        sessionCookie: cookies.join('; '),
      };
    }
    
    // Check response body for error messages
    const responseText = await loginResponse.text();
    if (responseText.includes('неверн') || responseText.includes('incorrect') || 
        responseText.includes('Invalid') || responseText.includes('ошибка')) {
      console.log('Login response indicates invalid credentials');
      return { success: false, error: 'Неверные учетные данные' };
    }
    
    console.log('Authentication failed - no auth indicators');
    return { 
      success: false, 
      error: 'Не удалось авторизоваться. Проверьте учетные данные.',
    };
    
  } catch (error) {
    console.error('Authentication error:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Ошибка подключения' };
  }
}

// Get or refresh authenticated session
async function getAuthenticatedSession(): Promise<{ cookie: string | null; error?: string }> {
  // Check cache first
  if (sessionCache && sessionCache.expiresAt > Date.now() && sessionCache.authenticated) {
    console.log('Using cached session');
    return { cookie: sessionCache.cookie };
  }
  
  const login = Deno.env.get('ILEX_LOGIN');
  const password = Deno.env.get('ILEX_PASSWORD');
  
  if (!login || !password) {
    console.log('No iLex credentials configured');
    return { cookie: null, error: 'Учетные данные iLex не настроены' };
  }
  
  console.log('Authenticating with iLex...');
  const authResult = await authenticate(login, password);
  
  if (authResult.success && authResult.sessionCookie) {
    sessionCache = {
      cookie: authResult.sessionCookie,
      expiresAt: Date.now() + 30 * 60 * 1000, // 30 minutes
      authenticated: true,
    };
    return { cookie: authResult.sessionCookie };
  }
  
  return { cookie: null, error: authResult.error || 'Ошибка авторизации' };
}

// Browse URL with authentication
async function browseUrlAuthenticated(url: string): Promise<{ 
  success: boolean; 
  html?: string; 
  title?: string; 
  links?: Array<{url: string; text: string}>; 
  error?: string;
  requiresAuth?: boolean;
}> {
  try {
    // Get authenticated session
    const session = await getAuthenticatedSession();
    
    // Format URL
    let formattedUrl = url.trim();
    if (!formattedUrl.startsWith('http://') && !formattedUrl.startsWith('https://')) {
      formattedUrl = `${ILEX_BASE_URL}${formattedUrl.startsWith('/') ? '' : '/'}${formattedUrl}`;
    }
    
    console.log('Browsing URL with auth:', formattedUrl);
    
    const response = await fetch(formattedUrl, {
      method: 'GET',
      headers: getHeaders(session.cookie || undefined),
      redirect: 'follow',
    });
    
    if (!response.ok) {
      return { success: false, error: `Ошибка загрузки: ${response.status}` };
    }
    
    const html = await response.text();
    
    // Check if we got login page
    const isLoginPage = html.includes('login') && 
                        (html.includes('пароль') || html.includes('password') || html.includes('Войти'));
    
    if (isLoginPage) {
      // Invalidate session cache
      sessionCache = null;
      return { 
        success: false, 
        error: 'Требуется авторизация',
        requiresAuth: true,
        html,
      };
    }
    
    // Extract title
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : 'Страница';
    
    // Extract links
    const links: Array<{url: string; text: string}> = [];
    const linkRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>([^<]*(?:<[^/a][^<]*)*)<\/a>/gi;
    let match;
    while ((match = linkRegex.exec(html)) !== null) {
      let linkUrl = match[1];
      const linkText = match[2].replace(/<[^>]+>/g, '').trim() || linkUrl;
      
      // Convert relative to absolute
      if (linkUrl.startsWith('/')) {
        linkUrl = `${ILEX_BASE_URL}${linkUrl}`;
      } else if (!linkUrl.startsWith('http')) {
        linkUrl = `${ILEX_BASE_URL}/${linkUrl}`;
      }
      
      // Only include iLex links
      if (linkUrl.includes('ilex')) {
        links.push({ url: linkUrl, text: linkText });
      }
    }
    
    return { success: true, html, title, links };
  } catch (error) {
    console.error('Browse error:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Ошибка загрузки' };
  }
}

// Search iLex directly with authentication
async function searchIlexDirect(query: string, filters?: {
  docType?: string;
  docNumber?: string;
  organ?: string;
  dateFrom?: string;
  dateTo?: string;
  status?: string;
}): Promise<{ success: boolean; results?: any[]; error?: string }> {
  try {
    const session = await getAuthenticatedSession();
    
    if (!session.cookie) {
      return { success: false, error: session.error || 'Не авторизован' };
    }
    
    console.log('Searching iLex directly for:', query);
    
    // Try iLex internal search API endpoints
    const searchEndpoints = [
      '/api/search',
      '/api/documents/search',
      '/search',
      '/api/v1/search',
    ];
    
    for (const endpoint of searchEndpoints) {
      try {
        // Try GET first
        const searchUrl = new URL(`${ILEX_BASE_URL}${endpoint}`);
        searchUrl.searchParams.set('q', query);
        searchUrl.searchParams.set('query', query);
        if (filters?.docType && filters.docType !== 'all') {
          searchUrl.searchParams.set('type', filters.docType);
        }
        if (filters?.docNumber) {
          searchUrl.searchParams.set('number', filters.docNumber);
        }
        
        const response = await fetch(searchUrl.toString(), {
          method: 'GET',
          headers: getHeaders(session.cookie),
        });
        
        if (response.ok) {
          const contentType = response.headers.get('content-type') || '';
          
          if (contentType.includes('application/json')) {
            const data = await response.json();
            if (data.results || data.items || data.documents || Array.isArray(data)) {
              const items = data.results || data.items || data.documents || data;
              const results = items.slice(0, 30).map((item: any) => ({
                url: item.url || item.link || `${ILEX_BASE_URL}/document/${item.id}`,
                title: item.title || item.name || 'Документ',
                description: item.description || item.snippet || '',
                date: item.date || item.doc_date,
                type: item.type || item.doc_type,
              }));
              return { success: true, results };
            }
          } else {
            // HTML response - parse search results from page
            const html = await response.text();
            const results = parseSearchResultsFromHtml(html);
            if (results.length > 0) {
              return { success: true, results };
            }
          }
        }
      } catch (e) {
        console.log(`Search endpoint ${endpoint} failed:`, e);
      }
      
      await humanDelay(100, 300);
    }
    
    // Fallback: search via page scraping
    const searchPageUrl = `${ILEX_BASE_URL}/search?q=${encodeURIComponent(query)}`;
    const pageResponse = await fetch(searchPageUrl, {
      method: 'GET',
      headers: getHeaders(session.cookie),
    });
    
    if (pageResponse.ok) {
      const html = await pageResponse.text();
      const results = parseSearchResultsFromHtml(html);
      return { success: true, results };
    }
    
    return { success: false, error: 'Не удалось выполнить поиск' };
  } catch (error) {
    console.error('Search error:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Ошибка поиска' };
  }
}

// Parse search results from HTML page
function parseSearchResultsFromHtml(html: string): any[] {
  const results: any[] = [];
  
  // Try to find result items using various patterns
  const patterns = [
    // Pattern 1: links with document titles
    /<a[^>]+href=["']([^"']*document[^"']*)["'][^>]*>([^<]+)<\/a>/gi,
    // Pattern 2: search result divs
    /<div[^>]*class=["'][^"']*result[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi,
    // Pattern 3: list items with links
    /<li[^>]*>[\s\S]*?<a[^>]+href=["']([^"']+)["'][^>]*>([^<]+)<\/a>[\s\S]*?<\/li>/gi,
  ];
  
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(html)) !== null && results.length < 30) {
      let url = match[1];
      const title = match[2]?.replace(/<[^>]+>/g, '').trim();
      
      if (url && title && title.length > 5) {
        if (url.startsWith('/')) {
          url = `${ILEX_BASE_URL}${url}`;
        }
        
        // Avoid duplicates
        if (!results.some(r => r.url === url)) {
          results.push({
            url,
            title,
            description: '',
          });
        }
      }
    }
  }
  
  return results;
}

// Fetch document with authentication
async function fetchDocumentAuthenticated(url: string): Promise<{ 
  success: boolean; 
  content?: string; 
  title?: string; 
  html?: string;
  cleanText?: string;
  error?: string 
}> {
  try {
    const session = await getAuthenticatedSession();
    
    // Format URL
    let formattedUrl = url.trim();
    if (!formattedUrl.startsWith('http://') && !formattedUrl.startsWith('https://')) {
      formattedUrl = `${ILEX_BASE_URL}${formattedUrl.startsWith('/') ? '' : '/'}${formattedUrl}`;
    }
    
    console.log('Fetching document with auth:', formattedUrl);
    
    const response = await fetch(formattedUrl, {
      method: 'GET',
      headers: getHeaders(session.cookie || undefined),
    });
    
    if (!response.ok) {
      return { success: false, error: `Ошибка загрузки: ${response.status}` };
    }
    
    const html = await response.text();
    
    // Check if we got login page
    if (html.includes('login') && (html.includes('пароль') || html.includes('Войти'))) {
      sessionCache = null;
      return { success: false, error: 'Требуется авторизация' };
    }
    
    // Extract title
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : 'Документ';
    
    // Extract clean text
    const cleanText = extractCleanText(html);
    
    return { success: true, html, title, cleanText, content: cleanText };
  } catch (error) {
    console.error('Fetch document error:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Ошибка загрузки' };
  }
}

// Find legal text by query
async function findLegalText(query: string): Promise<{ 
  success: boolean; 
  text?: string; 
  title?: string;
  source?: string; 
  url?: string;
  error?: string 
}> {
  try {
    // First, search for the document
    const searchResult = await searchIlexDirect(query);
    
    if (!searchResult.success || !searchResult.results?.length) {
      return { success: false, error: 'Документ не найден' };
    }
    
    const firstResult = searchResult.results[0];
    
    // Fetch the document content
    const docResult = await fetchDocumentAuthenticated(firstResult.url);
    
    if (!docResult.success) {
      return { success: false, error: docResult.error || 'Не удалось загрузить документ' };
    }
    
    return {
      success: true,
      text: docResult.cleanText || docResult.content,
      title: docResult.title || firstResult.title,
      source: 'iLex Private',
      url: firstResult.url,
    };
  } catch (error) {
    console.error('Find legal text error:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Ошибка поиска' };
  }
}

// Check authentication status
async function checkAuthStatus(): Promise<{ 
  authenticated: boolean; 
  message: string;
  hasCredentials: boolean;
}> {
  const login = Deno.env.get('ILEX_LOGIN');
  const password = Deno.env.get('ILEX_PASSWORD');
  
  if (!login || !password) {
    return { 
      authenticated: false, 
      message: 'Учетные данные iLex не настроены',
      hasCredentials: false,
    };
  }
  
  // Check cached session
  if (sessionCache && sessionCache.expiresAt > Date.now() && sessionCache.authenticated) {
    return { 
      authenticated: true, 
      message: 'Авторизован',
      hasCredentials: true,
    };
  }
  
  // Try to authenticate
  const session = await getAuthenticatedSession();
  
  return { 
    authenticated: !!session.cookie, 
    message: session.cookie ? 'Авторизован' : (session.error || 'Ошибка авторизации'),
    hasCredentials: true,
  };
}

// Extract text from HTML
function extractCleanText(html: string): string {
  // Remove script and style tags
  let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  text = text.replace(/<head[^>]*>[\s\S]*?<\/head>/gi, '');
  text = text.replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '');
  text = text.replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '');
  text = text.replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '');
  
  // Convert common tags to newlines
  text = text.replace(/<\/?(p|div|br|h[1-6]|li|tr)[^>]*>/gi, '\n');
  text = text.replace(/<\/?(td|th)[^>]*>/gi, '\t');
  
  // Remove remaining tags
  text = text.replace(/<[^>]+>/g, '');
  
  // Decode HTML entities
  text = text.replace(/&nbsp;/g, ' ');
  text = text.replace(/&amp;/g, '&');
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(dec));
  
  // Clean up whitespace
  text = text.replace(/\t+/g, '\t');
  text = text.replace(/[ ]+/g, ' ');
  text = text.replace(/\n\s*\n/g, '\n\n');
  text = text.trim();
  
  return text;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  
  try {
    const { action, ...params } = await req.json();
    
    console.log('iLex API action:', action);
    
    let result: any;
    
    switch (action) {
      case 'check_connection':
      case 'check_auth':
        result = await checkAuthStatus();
        break;
        
      case 'fetch_document':
        if (!params.url) {
          return new Response(
            JSON.stringify({ success: false, error: 'URL обязателен' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        result = await fetchDocumentAuthenticated(params.url);
        break;
        
      case 'browse':
        if (!params.url) {
          return new Response(
            JSON.stringify({ success: false, error: 'URL обязателен' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        result = await browseUrlAuthenticated(params.url);
        break;
        
      case 'search':
        if (!params.query) {
          return new Response(
            JSON.stringify({ success: false, error: 'Запрос обязателен' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        result = await searchIlexDirect(params.query);
        break;
        
      case 'advanced_search':
        result = await searchIlexDirect(params.query || '', {
          docType: params.docType,
          docNumber: params.docNumber,
          organ: params.organ,
          dateFrom: params.dateFrom,
          dateTo: params.dateTo,
          status: params.status,
        });
        break;
        
      case 'find_legal_text':
        if (!params.query) {
          return new Response(
            JSON.stringify({ success: false, error: 'Запрос обязателен' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        result = await findLegalText(params.query);
        break;
        
      case 'authenticate':
        const login = params.login || Deno.env.get('ILEX_LOGIN');
        const password = params.password || Deno.env.get('ILEX_PASSWORD');
        
        if (!login || !password) {
          return new Response(
            JSON.stringify({ success: false, error: 'Логин и пароль обязательны' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        
        result = await authenticate(login, password);
        if (result.success && result.sessionCookie) {
          sessionCache = {
            cookie: result.sessionCookie,
            expiresAt: Date.now() + 30 * 60 * 1000,
            authenticated: true,
          };
        }
        break;
        
      case 'refresh_session':
        // Force re-authentication
        sessionCache = null;
        const refreshResult = await getAuthenticatedSession();
        result = { 
          success: !!refreshResult.cookie, 
          error: refreshResult.error,
        };
        break;
        
      default:
        return new Response(
          JSON.stringify({ success: false, error: `Неизвестное действие: ${action}` }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
    
    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('iLex API error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Внутренняя ошибка' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
