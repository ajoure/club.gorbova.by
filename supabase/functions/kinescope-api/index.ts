import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const KINESCOPE_API_V1 = "https://api.kinescope.io/v1";
const KINESCOPE_API_V2 = "https://api.kinescope.io/v2";

interface KinescopeRequest {
  action: string;
  api_token?: string;
  instance_id?: string;
  project_id?: string;
  video_id?: string;
  live_event_id?: string;
  page?: number;
  per_page?: number;
  // For create_live_event
  name?: string;
  type?: string;
  record?: boolean;
}

async function makeRequest(
  baseUrl: string,
  endpoint: string,
  apiToken: string,
  method: string = "GET",
  body?: Record<string, unknown>
): Promise<{ success: boolean; data?: unknown; error?: string }> {
  try {
    const response = await fetch(`${baseUrl}${endpoint}`, {
      method,
      headers: {
        "Authorization": `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const data = await response.json();

    if (response.ok) {
      return { success: true, data };
    } else if (response.status === 401) {
      return { success: false, error: "Неверный API токен Kinescope" };
    } else if (response.status === 403) {
      return { success: false, error: "Доступ запрещён" };
    } else if (response.status === 404) {
      return { success: false, error: "Ресурс не найден" };
    } else {
      return { 
        success: false, 
        error: data.message || data.error || `HTTP ${response.status}` 
      };
    }
  } catch (e) {
    console.error("Kinescope API error:", e);
    return { 
      success: false, 
      error: e instanceof Error ? e.message : "Ошибка подключения к Kinescope" 
    };
  }
}

// Shorthand for v1 requests (existing flow)
function makeV1Request(endpoint: string, apiToken: string, method = "GET", body?: Record<string, unknown>) {
  return makeRequest(KINESCOPE_API_V1, endpoint, apiToken, method, body);
}

// v2 requests for live events
function makeV2Request(endpoint: string, apiToken: string, method = "GET", body?: Record<string, unknown>) {
  return makeRequest(KINESCOPE_API_V2, endpoint, apiToken, method, body);
}

async function getApiTokenFromDb(
  supabaseUrl: string,
  supabaseKey: string,
  instanceId: string
): Promise<string | null> {
  const supabaseClient = createClient(supabaseUrl, supabaseKey);
  const { data: instance } = await supabaseClient
    .from("integration_instances")
    .select("config")
    .eq("id", instanceId)
    .single();
  
  if (instance && instance.config) {
    const config = instance.config as Record<string, unknown>;
    return (config.api_token as string) || null;
  }
  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const request: KinescopeRequest = await req.json();
    const { action, instance_id, api_token: directToken, project_id, video_id, live_event_id, page = 1, per_page = 100 } = request;

    console.log(`Kinescope API action: ${action}`);

    // Get API token
    let apiToken = directToken || null;
    if (!apiToken && instance_id) {
      apiToken = await getApiTokenFromDb(supabaseUrl, supabaseKey, instance_id);
    }
    
    if (!apiToken) {
      return new Response(
        JSON.stringify({ success: false, error: "API токен не найден" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    let result: { success: boolean; data?: unknown; error?: string; projects?: unknown[]; videos?: unknown[] };

    switch (action) {
      // ==================== V1 ACTIONS (existing) ====================
      
      case "validate_token": {
        const projectsResult = await makeV1Request("/projects", apiToken);
        if (projectsResult.success) {
          const projectsData = projectsResult.data as { data?: { id: string; name: string }[] };
          const projects = projectsData.data || [];
          result = {
            success: true,
            projects: projects.map((p) => ({ id: p.id, name: p.name })),
          };
        } else {
          result = projectsResult;
        }
        break;
      }

      case "list_projects": {
        const projectsResult = await makeV1Request(`/projects?page=${page}&per_page=${per_page}`, apiToken);
        if (projectsResult.success) {
          const projectsData = projectsResult.data as { data?: unknown[]; pagination?: unknown };
          result = {
            success: true,
            projects: projectsData.data || [],
            data: { pagination: projectsData.pagination },
          };
        } else {
          result = projectsResult;
        }
        break;
      }

      case "list_videos": {
        const params = new URLSearchParams({ page: String(page), per_page: String(per_page) });
        if (project_id) params.set("project_id", project_id);
        const endpoint = `/videos?${params.toString()}`;
        const videosResult = await makeV1Request(endpoint, apiToken);
        if (videosResult.success) {
          const videosData = videosResult.data as { data?: unknown[]; pagination?: unknown };
          result = {
            success: true,
            videos: videosData.data || [],
            data: { pagination: videosData.pagination },
          };
        } else {
          result = videosResult;
        }
        break;
      }

      case "get_video": {
        if (!video_id) {
          result = { success: false, error: "video_id обязателен" };
          break;
        }
        result = await makeV1Request(`/videos/${video_id}`, apiToken);
        break;
      }

      case "get_embed_code": {
        if (!video_id) {
          result = { success: false, error: "video_id обязателен" };
          break;
        }
        const embedUrl = `https://kinescope.io/embed/${video_id}`;
        result = {
          success: true,
          data: {
            video_id,
            embed_url: embedUrl,
            iframe: `<iframe src="${embedUrl}" width="100%" height="100%" frameborder="0" allow="autoplay; fullscreen; picture-in-picture; encrypted-media; gyroscope; accelerometer; clipboard-write;" allowfullscreen></iframe>`,
          },
        };
        break;
      }

      // ==================== V2 LIVE ACTIONS (new) ====================

      case "create_live_event": {
        if (!project_id) {
          result = { success: false, error: "project_id обязателен" };
          break;
        }
        const body: Record<string, unknown> = {
          name: request.name || "Новый эфир",
          project_id,
          type: request.type || "webinar",
          record: request.record !== false, // default true
        };
        result = await makeV2Request("/live/events", apiToken, "POST", body);
        break;
      }

      case "get_live_event": {
        if (!live_event_id) {
          result = { success: false, error: "live_event_id обязателен" };
          break;
        }
        result = await makeV2Request(`/live/events/${live_event_id}`, apiToken);
        break;
      }

      case "list_live_events": {
        const params = new URLSearchParams({ page: String(page), per_page: String(per_page) });
        if (project_id) params.set("project_id", project_id);
        result = await makeV2Request(`/live/events?${params.toString()}`, apiToken);
        break;
      }

      case "enable_live_event": {
        if (!live_event_id) {
          result = { success: false, error: "live_event_id обязателен" };
          break;
        }
        result = await makeV2Request(`/live/events/${live_event_id}/enable`, apiToken, "PUT");
        break;
      }

      case "complete_live_event": {
        if (!live_event_id) {
          result = { success: false, error: "live_event_id обязателен" };
          break;
        }
        result = await makeV2Request(`/live/events/${live_event_id}/complete`, apiToken, "PUT");
        break;
      }

      case "get_live_event_videos": {
        if (!live_event_id) {
          result = { success: false, error: "live_event_id обязателен" };
          break;
        }
        result = await makeV2Request(`/live/events/${live_event_id}/videos`, apiToken);
        break;
      }

      case "sync_live_event": {
        // Sync provider status: get event details + videos (replay check)
        if (!live_event_id) {
          result = { success: false, error: "live_event_id обязателен" };
          break;
        }
        const eventResult = await makeV2Request(`/live/events/${live_event_id}`, apiToken);
        const videosResult = await makeV2Request(`/live/events/${live_event_id}/videos`, apiToken);
        result = {
          success: eventResult.success,
          data: {
            event: eventResult.data,
            videos: videosResult.success ? videosResult.data : null,
            error: eventResult.error || videosResult.error || null,
          },
        };
        break;
      }

      default:
        result = { success: false, error: `Неизвестное действие: ${action}` };
    }

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );
  } catch (error) {
    console.error("Kinescope API error:", error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error instanceof Error ? error.message : "Внутренняя ошибка" 
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
