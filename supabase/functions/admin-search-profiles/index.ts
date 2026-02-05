import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface SearchRequest {
  query: string;
  limit?: number;
}

interface ProfileResult {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  user_id: string | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

  // Auth check
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(
      JSON.stringify({ success: false, error: "Unauthorized" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const supabaseAnon = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } }
  });

  try {
    // Get current user
    const { data: { user }, error: authError } = await supabaseAnon.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ success: false, error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check admin/support role
    const { data: hasPermission } = await supabaseAdmin.rpc('has_permission', {
      _user_id: user.id,
      _permission_code: 'users.view'
    });

    if (!hasPermission) {
      // Fallback: check has_role for admin
      const { data: isAdmin } = await supabaseAdmin.rpc('has_role', {
        _user_id: user.id,
        _role: 'admin'
      });
      
      if (!isAdmin) {
        return new Response(
          JSON.stringify({ success: false, error: "Forbidden: users.view permission required" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Parse request
    const { query, limit = 20 }: SearchRequest = await req.json();

    if (!query || query.length < 2) {
      return new Response(
        JSON.stringify({ success: true, results: [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate and sanitize limit
    const safeLimit = Math.min(Math.max(1, Number(limit) || 20), 100);

    // Sanitize query: escape special PostgreSQL LIKE pattern characters
    // This prevents SQL injection via pattern metacharacters
    const sanitizedQuery = query
      .replace(/\\/g, '\\\\')  // Escape backslashes first
      .replace(/%/g, '\\%')    // Escape percent signs
      .replace(/_/g, '\\_');   // Escape underscores

    // Search profiles with service role (bypasses RLS)
    // Using Supabase's built-in escaping via the filter method
    const { data: results, error: searchError } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, email, phone, user_id")
      .or(`full_name.ilike.%${sanitizedQuery}%,email.ilike.%${sanitizedQuery}%,phone.ilike.%${sanitizedQuery}%`)
      .limit(safeLimit);

    if (searchError) {
      console.error("Search error:", searchError);
      return new Response(
        JSON.stringify({ success: false, error: searchError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Sort by relevance
    const queryLower = query.toLowerCase();
    const sortedResults = (results || []).sort((a, b) => {
      const aName = (a.full_name || '').toLowerCase();
      const bName = (b.full_name || '').toLowerCase();
      
      // Exact match at start is best
      const aStartsWithName = aName.startsWith(queryLower);
      const bStartsWithName = bName.startsWith(queryLower);
      if (aStartsWithName && !bStartsWithName) return -1;
      if (!aStartsWithName && bStartsWithName) return 1;
      
      // Email exact match
      const aEmailMatch = a.email?.toLowerCase().includes(queryLower);
      const bEmailMatch = b.email?.toLowerCase().includes(queryLower);
      if (aEmailMatch && !bEmailMatch) return -1;
      if (!aEmailMatch && bEmailMatch) return 1;
      
      return aName.localeCompare(bName, 'ru');
    });

    return new Response(
      JSON.stringify({ 
        success: true, 
        results: sortedResults as ProfileResult[],
        total: sortedResults.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("[admin-search-profiles] Error:", error);
    return new Response(
      JSON.stringify({ success: false, error: String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
