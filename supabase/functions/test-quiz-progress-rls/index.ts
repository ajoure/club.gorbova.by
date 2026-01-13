import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Runtime proof test for quiz progress saving WITH RLS.
 * 
 * This function tests the actual student flow:
 * 1. Creates a test user
 * 2. Signs in as that user to get a JWT
 * 3. Uses the USER's JWT (not service_role) to perform upserts
 * 4. This validates RLS policies work correctly
 * 
 * Usage: POST /functions/v1/test-quiz-progress-rls
 */

const LESSON_ID = "bbbbbbbb-0001-0001-0001-000000000001";
const BLOCK_IDS = {
  fill_blank: "cccccccc-0001-0001-0001-000000000001",
  matching: "cccccccc-0001-0001-0001-000000000002",
  sequence: "cccccccc-0001-0001-0001-000000000003",
  hotspot: "cccccccc-0001-0001-0001-000000000004",
};

// Simulated quiz answers (matching frontend format exactly)
const QUIZ_ANSWERS = {
  fill_blank: {
    answers: { "blank-1": "Привет", "blank-2": "Мир" },
    is_submitted: true,
    submitted_at: new Date().toISOString(),
  },
  matching: {
    matches: { "pair-1": "right-1", "pair-2": "right-2" },
    rightOrder: ["right-1", "right-2"],
    is_submitted: true,
    submitted_at: new Date().toISOString(),
  },
  sequence: {
    order: ["item-1", "item-2", "item-3"],
    is_submitted: true,
    submitted_at: new Date().toISOString(),
  },
  hotspot: {
    clicks: [{ x: 50, y: 50 }],
    is_submitted: true,
    submitted_at: new Date().toISOString(),
  },
};

const EXPECTED_SCORES = {
  fill_blank: { score: 2, maxScore: 2, isCorrect: true },
  matching: { score: 2, maxScore: 2, isCorrect: true },
  sequence: { score: 3, maxScore: 3, isCorrect: true },
  hotspot: { score: 1, maxScore: 1, isCorrect: true },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const logs: string[] = [];
  const log = (msg: string) => {
    console.log(msg);
    logs.push(msg);
  };

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    
    // Service role client ONLY for user management (create/delete)
    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    
    // Step 1: Create a unique test user
    const testEmail = `test-quiz-rls-${Date.now()}@example.com`;
    const testPassword = "TestPassword123!";
    
    log(`[STEP 1] Creating test user: ${testEmail}`);
    
    const { data: createData, error: createError } = await adminClient.auth.admin.createUser({
      email: testEmail,
      password: testPassword,
      email_confirm: true,
    });
    
    if (createError) {
      throw new Error(`Failed to create user: ${createError.message}`);
    }
    
    const userId = createData.user.id;
    log(`[STEP 1] ✓ User created: ${userId}`);
    
    // Step 2: Sign in as the user to get JWT
    log(`[STEP 2] Signing in as user to get JWT...`);
    
    // Create anon client for sign-in
    const anonClient = createClient(supabaseUrl, supabaseAnonKey);
    
    const { data: signInData, error: signInError } = await anonClient.auth.signInWithPassword({
      email: testEmail,
      password: testPassword,
    });
    
    if (signInError || !signInData.session) {
      throw new Error(`Failed to sign in: ${signInError?.message || 'No session'}`);
    }
    
    const userJwt = signInData.session.access_token;
    log(`[STEP 2] ✓ Got user JWT (first 50 chars): ${userJwt.substring(0, 50)}...`);
    
    // Step 3: Create client with USER's JWT (NOT service role)
    log(`[STEP 3] Creating Supabase client with USER JWT (RLS enforced)...`);
    
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: {
          Authorization: `Bearer ${userJwt}`,
        },
      },
    });
    
    // Verify we're authenticated as the user
    const { data: { user: verifiedUser } } = await userClient.auth.getUser();
    if (!verifiedUser || verifiedUser.id !== userId) {
      throw new Error(`User verification failed: expected ${userId}, got ${verifiedUser?.id}`);
    }
    log(`[STEP 3] ✓ Client authenticated as user: ${verifiedUser.email}`);
    
    // Step 4: Clear any existing progress (using user client - tests DELETE RLS)
    log(`[STEP 4] Clearing existing progress (tests RLS DELETE)...`);
    
    const { error: deleteError } = await userClient
      .from("user_lesson_progress")
      .delete()
      .eq("user_id", userId)
      .eq("lesson_id", LESSON_ID);
    
    if (deleteError) {
      log(`[STEP 4] Delete warning (may be empty): ${deleteError.message}`);
    } else {
      log(`[STEP 4] ✓ Cleared existing progress`);
    }
    
    // Step 5: Simulate saveBlockResponse for each quiz (using USER client - tests INSERT/UPDATE RLS)
    const results: Record<string, any> = {};
    
    for (const [quizType, blockId] of Object.entries(BLOCK_IDS)) {
      const answer = QUIZ_ANSWERS[quizType as keyof typeof QUIZ_ANSWERS];
      const expected = EXPECTED_SCORES[quizType as keyof typeof EXPECTED_SCORES];
      
      log(`\n[STEP 5.${quizType}] Simulating saveBlockResponse...`);
      log(`[saveBlockResponse] INPUT: blockId=${blockId}, isCorrect=${expected.isCorrect}, score=${expected.score}/${expected.maxScore}`);
      
      const progressData = {
        user_id: userId,
        lesson_id: LESSON_ID,
        block_id: blockId,
        response: answer, // Only payload + is_submitted + submitted_at
        is_correct: expected.isCorrect,
        score: expected.score,
        max_score: expected.maxScore,
        attempts: 1,
        completed_at: new Date().toISOString(),
        started_at: new Date().toISOString(),
      };
      
      // Use USER client (RLS enforced!)
      const { data, error } = await userClient
        .from("user_lesson_progress")
        .upsert(progressData, {
          onConflict: "user_id,lesson_id,block_id",
        })
        .select();
      
      log(`[saveBlockResponse] RESULT: ${error ? `ERROR: ${error.message}` : 'SUCCESS'}`);
      
      results[quizType] = {
        block_id: blockId,
        success: !error,
        error: error?.message || null,
        data: data,
      };
      
      if (error) {
        log(`[STEP 5.${quizType}] ✗ RLS BLOCKED or error: ${error.message}`);
      } else {
        log(`[STEP 5.${quizType}] ✓ Upsert successful with user JWT`);
      }
    }
    
    // Step 6: Verify saved data (using USER client - tests SELECT RLS)
    log(`\n[STEP 6] Reading back progress (tests RLS SELECT)...`);
    
    const { data: savedProgress, error: selectError } = await userClient
      .from("user_lesson_progress")
      .select("block_id, response, is_correct, score, max_score, attempts, completed_at, updated_at")
      .eq("lesson_id", LESSON_ID)
      .eq("user_id", userId)
      .order("updated_at", { ascending: false });
    
    if (selectError) {
      throw new Error(`Failed to read progress: ${selectError.message}`);
    }
    
    log(`[STEP 6] ✓ Retrieved ${savedProgress?.length || 0} records`);
    
    // Step 7: Validate acceptance criteria
    log(`\n[STEP 7] Validating acceptance criteria...`);
    
    const validation = {
      record_count: savedProgress?.length || 0,
      expected_count: 4,
      all_valid: true,
      issues: [] as string[],
      response_json_samples: {} as Record<string, any>,
    };
    
    if (validation.record_count !== 4) {
      validation.all_valid = false;
      validation.issues.push(`Expected 4 records, got ${validation.record_count}`);
    }
    
    savedProgress?.forEach((record: any) => {
      const resp = record.response;
      const blockType = Object.entries(BLOCK_IDS).find(([_, id]) => id === record.block_id)?.[0] || 'unknown';
      
      // Store raw response JSON for proof
      validation.response_json_samples[blockType] = resp;
      
      // Check response does NOT contain score fields
      if ('score' in resp) {
        validation.all_valid = false;
        validation.issues.push(`${blockType}: response contains 'score' (should be column only)`);
      }
      if ('max_score' in resp) {
        validation.all_valid = false;
        validation.issues.push(`${blockType}: response contains 'max_score' (should be column only)`);
      }
      // Note: is_correct in response is OK if it's from is_submitted flow, but score/max_score are not
      
      // Check columns are filled
      if (record.is_correct === null) {
        validation.all_valid = false;
        validation.issues.push(`${blockType}: is_correct column is null`);
      }
      if (record.score === null) {
        validation.all_valid = false;
        validation.issues.push(`${blockType}: score column is null`);
      }
      if (record.max_score === null) {
        validation.all_valid = false;
        validation.issues.push(`${blockType}: max_score column is null`);
      }
      if (!record.attempts || record.attempts < 1) {
        validation.all_valid = false;
        validation.issues.push(`${blockType}: attempts is ${record.attempts}`);
      }
      if (!record.completed_at) {
        validation.all_valid = false;
        validation.issues.push(`${blockType}: completed_at is null`);
      }
    });
    
    log(`[STEP 7] Validation result: ${validation.all_valid ? 'PASSED' : 'FAILED'}`);
    if (validation.issues.length > 0) {
      validation.issues.forEach(issue => log(`  - ${issue}`));
    }
    
    // Step 8: DO NOT cleanup test user - keep data for verification
    log(`\n[STEP 8] Keeping test user ${userId} for manual SQL verification`);
    log(`To verify manually, run:`);
    log(`SELECT block_id, response, is_correct, score, max_score, attempts, completed_at`);
    log(`FROM user_lesson_progress WHERE user_id = '${userId}' ORDER BY updated_at DESC;`);
    
    const finalResult = {
      acceptance_passed: validation.all_valid && validation.record_count === 4,
      test_user: {
        id: userId,
        email: testEmail,
        note: "User NOT deleted - verify with SQL manually",
      },
      lesson_id: LESSON_ID,
      service_role_used_for_auth_admin: true,
      service_role_used_for_db_writes: false,
      rls_enforced: true,
      upsert_results: results,
      saved_progress_raw: savedProgress,
      validation,
      logs,
    };
    
    return new Response(JSON.stringify(finalResult, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: finalResult.acceptance_passed ? 200 : 400,
    });
    
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`[ERROR] ${message}`);
    return new Response(
      JSON.stringify({ error: message, logs }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
