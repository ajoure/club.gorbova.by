import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Security: This function requires JWT verification at the platform level (verify_jwt = true in config.toml)
// The manual auth validation below provides defense-in-depth and detailed error handling

// Список доступных сфер (должен соответствовать src/constants/spheres.ts)
const AVAILABLE_SPHERES = [
  { id: "none", name: "Без категории" },
  { id: "work", name: "Работа" },
  { id: "business", name: "Бизнес" },
  { id: "finance", name: "Финансы" },
  { id: "learning", name: "Обучение" },
  { id: "self-development", name: "Саморазвитие" },
  { id: "health", name: "Здоровье и спорт" },
  { id: "family", name: "Семья и дети" },
  { id: "relationships", name: "Отношения" },
  { id: "personal", name: "Личное" },
  { id: "rest", name: "Отдых и восстановление" },
  { id: "hobbies", name: "Хобби и развлечения" },
  { id: "friends", name: "Окружение и друзья" },
  { id: "goals", name: "Цели" },
  { id: "planning", name: "Планирование" },
  { id: "strategy", name: "Стратегия" },
  { id: "projects", name: "Проекты" },
];

// Use permissive CORS for Lovable preview environments
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log("Request received, validating auth...");
    
    // Validate JWT and get user
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      console.error("Missing authorization header");
      return new Response(JSON.stringify({ error: "Требуется авторизация" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    
    if (!supabaseUrl || !supabaseAnonKey) {
      console.error("Missing Supabase config");
      throw new Error("Supabase configuration missing");
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      console.error("Auth error:", authError?.message || "No user found");
      return new Response(JSON.stringify({ error: "Недействительный токен" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log("Authenticated user:", user.id);

    const body = await req.json();
    const { title, category, deadline_date, deadline_time, user_spheres } = body;
    
    console.log("Analyzing task:", title);
    
    // Input validation
    if (!title || typeof title !== 'string' || title.length > 500) {
      return new Response(JSON.stringify({ error: "Некорректное название задачи" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    
    if (!LOVABLE_API_KEY) {
      console.error("LOVABLE_API_KEY not found");
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const today = new Date().toISOString().split('T')[0];
    const deadlineInfo = deadline_date 
      ? `Дедлайн: ${deadline_date}${deadline_time ? ` ${deadline_time}` : ""} (сегодня: ${today})` 
      : "Дедлайн не установлен";
    const categoryInfo = category ? `Текущая сфера: ${category}` : "Сфера не указана";

    // Combine predefined spheres with user custom spheres
    const allSpheres = [...AVAILABLE_SPHERES];
    if (user_spheres && Array.isArray(user_spheres)) {
      user_spheres.forEach((s: { id: string; name: string }) => {
        if (s.id && s.name && !allSpheres.find(sp => sp.id === s.id)) {
          allSpheres.push({ id: s.id, name: s.name });
        }
      });
    }

    const spheresList = allSpheres.map(s => `- ${s.id}: ${s.name}`).join("\n");

    const prompt = `Определи приоритет и сферу задачи для Матрицы продуктивности.

Задача: "${title}"
${categoryInfo}
${deadlineInfo}

КРИТЕРИИ ПРИОРИТЕТА:
- q1: Срочно и Важно (критические задачи с близким дедлайном)
- q2: Важно, не Срочно (стратегические задачи развития)
- q3: Срочно, не Важно (рутинные срочные дела)
- q4: Не Срочно, не Важно (развлечения, отвлечения)

СФЕРЫ (выбери ОДНУ):
${spheresList}

Ответь JSON: {"quadrant":"q1|q2|q3|q4","quadrant_reason":"причина","sphere_id":"id","sphere_reason":"причина"}`;

    console.log("Calling AI gateway...");
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 25000); // 25s timeout
    
    try {
      const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            { role: "system", content: "Отвечай только JSON. Выбирай сферу из списка." },
            { role: "user", content: prompt },
          ],
        }),
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);

      if (!response.ok) {
        const status = response.status;
        console.error("AI gateway error status:", status);
        
        if (status === 429) {
          return new Response(JSON.stringify({ error: "Слишком много запросов, попробуйте позже" }), {
            status: 429,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        if (status === 402) {
          return new Response(JSON.stringify({ error: "Необходимо пополнить баланс" }), {
            status: 402,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const errorText = await response.text();
        console.error("AI gateway error:", status, errorText);
        return new Response(JSON.stringify({ error: "Ошибка AI сервиса" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || "";
      
      console.log("AI response received:", content.substring(0, 200));

      // Parse JSON from response
      let result;
      try {
        const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/) || content.match(/\{[\s\S]*\}/);
        const jsonStr = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : content;
        result = JSON.parse(jsonStr.trim());
      } catch (parseError) {
        console.error("Failed to parse AI response:", parseError);
        result = { 
          quadrant: "q2", 
          quadrant_reason: "Рекомендуется запланировать",
          sphere_id: null,
          sphere_reason: null
        };
      }

      // Map quadrant names
      const quadrantMap: Record<string, string> = {
        q1: "urgent-important",
        q2: "not-urgent-important",
        q3: "urgent-not-important",
        q4: "not-urgent-not-important",
      };

      // Validate sphere_id exists in available spheres
      const validSphere = allSpheres.find(s => s.id === result.sphere_id);
      const sphereId = validSphere ? result.sphere_id : null;
      const sphereName = validSphere?.name || null;

      console.log("Returning result - quadrant:", result.quadrant, "sphere:", sphereId);

      return new Response(JSON.stringify({
        quadrant: quadrantMap[result.quadrant] || "not-urgent-important",
        quadrant_reason: result.quadrant_reason || result.reason || "AI рекомендация",
        sphere_id: sphereId,
        sphere_name: sphereName,
        sphere_reason: result.sphere_reason || null,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch (fetchError) {
      clearTimeout(timeoutId);
      if (fetchError instanceof Error && fetchError.name === 'AbortError') {
        console.error("AI request timeout");
        return new Response(JSON.stringify({ error: "Превышено время ожидания AI" }), {
          status: 504,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw fetchError;
    }
  } catch (error) {
    console.error("Error in analyze-task-priority:", error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : "Неизвестная ошибка" 
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
