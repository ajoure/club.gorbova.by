import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface RolesAdminRequest {
  action: "assign_role" | "remove_role" | "create_role" | "set_role_permissions" | "delete_role" | "search_users";
  userId?: string;
  roleCode?: string;
  roleId?: string;
  roleName?: string;
  roleDescription?: string;
  permissionCodes?: string[];
  query?: string;  // for search_users
  limit?: number;  // for search_users (default 20)
}

async function sendRoleChangeEmail(
  supabaseUrl: string,
  anonKey: string,
  userEmail: string,
  roleName: string,
  isAssign: boolean
): Promise<void> {
  try {

    const subject = isAssign
      ? `Вам назначена роль: ${roleName}`
      : `Роль удалена: ${roleName}`;

    const html = isAssign
      ? `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #1a56db;">Уведомление об изменении роли</h2>
          <p>Здравствуйте!</p>
          <p>Вам была назначена новая роль: <strong>${roleName}</strong></p>
          <p>Это изменение вступает в силу немедленно. Если у вас есть вопросы, свяжитесь с администратором.</p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
          <p style="color: #666; font-size: 12px;">С уважением,<br>Команда Буква Закона</p>
        </div>
      `
      : `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #1a56db;">Уведомление об изменении роли</h2>
          <p>Здравствуйте!</p>
          <p>Ваша роль <strong>${roleName}</strong> была удалена.</p>
          <p>Это изменение вступает в силу немедленно. Если у вас есть вопросы, свяжитесь с администратором.</p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
          <p style="color: #666; font-size: 12px;">С уважением,<br>Команда Буква Закона</p>
        </div>
      `;

    const response = await fetch(`${supabaseUrl}/functions/v1/send-email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${anonKey}`,
      },
      body: JSON.stringify({
        to: userEmail,
        subject,
        html,
        text: isAssign
          ? `Вам была назначена новая роль: ${roleName}`
          : `Ваша роль ${roleName} была удалена.`,
      }),
    });

    if (!response.ok) {
      console.error("Failed to send role change email:", await response.text());
    } else {
      console.log(`Role change email sent to ${userEmail}`);
    }
  } catch (error) {
    console.error("Error sending role change email:", error);
  }
}

// Send Telegram notifications for role changes using existing edge functions
async function sendRoleTelegramNotification(
  supabaseUrl: string,
  supabaseServiceKey: string,
  targetUserId: string,
  roleName: string,
  isAssign: boolean,
  actorEmail: string
): Promise<void> {
  try {
    // Send notification to user via telegram-send-notification function
    // This function handles finding the user's telegram_user_id and bot token internally
    try {
      const userMessage = isAssign
        ? `✅ Вам назначена роль: ${roleName}`
        : `❌ Роль ${roleName} была снята`;
      
      await fetch(`${supabaseUrl}/functions/v1/telegram-send-notification`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${supabaseServiceKey}`,
        },
        body: JSON.stringify({
          user_id: targetUserId,
          message_type: "custom",
          custom_message: userMessage,
        }),
      });
      console.log(`Telegram notification sent to user ${targetUserId}`);
    } catch (err) {
      // User might not have Telegram linked - that's OK
      console.log("Could not send Telegram to user (may not have TG linked):", err);
    }

    // Notify admins via telegram-notify-admins function
    try {
      await fetch(`${supabaseUrl}/functions/v1/telegram-notify-admins`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${supabaseServiceKey}`,
        },
        body: JSON.stringify({
          message: `👤 <b>Изменение роли</b>\n\n` +
            `${isAssign ? '✅ Назначена' : '❌ Удалена'}: ${roleName}\n` +
            `Исполнитель: ${actorEmail}`,
          parse_mode: 'HTML',
        }),
      });
      console.log("Admin notification sent");
    } catch (err) {
      console.error("Error sending admin notification:", err);
    }
  } catch (error) {
    console.error("Error sending role Telegram notification:", error);
    // Don't throw - notifications are non-critical
  }
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Get the JWT from the request
    const authHeader = req.headers.get("authorization") ?? req.headers.get("Authorization");
    const match = authHeader?.match(/^Bearer\s+(.+)$/i);
    const token = match?.[1]?.trim();

    if (!token) {
      return new Response(JSON.stringify({ error: "Invalid authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Create admin client with service role
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });

    // Get user from the token
    const {
      data: { user: actorUser },
      error: userError,
    } = await supabaseAdmin.auth.getUser(token);

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

    // Helper functions
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

    const isActorSuperAdmin = async (): Promise<boolean> => {
      return await isTargetSuperAdmin(actorUserId);
    };

    // Get super_admin role ID for counting
    const getSuperAdminRoleId = async (): Promise<string | null> => {
      const { data } = await supabaseAdmin
        .from("roles")
        .select("id")
        .eq("code", "super_admin")
        .single();
      return data?.id || null;
    };

    // Count how many super_admins exist
    const countSuperAdmins = async (): Promise<number> => {
      const superAdminRoleId = await getSuperAdminRoleId();
      if (!superAdminRoleId) return 0;

      const { count } = await supabaseAdmin
        .from("user_roles_v2")
        .select("*", { count: "exact", head: true })
        .eq("role_id", superAdminRoleId);
      
      return count || 0;
    };

    const logAction = async (actionType: string, targetId: string | null, meta: Record<string, unknown> = {}) => {
      await supabaseAdmin.from("audit_logs").insert({
        actor_user_id: actorUserId,
        action: actionType,
        target_user_id: targetId,
        meta,
      });
    };

    const getUserEmail = async (targetUserId: string): Promise<string | null> => {
      const { data, error } = await supabaseAdmin
        .from("profiles")
        .select("email")
        .eq("user_id", targetUserId)
        .single();
      if (error || !data?.email) {
        console.error("Failed to get user email:", error);
        return null;
      }
      return data.email;
    };

    const getRoleName = async (code: string): Promise<string> => {
      const { data } = await supabaseAdmin
        .from("roles")
        .select("name")
        .eq("code", code)
        .single();
      return data?.name || code;
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

        // SAFEGUARD: Prevent self-role change
        if (userId === actorUserId) {
          return new Response(JSON.stringify({ error: "SELF_ROLE_CHANGE_FORBIDDEN" }), {
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

        // SAFEGUARD: Last owner protection - if target is super_admin and we're changing their role
        if (await isTargetSuperAdmin(userId) && roleCode !== "super_admin") {
          const superAdminCount = await countSuperAdmins();
          if (superAdminCount <= 1) {
            return new Response(JSON.stringify({ error: "LAST_OWNER_PROTECTED" }), {
              status: 409,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
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

        // SINGLE ROLE MODEL: Delete ALL existing roles for this user first
        const { error: deleteError } = await supabaseAdmin
          .from("user_roles_v2")
          .delete()
          .eq("user_id", userId);

        if (deleteError) {
          console.error("Delete existing roles error:", deleteError);
          // Continue anyway - we want to assign the new role
        }

        // If assigning "user" role, don't insert anything - user with no roles = regular user
        if (roleCode === "user") {
          await logAction("roles.assign", userId, { roleCode, previousRolesRemoved: true });
          return new Response(JSON.stringify({ success: true, message: "User role set (no explicit role needed)" }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Insert the new role
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

        // Send email notification
        const userEmail = await getUserEmail(userId);
        if (userEmail) {
          const roleDisplayName = await getRoleName(roleCode);
          await sendRoleChangeEmail(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY") || "", userEmail, roleDisplayName, true);
          
          // Send Telegram notifications
          const actorEmail = await getUserEmail(actorUserId);
          await sendRoleTelegramNotification(
            supabaseUrl,
            supabaseServiceKey,
            userId,
            roleDisplayName,
            true,
            actorEmail || 'Admin'
          );
        }

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

        // SAFEGUARD: Prevent self-role change
        if (userId === actorUserId) {
          return new Response(JSON.stringify({ error: "SELF_ROLE_CHANGE_FORBIDDEN" }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Prevent removing super_admin unless actor is super_admin
        if (roleCode === "super_admin" && !(await isActorSuperAdmin())) {
          return new Response(JSON.stringify({ error: "Only super admin can remove super admin role" }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // SAFEGUARD: Last owner protection
        if (roleCode === "super_admin") {
          const superAdminCount = await countSuperAdmins();
          if (superAdminCount <= 1) {
            return new Response(JSON.stringify({ error: "LAST_OWNER_PROTECTED" }), {
              status: 409,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
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

        // SINGLE ROLE MODEL: Just delete all roles - user becomes regular "user"
        const { error: deleteError } = await supabaseAdmin
          .from("user_roles_v2")
          .delete()
          .eq("user_id", userId);

        if (deleteError) {
          console.error("Remove role error:", deleteError);
          return new Response(JSON.stringify({ error: "Failed to remove role" }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        await logAction("roles.remove", userId, { roleCode });

        // Send email notification
        const userEmail = await getUserEmail(userId);
        if (userEmail) {
          const roleDisplayName = await getRoleName(roleCode);
          await sendRoleChangeEmail(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY") || "", userEmail, roleDisplayName, false);
          
          // Send Telegram notifications
          const actorEmail = await getUserEmail(actorUserId);
          await sendRoleTelegramNotification(
            supabaseUrl,
            supabaseServiceKey,
            userId,
            roleDisplayName,
            false,
            actorEmail || 'Admin'
          );
        }

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

        if (role.code === "super_admin" && !(await isActorSuperAdmin())) {
          return new Response(JSON.stringify({ error: "Cannot modify super admin permissions" }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Delete existing permissions
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

      case "search_users": {
        const { query, limit = 20 } = body as RolesAdminRequest & { query?: string; limit?: number };

        if (!(await hasPermission("admins.manage"))) {
          return new Response(JSON.stringify({ error: "Permission denied" }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        if (!query || query.trim().length < 2) {
          return new Response(JSON.stringify([]), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const searchTerm = `%${query.trim()}%`;

        // Step 1: Search profiles
        const { data: profiles, error: searchError } = await supabaseAdmin
          .from("profiles")
          .select(`
            user_id,
            full_name,
            email,
            phone
          `)
          .or(`email.ilike.${searchTerm},full_name.ilike.${searchTerm},phone.ilike.${searchTerm}`)
          .neq("user_id", actorUserId)
          .limit(limit);

        if (searchError) {
          console.error("Search profiles error:", searchError);
          return new Response(JSON.stringify({ error: "Search failed" }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Step 2: Get user_roles_v2 records for found users (2-step approach, no join magic)
        const userIds = profiles?.map(p => p.user_id) || [];
        let userRolesMap: Record<string, string> = {};

        if (userIds.length > 0) {
          // Get user_roles_v2 records
          const { data: userRolesRaw, error: userRolesError } = await supabaseAdmin
            .from("user_roles_v2")
            .select("user_id, role_id")
            .in("user_id", userIds);

          if (userRolesError) {
            console.error("User roles query error:", userRolesError);
          }

          // Step 3: Get role codes by role_ids
          const roleIds = [...new Set((userRolesRaw || []).map(ur => ur.role_id))];
          let roleCodesMap: Record<string, string> = {};

          if (roleIds.length > 0) {
            const { data: rolesData, error: rolesError } = await supabaseAdmin
              .from("roles")
              .select("id, code")
              .in("id", roleIds);

            if (rolesError) {
              console.error("Roles query error:", rolesError);
            }

            roleCodesMap = (rolesData || []).reduce((acc, r) => {
              acc[r.id] = r.code;
              return acc;
            }, {} as Record<string, string>);
          }

          // Build userRolesMap: user_id -> role_code
          userRolesMap = (userRolesRaw || []).reduce((acc, ur) => {
            acc[ur.user_id] = roleCodesMap[ur.role_id] || "user";
            return acc;
          }, {} as Record<string, string>);
        }

        // Combine profiles with roles
        const result = profiles?.map(p => ({
          user_id: p.user_id,
          full_name: p.full_name,
          email: p.email,
          phone: p.phone,
          role_code: userRolesMap[p.user_id] || "user",
        })) || [];

        return new Response(JSON.stringify(result), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "delete_role": {
        if (!roleId) {
          return new Response(JSON.stringify({ error: "roleId required" }), {
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

        // Get role to check if it's super_admin or user
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

        // Prevent deleting system roles
        const systemRoles = ["super_admin", "admin", "user", "support", "editor"];
        if (systemRoles.includes(role.code)) {
          return new Response(JSON.stringify({ error: "Cannot delete system role" }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Check if role is assigned to any users
        const { data: assignments, error: assignError } = await supabaseAdmin
          .from("user_roles_v2")
          .select("id")
          .eq("role_id", roleId)
          .limit(1);

        if (assignError) {
          console.error("Check role assignments error:", assignError);
        }

        if (assignments && assignments.length > 0) {
          return new Response(JSON.stringify({ error: "Role is assigned to users. Remove role from all users first." }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Delete role permissions first
        await supabaseAdmin
          .from("role_permissions")
          .delete()
          .eq("role_id", roleId);

        // Delete role
        const { error: deleteError } = await supabaseAdmin
          .from("roles")
          .delete()
          .eq("id", roleId);

        if (deleteError) {
          console.error("Delete role error:", deleteError);
          return new Response(JSON.stringify({ error: "Failed to delete role" }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        await logAction("roles.delete", null, { roleId, roleCode: role.code });
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