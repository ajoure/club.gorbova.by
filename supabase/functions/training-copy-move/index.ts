import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseService = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Verify user
    const anonClient = createClient(supabaseUrl, supabaseAnon, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsErr } = await anonClient.auth.getClaims(token);
    if (claimsErr || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = claimsData.claims.sub as string;

    // Check admin role using has_role_v2 (accepts text, not enum)
    const svc = createClient(supabaseUrl, supabaseService);
    const { data: isAdmin } = await svc.rpc("has_role_v2", {
      _user_id: userId,
      _role_code: "admin",
    });
    const { data: isSuperAdmin } = await svc.rpc("has_role_v2", {
      _user_id: userId,
      _role_code: "super_admin",
    });
    if (!isAdmin && !isSuperAdmin) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { action, source_id, target_module_id, target_section_key } = body;

    if (!action || !source_id) {
      return new Response(JSON.stringify({ error: "action and source_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let result: any;

    switch (action) {
      case "copy_lesson":
        result = await copyLesson(svc, source_id, target_module_id);
        break;
      case "copy_module":
        result = await copyModule(svc, source_id, target_module_id, target_section_key);
        break;
      case "move_lesson":
        result = await moveLesson(svc, source_id, target_module_id);
        break;
      case "move_module":
        result = await moveModule(svc, source_id, target_module_id, target_section_key);
        break;
      default:
        return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }

    return new Response(JSON.stringify({ ok: true, ...result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("training-copy-move error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// ─── COPY LESSON ────────────────────────────────────────────────
async function copyLesson(svc: any, sourceId: string, targetModuleId: string) {
  // 1. Fetch source lesson
  const { data: lesson, error: lErr } = await svc
    .from("training_lessons")
    .select("*")
    .eq("id", sourceId)
    .single();
  if (lErr) throw new Error(`Lesson not found: ${lErr.message}`);

  // 2. Insert copy
  const newSlug = `${lesson.slug}-copy-${Date.now().toString(36)}`;
  const { id: _id, created_at: _ca, updated_at: _ua, ...rest } = lesson;
  const { data: newLesson, error: insErr } = await svc
    .from("training_lessons")
    .insert({
      ...rest,
      module_id: targetModuleId || lesson.module_id,
      title: `Копия — ${lesson.title}`,
      slug: newSlug,
    })
    .select("id")
    .single();
  if (insErr) throw new Error(`Insert lesson failed: ${insErr.message}`);

  // 3. Copy lesson_blocks with parent_id mapping
  const { data: blocks } = await svc
    .from("lesson_blocks")
    .select("*")
    .eq("lesson_id", sourceId)
    .order("sort_order");

  if (blocks && blocks.length > 0) {
    const idMap = new Map<string, string>();

    for (const block of blocks) {
      const { id: oldId, created_at: _bc, updated_at: _bu, ...bRest } = block;
      const mappedParent = block.parent_id ? idMap.get(block.parent_id) || null : null;

      const { data: newBlock, error: bErr } = await svc
        .from("lesson_blocks")
        .insert({
          ...bRest,
          lesson_id: newLesson.id,
          parent_id: mappedParent,
        })
        .select("id")
        .single();
      if (bErr) {
        console.error("Block copy error:", bErr);
        continue;
      }
      idMap.set(oldId, newBlock.id);
    }
  }

  // 4. Copy kb_questions
  const { data: questions } = await svc
    .from("kb_questions")
    .select("*")
    .eq("lesson_id", sourceId);

  if (questions && questions.length > 0) {
    for (const q of questions) {
      const { id: _qid, created_at: _qc, updated_at: _qu, ...qRest } = q;
      await svc.from("kb_questions").insert({
        ...qRest,
        lesson_id: newLesson.id,
      });
    }
  }

  return { newId: newLesson.id, type: "lesson" };
}

// ─── COPY MODULE (recursive) ───────────────────────────────────
async function copyModule(
  svc: any,
  sourceId: string,
  targetParentId: string | null,
  targetSectionKey?: string,
) {
  // 1. Fetch source module
  const { data: mod, error: mErr } = await svc
    .from("training_modules")
    .select("*")
    .eq("id", sourceId)
    .single();
  if (mErr) throw new Error(`Module not found: ${mErr.message}`);

  // 2. Insert copy
  const newSlug = `${mod.slug}-copy-${Date.now().toString(36)}`;
  const { id: _id, created_at: _ca, updated_at: _ua, ...rest } = mod;
  const { data: newMod, error: insErr } = await svc
    .from("training_modules")
    .insert({
      ...rest,
      title: `Копия — ${mod.title}`,
      slug: newSlug,
      parent_module_id: targetParentId !== undefined ? targetParentId : mod.parent_module_id,
      menu_section_key: targetSectionKey || mod.menu_section_key,
    })
    .select("id")
    .single();
  if (insErr) throw new Error(`Insert module failed: ${insErr.message}`);

  // 3. Copy module_access — PATCH v23.1.6: skip if source has product_id (access via product SoT)
  if (!mod.product_id) {
    const { data: accessRows } = await svc
      .from("module_access")
      .select("*")
      .eq("module_id", sourceId);

    if (accessRows && accessRows.length > 0) {
      for (const a of accessRows) {
        const { id: _aid, created_at: _ac, ...aRest } = a;
        await svc.from("module_access").insert({
          ...aRest,
          module_id: newMod.id,
        });
      }
    }
  }

  // 4. Copy lessons
  const { data: lessons } = await svc
    .from("training_lessons")
    .select("id")
    .eq("module_id", sourceId)
    .order("sort_order");

  if (lessons) {
    for (const l of lessons) {
      await copyLesson(svc, l.id, newMod.id);
    }
  }

  // 5. Recursively copy child modules
  const { data: children } = await svc
    .from("training_modules")
    .select("id")
    .eq("parent_module_id", sourceId)
    .order("sort_order");

  if (children) {
    for (const child of children) {
      await copyModule(svc, child.id, newMod.id, targetSectionKey);
    }
  }

  return { newId: newMod.id, type: "module" };
}

// ─── MOVE LESSON ────────────────────────────────────────────────
async function moveLesson(svc: any, sourceId: string, targetModuleId: string) {
  const { error } = await svc
    .from("training_lessons")
    .update({ module_id: targetModuleId })
    .eq("id", sourceId);
  if (error) throw new Error(`Move lesson failed: ${error.message}`);
  return { movedId: sourceId, type: "lesson" };
}

// ─── MOVE MODULE ────────────────────────────────────────────────
async function moveModule(
  svc: any,
  sourceId: string,
  targetParentId: string | null,
  targetSectionKey?: string,
) {
  const updateData: any = { parent_module_id: targetParentId };
  if (targetSectionKey) {
    updateData.menu_section_key = targetSectionKey;
  }
  const { error } = await svc
    .from("training_modules")
    .update(updateData)
    .eq("id", sourceId);
  if (error) throw new Error(`Move module failed: ${error.message}`);
  return { movedId: sourceId, type: "module" };
}
