import { createClient } from "npm:@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { 
      status: 405, 
      headers: { ...corsHeaders, "Content-Type": "application/json" } 
    });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { 
        status: 401, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY");

    if (!lovableApiKey) {
      console.error("LOVABLE_API_KEY not configured");
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY not configured" }), { 
        status: 500, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    }

    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } },
    });

    // Verify user
    const { data: userData, error: authError } = await supabase.auth.getUser();
    if (authError || !userData?.user?.id) {
      console.error("Auth error:", authError);
      return new Response(JSON.stringify({ error: "Invalid token" }), { 
        status: 401, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    }

    const body = await req.json();
    const { title, description, moduleId } = body;

    if (!title) {
      return new Response(JSON.stringify({ error: "Title is required" }), { 
        status: 400, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    }

    // Check for owner reference photos
    let referenceImageUrl: string | null = null;
    let imageEditMode = false;
    
    try {
      const { data: ownerPhotos } = await supabase.storage
        .from('owner-photos')
        .list('', { limit: 10 });

      if (ownerPhotos && ownerPhotos.length > 0) {
        // Filter out hidden files and pick random photo
        const validPhotos = ownerPhotos.filter(f => !f.name.startsWith('.'));
        if (validPhotos.length > 0) {
          const randomIndex = Math.floor(Math.random() * validPhotos.length);
          const { data: urlData } = supabase.storage
            .from('owner-photos')
            .getPublicUrl(validPhotos[randomIndex].name);
          referenceImageUrl = urlData.publicUrl;
          imageEditMode = true;
          console.log("Using reference photo:", referenceImageUrl);
        }
      }
    } catch (e) {
      console.log("No owner photos available, using text-only generation");
    }

    // Generate prompt based on whether we have reference photo
    const prompt = imageEditMode
      ? `Create a professional, elegant cover image for an educational video about: "${title}"
${description ? `Details: ${description}` : ""}

Using the provided portrait photo as base:
- Keep the person clearly visible and recognizable
- Add a subtle, modern gradient overlay (soft purple/blue/gold tones)
- Minimal, clean design — NO visual clutter
- NO icons, NO stamps, NO scales, NO buildings, NO weights
- NO documents, NO clipart-style elements
- NO text, NO watermarks, NO logos whatsoever
- Premium, expensive, magazine-quality look
- 16:9 aspect ratio, high quality
- Soft professional lighting effect`

      : `Create a premium, minimalist cover image for educational content about: "${title}"
${description ? `Details: ${description}` : ""}

CRITICAL REQUIREMENTS:
- Clean, modern aesthetic with elegant gradients
- Abstract geometric shapes, soft light effects, bokeh
- Color palette: sophisticated purples, soft golds, deep blues, warm gradients
- NO scales, NO court buildings, NO stamps, NO weights
- NO documents pile, NO calculators, NO clipart-style icons
- NO generic business symbols - this is NOT a stock image
- Maximum 1-2 subtle abstract elements if needed
- NO text, NO logos, NO watermarks
- Ultra-premium, expensive magazine cover feel
- 16:9 aspect ratio (1200x630 pixels)
- Ultra high resolution, sharp imagery`;

    console.log("Generating cover with prompt:", prompt.slice(0, 100) + "...");
    console.log("Image edit mode:", imageEditMode);

    // Build request based on mode
    let aiRequestBody: any;
    
    if (imageEditMode && referenceImageUrl) {
      // Image editing mode - provide reference photo
      aiRequestBody = {
        model: "google/gemini-2.5-flash-image",
        messages: [{
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: referenceImageUrl } }
          ]
        }],
        modalities: ["image", "text"],
      };
    } else {
      // Text-only generation
      aiRequestBody = {
        model: "google/gemini-2.5-flash-image",
        messages: [{ role: "user", content: prompt }],
        modalities: ["image", "text"],
      };
    }

    // Call Lovable AI
    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovableApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(aiRequestBody),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error("AI API error:", errorText);
      return new Response(JSON.stringify({ error: "AI generation failed", details: errorText }), { 
        status: 500, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    }

    const aiData = await aiResponse.json();
    console.log("AI response structure:", JSON.stringify(aiData).slice(0, 800));

    // Extract image from response - check multiple possible locations
    let imageData: string | undefined;
    
    // Try standard image_url format first
    imageData = aiData.choices?.[0]?.message?.images?.[0]?.image_url?.url;
    
    // Try inline_data format (alternative structure)
    if (!imageData) {
      const inlineData = aiData.choices?.[0]?.message?.images?.[0]?.inline_data;
      if (inlineData?.data && inlineData?.mime_type) {
        imageData = `data:${inlineData.mime_type};base64,${inlineData.data}`;
      }
    }
    
    // Try content parts format (Gemini native)
    if (!imageData && aiData.choices?.[0]?.message?.content) {
      const parts = aiData.choices?.[0]?.message?.parts;
      if (Array.isArray(parts)) {
        for (const part of parts) {
          if (part.inline_data?.data) {
            imageData = `data:${part.inline_data.mime_type || 'image/png'};base64,${part.inline_data.data}`;
            break;
          }
        }
      }
    }
    
    if (!imageData) {
      console.error("No image in AI response. Full response:", JSON.stringify(aiData));
      return new Response(JSON.stringify({ 
        error: "No image generated", 
        details: "AI returned text without image. Try again or use a different title.",
        aiResponse: aiData.choices?.[0]?.message?.content?.slice(0, 200)
      }), { 
        status: 500, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    }
    
    console.log("Image data extracted, length:", imageData.length);

    // Parse base64 data
    const base64Match = imageData.match(/^data:image\/(\w+);base64,(.+)$/);
    if (!base64Match) {
      return new Response(JSON.stringify({ error: "Invalid image data format" }), { 
        status: 500, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    }

    const imageFormat = base64Match[1];
    const base64Data = base64Match[2];

    // Convert base64 to Uint8Array
    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    // Upload to storage
    const fileName = `ai-covers/${moduleId || "temp"}-${Date.now()}.${imageFormat}`;
    
    const { error: uploadError } = await supabase.storage
      .from("training-assets")
      .upload(fileName, bytes, {
        contentType: `image/${imageFormat}`,
        upsert: true,
      });

    if (uploadError) {
      console.error("Upload error:", uploadError);
      return new Response(JSON.stringify({ error: "Failed to upload image", details: uploadError.message }), { 
        status: 500, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from("training-assets")
      .getPublicUrl(fileName);

    console.log("Cover generated and uploaded:", urlData.publicUrl);

    return new Response(JSON.stringify({ 
      success: true,
      url: urlData.publicUrl,
      usedReference: imageEditMode,
    }), { 
      status: 200, 
      headers: { ...corsHeaders, "Content-Type": "application/json" } 
    });

  } catch (error: unknown) {
    console.error("Error in generate-cover:", error);
    const message = error instanceof Error ? error.message : "Internal error";
    return new Response(JSON.stringify({ error: message }), { 
      status: 500, 
      headers: { ...corsHeaders, "Content-Type": "application/json" } 
    });
  }
});
