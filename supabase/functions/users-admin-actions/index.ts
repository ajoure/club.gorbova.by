import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface AdminActionRequest {
  action: "block" | "unblock" | "delete" | "reset_password" | "force_logout" | "impersonate_start" | "impersonate_stop";
  targetUserId?: string;
  email?: string;
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Get the JWT from the request
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Create client with user's JWT to get their ID
    const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user: actorUser }, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !actorUser) {
      console.error("Auth error:", userError);
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const actorUserId = actorUser.id;

    // Create admin client with service role
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    const { action, targetUserId, email }: AdminActionRequest = await req.json();
    console.log(`Action: ${action}, Actor: ${actorUserId}, Target: ${targetUserId || email}`);

    // Helper function to check permission
    const hasPermission = async (permissionCode: string): Promise<boolean> => {
      const { data, error } = await supabaseAdmin.rpc("has_permission", {
        _user_id: actorUserId,
        _permission_code: permissionCode,
      });
      if (error) {
        console.error("Permission check error:", error);
        return false;
      }
      return data === true;
    };

    // Helper function to check if target is super_admin
    const isTargetSuperAdmin = async (userId: string): Promise<boolean> => {
      const { data, error } = await supabaseAdmin.rpc("is_super_admin", {
        _user_id: userId,
      });
      if (error) {
        console.error("Super admin check error:", error);
        return false;
      }
      return data === true;
    };

    // Helper function to check if actor is super_admin
    const isActorSuperAdmin = async (): Promise<boolean> => {
      return await isTargetSuperAdmin(actorUserId);
    };

    // Helper function to log action
    const logAction = async (actionType: string, targetId: string | null, meta: Record<string, unknown> = {}) => {
      await supabaseAdmin.from("audit_logs").insert({
        actor_user_id: actorUserId,
        action: actionType,
        target_user_id: targetId,
        meta,
      });
    };

    // Handle different actions
    switch (action) {
      case "block": {
        if (!targetUserId) {
          return new Response(JSON.stringify({ error: "targetUserId required" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        if (!(await hasPermission("users.block"))) {
          return new Response(JSON.stringify({ error: "Permission denied" }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Prevent blocking super_admin unless actor is super_admin
        if (await isTargetSuperAdmin(targetUserId) && !(await isActorSuperAdmin())) {
          return new Response(JSON.stringify({ error: "Cannot block super admin" }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const { error: updateError } = await supabaseAdmin
          .from("profiles")
          .update({ status: "blocked" })
          .eq("user_id", targetUserId);

        if (updateError) {
          console.error("Block error:", updateError);
          return new Response(JSON.stringify({ error: "Failed to block user" }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        await logAction("users.block", targetUserId);
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "unblock": {
        if (!targetUserId) {
          return new Response(JSON.stringify({ error: "targetUserId required" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        if (!(await hasPermission("users.block"))) {
          return new Response(JSON.stringify({ error: "Permission denied" }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const { error: updateError } = await supabaseAdmin
          .from("profiles")
          .update({ status: "active" })
          .eq("user_id", targetUserId);

        if (updateError) {
          console.error("Unblock error:", updateError);
          return new Response(JSON.stringify({ error: "Failed to unblock user" }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        await logAction("users.unblock", targetUserId);
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "delete": {
        if (!targetUserId) {
          return new Response(JSON.stringify({ error: "targetUserId required" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        if (!(await hasPermission("users.delete"))) {
          return new Response(JSON.stringify({ error: "Permission denied" }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Prevent deleting super_admin unless actor is super_admin
        if (await isTargetSuperAdmin(targetUserId) && !(await isActorSuperAdmin())) {
          return new Response(JSON.stringify({ error: "Cannot delete super admin" }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Soft delete - just set status
        const { error: updateError } = await supabaseAdmin
          .from("profiles")
          .update({ status: "deleted" })
          .eq("user_id", targetUserId);

        if (updateError) {
          console.error("Delete error:", updateError);
          return new Response(JSON.stringify({ error: "Failed to delete user" }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        await logAction("users.delete", targetUserId);
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "reset_password": {
        if (!email) {
          return new Response(JSON.stringify({ error: "email required" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        if (!(await hasPermission("users.reset_password"))) {
          return new Response(JSON.stringify({ error: "Permission denied" }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const { error: resetError } = await supabaseAdmin.auth.resetPasswordForEmail(email, {
          redirectTo: `${req.headers.get("origin") || supabaseUrl}/auth?mode=reset`,
        });

        if (resetError) {
          console.error("Reset password error:", resetError);
          return new Response(JSON.stringify({ error: "Failed to send reset email" }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        await logAction("users.reset_password", targetUserId || null, { email });
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "force_logout": {
        if (!targetUserId) {
          return new Response(JSON.stringify({ error: "targetUserId required" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        if (!(await hasPermission("users.block"))) {
          return new Response(JSON.stringify({ error: "Permission denied" }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Sign out user from all sessions
        const { error: signOutError } = await supabaseAdmin.auth.admin.signOut(targetUserId, "global");

        if (signOutError) {
          console.error("Force logout error:", signOutError);
          return new Response(JSON.stringify({ error: "Failed to force logout" }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        await logAction("users.force_logout", targetUserId);
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "impersonate_start": {
        if (!targetUserId) {
          return new Response(JSON.stringify({ error: "targetUserId required" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        if (!(await hasPermission("users.impersonate"))) {
          return new Response(JSON.stringify({ error: "Permission denied" }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Prevent impersonating super_admin unless actor is super_admin
        if (await isTargetSuperAdmin(targetUserId) && !(await isActorSuperAdmin())) {
          return new Response(JSON.stringify({ error: "Cannot impersonate super admin" }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Generate a unique token
        const token = crypto.randomUUID();
        const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

        const { error: insertError } = await supabaseAdmin
          .from("impersonation_sessions")
          .insert({
            actor_user_id: actorUserId,
            target_user_id: targetUserId,
            token,
            expires_at: expiresAt.toISOString(),
          });

        if (insertError) {
          console.error("Impersonation start error:", insertError);
          return new Response(JSON.stringify({ error: "Failed to start impersonation" }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        await logAction("impersonate.start", targetUserId);
        return new Response(JSON.stringify({ success: true, token, expiresAt: expiresAt.toISOString() }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "impersonate_stop": {
        // End all active impersonation sessions for the actor
        const { error: updateError } = await supabaseAdmin
          .from("impersonation_sessions")
          .update({ ended_at: new Date().toISOString() })
          .eq("actor_user_id", actorUserId)
          .is("ended_at", null);

        if (updateError) {
          console.error("Impersonation stop error:", updateError);
          return new Response(JSON.stringify({ error: "Failed to stop impersonation" }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        await logAction("impersonate.stop", null);
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      default:
        return new Response(JSON.stringify({ error: "Unknown action" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }
  } catch (error: unknown) {
    console.error("Error in users-admin-actions:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
