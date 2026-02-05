import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

interface ResetRequest {
  lesson_id: string;
  target_user_id?: string;  // For admin/impersonation
  scope: "quiz_only" | "lesson_all";
  block_id?: string;        // For quiz_only — specific block
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Auth check
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Verify JWT and get caller
    const jwt = authHeader.replace('Bearer ', '');
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(jwt);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ ok: false, error: 'Invalid token' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    
    const callerId = claimsData.claims.sub as string;

    const body: ResetRequest = await req.json();
    const { lesson_id, target_user_id, scope, block_id } = body;

    // STOP-guard: required params
    if (!lesson_id || !scope) {
      return new Response(JSON.stringify({ ok: false, error: 'Missing lesson_id or scope' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Determine effective user_id
    // If target_user_id provided (admin mode), verify caller is admin
    let effectiveUserId = callerId;
    if (target_user_id && target_user_id !== callerId) {
      // Check if caller is admin via user_roles table
      const { data: roleData } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', callerId)
        .in('role', ['admin', 'superadmin'])
        .maybeSingle();
      
      if (!roleData) {
        return new Response(JSON.stringify({ ok: false, error: 'Admin required for target_user_id' }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      effectiveUserId = target_user_id;
    }

    const result = { 
      affected: { lesson_progress_state: 0, user_lesson_progress: 0 },
      clearedKeys: [] as string[]
    };

    if (scope === 'lesson_all') {
      // Full reset: delete both tables
      const { count: lpsCount } = await supabase
        .from('lesson_progress_state')
        .delete({ count: 'exact' })
        .eq('user_id', effectiveUserId)
        .eq('lesson_id', lesson_id);

      const { count: ulpCount } = await supabase
        .from('user_lesson_progress')
        .delete({ count: 'exact' })
        .eq('user_id', effectiveUserId)
        .eq('lesson_id', lesson_id);

      result.affected.lesson_progress_state = lpsCount || 0;
      result.affected.user_lesson_progress = ulpCount || 0;
      result.clearedKeys = ['*'];

    } else if (scope === 'quiz_only') {
      // Quiz-only reset
      if (block_id) {
        // Delete specific block from user_lesson_progress
        const { count } = await supabase
          .from('user_lesson_progress')
          .delete({ count: 'exact' })
          .eq('user_id', effectiveUserId)
          .eq('lesson_id', lesson_id)
          .eq('block_id', block_id);
        result.affected.user_lesson_progress = count || 0;
      }

      // Update lesson_progress_state: clear quiz keys
      const { data: current } = await supabase
        .from('lesson_progress_state')
        .select('state_json')
        .eq('user_id', effectiveUserId)
        .eq('lesson_id', lesson_id)
        .maybeSingle();

      if (current?.state_json) {
        const stateJson = current.state_json as Record<string, unknown>;
        const keysToRemove = ['role', 'quiz_result', 'quiz_answers'];
        
        // Build new state without quiz keys
        const newState: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(stateJson)) {
          if (!keysToRemove.includes(key)) {
            newState[key] = value;
          }
        }
        
        // Remove block_id from completedSteps
        if (block_id && Array.isArray(newState.completedSteps)) {
          newState.completedSteps = (newState.completedSteps as string[])
            .filter(id => id !== block_id);
        }
        
        // Reset currentStepIndex
        newState.currentStepIndex = 0;

        const { count } = await supabase
          .from('lesson_progress_state')
          .update({ 
            state_json: newState,
            updated_at: new Date().toISOString()
          })
          .eq('user_id', effectiveUserId)
          .eq('lesson_id', lesson_id);

        result.affected.lesson_progress_state = count || 0;
        result.clearedKeys = [...keysToRemove, 'completedSteps.block', 'currentStepIndex'];
      }
    }

    // Log without PII (only first 8 chars of IDs)
    console.log(`[reset-lesson-progress] scope=${scope}, user=${effectiveUserId.slice(0,8)}, lesson=${lesson_id.slice(0,8)}, affected=${JSON.stringify(result.affected)}`);

    return new Response(JSON.stringify({ ok: true, ...result }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('[reset-lesson-progress] Error:', error);
    return new Response(JSON.stringify({ ok: false, error: 'Internal error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
