/**
 * Shared CORS headers for Edge Functions
 * 
 * STANDARD: All browser-called functions MUST use these headers
 * to support Supabase JS SDK v2 client headers.
 * 
 * Usage:
 *   import { corsHeaders, handleCorsPreflightRequest } from '../_shared/cors.ts';
 * 
 *   if (req.method === 'OPTIONS') {
 *     return handleCorsPreflightRequest();
 *   }
 * 
 *   // In responses:
 *   return new Response(JSON.stringify(data), {
 *     headers: { ...corsHeaders, 'Content-Type': 'application/json' },
 *   });
 */

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

/**
 * Handle CORS preflight (OPTIONS) request
 */
export function handleCorsPreflightRequest(): Response {
  return new Response(null, { headers: corsHeaders });
}

/**
 * Create a JSON response with CORS headers
 */
export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/**
 * Create an error response with CORS headers
 */
export function errorResponse(message: string, status = 400): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
