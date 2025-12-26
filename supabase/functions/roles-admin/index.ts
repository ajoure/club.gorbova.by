import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface RolesAdminRequest {
  action: "assign_role" | "remove_role" | "create_role" | "set_role_permissions";
  userId?: string;
  roleCode?: string;
  roleId?: string;
  roleName?: string;
  roleDescription?: string;
  permissionCodes?: string[];
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

    // Extract the token from Bearer header
    const token = authHeader.replace("Bearer ", "");
    
    // Create admin client with service role to verify the token
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
    
    // Get user from the token
    const { data: { user: actorUser }, error: userError } = await supabaseAdmin.auth.getUser(token);
    if (userError || !actorUser) {
      console.error("Auth error:", userError);
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const actorUserId = actorUser.id;


    const body: RolesAdminRequest = await req.json();
    const { action, userId, roleCode, roleId, roleName, roleDescription, permissionCodes } = body;
    console.log(`Action: ${action}, Actor: ${actorUserId}`);

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
    const isTargetSuperAdmin = async (targetUserId: string): Promise<boolean> => {
      const { data, error } = await supabaseAdmin.rpc("is_super_admin", {
        _user_id: targetUserId,
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

    switch (action) {
      case "assign_role": {
        if (!userId || !roleCode) {
          return new Response(JSON.stringify({ error: "userId and roleCode required" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        if (!(await hasPermission("admins.manage"))) {
          return new Response(JSON.stringify({ error: "Permission denied" }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Prevent assigning super_admin unless actor is super_admin
        if (roleCode === "super_admin" && !(await isActorSuperAdmin())) {
          return new Response(JSON.stringify({ error: "Only super admin can assign super admin role" }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Get role ID
        const { data: role, error: roleError } = await supabaseAdmin
          .from("roles")
          .select("id")
          .eq("code", roleCode)
          .single();

        if (roleError || !role) {
          return new Response(JSON.stringify({ error: "Role not found" }), {
            status: 404,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const { error: insertError } = await supabaseAdmin
          .from("user_roles_v2")
          .insert({ user_id: userId, role_id: role.id });

        if (insertError) {
          console.error("Assign role error:", insertError);
          return new Response(JSON.stringify({ error: "Failed to assign role" }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        await logAction("roles.assign", userId, { roleCode });
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "remove_role": {
        if (!userId || !roleCode) {
          return new Response(JSON.stringify({ error: "userId and roleCode required" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        if (!(await hasPermission("admins.manage"))) {
          return new Response(JSON.stringify({ error: "Permission denied" }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Prevent removing super_admin from others unless actor is super_admin
        if (roleCode === "super_admin" && !(await isActorSuperAdmin())) {
          return new Response(JSON.stringify({ error: "Only super admin can remove super admin role" }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Get role ID
        const { data: role, error: roleError } = await supabaseAdmin
          .from("roles")
          .select("id")
          .eq("code", roleCode)
          .single();

        if (roleError || !role) {
          return new Response(JSON.stringify({ error: "Role not found" }), {
            status: 404,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const { error: deleteError } = await supabaseAdmin
          .from("user_roles_v2")
          .delete()
          .eq("user_id", userId)
          .eq("role_id", role.id);

        if (deleteError) {
          console.error("Remove role error:", deleteError);
          return new Response(JSON.stringify({ error: "Failed to remove role" }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        await logAction("roles.remove", userId, { roleCode });
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "create_role": {
        if (!roleCode || !roleName) {
          return new Response(JSON.stringify({ error: "roleCode and roleName required" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        if (!(await hasPermission("roles.manage"))) {
          return new Response(JSON.stringify({ error: "Permission denied" }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const { data: newRole, error: insertError } = await supabaseAdmin
          .from("roles")
          .insert({ code: roleCode, name: roleName, description: roleDescription })
          .select()
          .single();

        if (insertError) {
          console.error("Create role error:", insertError);
          return new Response(JSON.stringify({ error: "Failed to create role" }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        await logAction("roles.create", null, { roleCode, roleName });
        return new Response(JSON.stringify({ success: true, role: newRole }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "set_role_permissions": {
        if (!roleId || !permissionCodes) {
          return new Response(JSON.stringify({ error: "roleId and permissionCodes required" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        if (!(await hasPermission("roles.manage"))) {
          return new Response(JSON.stringify({ error: "Permission denied" }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Get role to check if it's super_admin
        const { data: role, error: roleError } = await supabaseAdmin
          .from("roles")
          .select("code")
          .eq("id", roleId)
          .single();

        if (roleError || !role) {
          return new Response(JSON.stringify({ error: "Role not found" }), {
            status: 404,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Prevent modifying super_admin permissions unless actor is super_admin
        if (role.code === "super_admin" && !(await isActorSuperAdmin())) {
          return new Response(JSON.stringify({ error: "Cannot modify super admin permissions" }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Delete existing permissions for this role
        await supabaseAdmin
          .from("role_permissions")
          .delete()
          .eq("role_id", roleId);

        // Get permission IDs
        const { data: permissions, error: permError } = await supabaseAdmin
          .from("permissions")
          .select("id, code")
          .in("code", permissionCodes);

        if (permError) {
          console.error("Get permissions error:", permError);
          return new Response(JSON.stringify({ error: "Failed to get permissions" }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Insert new permissions
        const rolePermissions = permissions.map((p) => ({
          role_id: roleId,
          permission_id: p.id,
        }));

        if (rolePermissions.length > 0) {
          const { error: insertError } = await supabaseAdmin
            .from("role_permissions")
            .insert(rolePermissions);

          if (insertError) {
            console.error("Set permissions error:", insertError);
            return new Response(JSON.stringify({ error: "Failed to set permissions" }), {
              status: 500,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
        }

        await logAction("roles.set_permissions", null, { roleId, permissionCodes });
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
    console.error("Error in roles-admin:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
