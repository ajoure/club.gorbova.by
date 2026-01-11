import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { jobId } = await req.json();

    if (!jobId) {
      return new Response(JSON.stringify({ error: 'jobId is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Verify user is authenticated and has admin role
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Check admin role (supports both legacy user_roles and new user_roles_v2)
    const { data: isAdmin, error: adminError } = await supabase.rpc('has_role', {
      _user_id: user.id,
      _role: 'admin',
    });

    const { data: isSuperAdmin, error: superAdminError } = await supabase.rpc('has_role', {
      _user_id: user.id,
      _role: 'superadmin',
    });

    if (adminError || superAdminError) {
      console.error('Role check error:', adminError ?? superAdminError);
    }

    if (!isAdmin && !isSuperAdmin) {
      return new Response(JSON.stringify({ error: 'Admin access required' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get the import job
    const { data: job, error: jobError } = await supabase
      .from('import_jobs')
      .select('*')
      .eq('id', jobId)
      .single();

    if (jobError || !job) {
      return new Response(JSON.stringify({ error: 'Import job not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Find all profiles with this import_batch_id
    const { data: profiles, error: profilesError } = await supabase
      .from('profiles')
      .select('id, source, created_at')
      .eq('import_batch_id', jobId);

    if (profilesError) {
      throw new Error('Error fetching profiles: ' + profilesError.message);
    }

    let deletedCount = 0;
    let clearedCount = 0;

    // Separate profiles into those created by this import vs those just updated
    const createdByImport: string[] = [];
    const updatedByImport: string[] = [];

    for (const profile of profiles || []) {
      // If source is 'amocrm_import', it was created by this import
      if (profile.source === 'amocrm_import') {
        createdByImport.push(profile.id);
      } else {
        updatedByImport.push(profile.id);
      }
    }

    // Delete profiles created by this import
    if (createdByImport.length > 0) {
      const { error: deleteError, count } = await supabase
        .from('profiles')
        .delete()
        .in('id', createdByImport);

      if (deleteError) {
        console.error('Error deleting profiles:', deleteError);
        throw new Error('Error deleting profiles: ' + deleteError.message);
      }
      deletedCount = count || createdByImport.length;
    }

    // Clear import_batch_id for profiles that existed before
    if (updatedByImport.length > 0) {
      const { error: updateError, count } = await supabase
        .from('profiles')
        .update({ import_batch_id: null })
        .in('id', updatedByImport);

      if (updateError) {
        console.error('Error clearing batch_id:', updateError);
        throw new Error('Error clearing batch_id: ' + updateError.message);
      }
      clearedCount = count || updatedByImport.length;
    }

    // Update job status to indicate rollback
    await supabase
      .from('import_jobs')
      .update({
        status: 'rolled_back',
        meta: {
          ...((job.meta as Record<string, unknown>) || {}),
          rolled_back_at: new Date().toISOString(),
          rolled_back_by: user.id,
          rollback_deleted: deletedCount,
          rollback_cleared: clearedCount,
        },
      })
      .eq('id', jobId);

    // Log the action
    await supabase.from('audit_logs').insert({
      actor_user_id: user.id,
      action: 'import_rollback',
      meta: {
        job_id: jobId,
        deleted_count: deletedCount,
        cleared_count: clearedCount,
      },
    });

    return new Response(
      JSON.stringify({
        success: true,
        jobId,
        deletedCount,
        clearedCount,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Rollback error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
