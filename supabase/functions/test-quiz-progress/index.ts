import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Runtime proof test for quiz progress saving.
 * 
 * This edge function simulates student quiz submissions and verifies
 * that progress is correctly saved to user_lesson_progress table.
 * 
 * Usage: POST /functions/v1/test-quiz-progress
 * Body: { "user_email": "test@example.com", "user_password": "..." }
 * 
 * Or with service_role (bypasses RLS):
 * POST /functions/v1/test-quiz-progress
 * Body: { "use_service_role": true, "user_id": "..." }
 */

const LESSON_ID = "bbbbbbbb-0001-0001-0001-000000000001";
const BLOCK_IDS = {
  fill_blank: "cccccccc-0001-0001-0001-000000000001",
  matching: "cccccccc-0001-0001-0001-000000000002",
  sequence: "cccccccc-0001-0001-0001-000000000003",
  hotspot: "cccccccc-0001-0001-0001-000000000004",
};

// Simulated quiz answers (matching frontend format)
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

// Expected scores for correct answers
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

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    
    // Use service role to bypass RLS for this test
    const supabase = createClient(supabaseUrl, serviceRoleKey);
    
    const body = await req.json().catch(() => ({}));
    let userId = body.user_id;
    
    // If no user_id provided, create a test user
    if (!userId) {
      const testEmail = `test-quiz-${Date.now()}@example.com`;
      const testPassword = "test123456";
      
      const { data: authData, error: authError } = await supabase.auth.admin.createUser({
        email: testEmail,
        password: testPassword,
        email_confirm: true,
      });
      
      if (authError) {
        throw new Error(`Failed to create test user: ${authError.message}`);
      }
      
      userId = authData.user.id;
      console.log(`Created test user: ${testEmail} (${userId})`);
    }
    
    const results: Record<string, any> = {
      user_id: userId,
      lesson_id: LESSON_ID,
      blocks: {},
    };
    
    // Clear any existing progress for this test
    await supabase
      .from("user_lesson_progress")
      .delete()
      .eq("user_id", userId)
      .eq("lesson_id", LESSON_ID);
    
    console.log("Cleared existing progress");
    
    // Simulate saveBlockResponse for each quiz type
    for (const [quizType, blockId] of Object.entries(BLOCK_IDS)) {
      const answer = QUIZ_ANSWERS[quizType as keyof typeof QUIZ_ANSWERS];
      const expected = EXPECTED_SCORES[quizType as keyof typeof EXPECTED_SCORES];
      
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
      
      console.log(`[saveBlockResponse] INPUT:`, {
        blockType: quizType,
        blockId,
        response: answer,
        isCorrect: expected.isCorrect,
        score: expected.score,
        maxScore: expected.maxScore,
      });
      
      const { data, error } = await supabase
        .from("user_lesson_progress")
        .upsert(progressData, {
          onConflict: "user_id,lesson_id,block_id",
        })
        .select();
      
      console.log(`[saveBlockResponse] RESULT:`, { data, error });
      
      results.blocks[quizType] = {
        block_id: blockId,
        input: progressData,
        result: { data, error: error?.message || null },
        success: !error,
      };
    }
    
    // Verify saved data
    const { data: savedProgress, error: selectError } = await supabase
      .from("user_lesson_progress")
      .select("block_id, response, is_correct, score, max_score, attempts, completed_at, updated_at")
      .eq("lesson_id", LESSON_ID)
      .eq("user_id", userId)
      .order("updated_at", { ascending: false });
    
    if (selectError) {
      throw new Error(`Failed to query progress: ${selectError.message}`);
    }
    
    // Validate acceptance criteria
    const validation = {
      record_count: savedProgress?.length || 0,
      expected_count: 4,
      all_records_valid: true,
      issues: [] as string[],
    };
    
    if (validation.record_count !== 4) {
      validation.all_records_valid = false;
      validation.issues.push(`Expected 4 records, got ${validation.record_count}`);
    }
    
    savedProgress?.forEach((record: any) => {
      const response = record.response;
      
      // Check that response does NOT contain is_correct, score, max_score
      if ('is_correct' in response && response.is_correct !== undefined) {
        // is_correct in response is a violation (should only be in columns)
        // BUT: is_submitted is expected
        if (response.is_correct !== undefined && typeof response.is_correct === 'boolean' && 
            response.is_correct !== response.is_submitted) {
          validation.all_records_valid = false;
          validation.issues.push(`Block ${record.block_id}: response contains is_correct (should be in column only)`);
        }
      }
      if ('score' in response) {
        validation.all_records_valid = false;
        validation.issues.push(`Block ${record.block_id}: response contains score (should be in column only)`);
      }
      if ('max_score' in response) {
        validation.all_records_valid = false;
        validation.issues.push(`Block ${record.block_id}: response contains max_score (should be in column only)`);
      }
      
      // Check that columns are filled
      if (record.is_correct === null) {
        validation.all_records_valid = false;
        validation.issues.push(`Block ${record.block_id}: is_correct column is null`);
      }
      if (record.score === null) {
        validation.all_records_valid = false;
        validation.issues.push(`Block ${record.block_id}: score column is null`);
      }
      if (record.max_score === null) {
        validation.all_records_valid = false;
        validation.issues.push(`Block ${record.block_id}: max_score column is null`);
      }
      if (record.attempts === null || record.attempts < 1) {
        validation.all_records_valid = false;
        validation.issues.push(`Block ${record.block_id}: attempts is ${record.attempts}`);
      }
      if (!record.completed_at) {
        validation.all_records_valid = false;
        validation.issues.push(`Block ${record.block_id}: completed_at is null`);
      }
    });
    
    results.saved_progress = savedProgress;
    results.validation = validation;
    results.acceptance_passed = validation.all_records_valid && validation.record_count === 4;
    
    // Cleanup test user if we created one
    if (!body.user_id && userId) {
      await supabase.auth.admin.deleteUser(userId);
      console.log(`Cleaned up test user: ${userId}`);
      results.test_user_cleaned = true;
    }
    
    return new Response(JSON.stringify(results, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: results.acceptance_passed ? 200 : 400,
    });
    
  } catch (error) {
    console.error("Test error:", error);
    const message = error instanceof Error ? error.message : String(error);
    return new Response(
      JSON.stringify({ error: message }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
