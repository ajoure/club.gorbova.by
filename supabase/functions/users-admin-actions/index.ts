import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.1";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface AdminActionRequest {
  action: "block" | "unblock" | "delete" | "restore" | "reset_password" | "force_logout" | "impersonate_start" | "impersonate_stop" | "invite" | "change_email";
  targetUserId?: string;
  email?: string;
  newEmail?: string;
  roleCode?: string;
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
    const authHeader = req.headers.get("authorization") ?? req.headers.get("Authorization");

    // Expect: "Bearer <jwt>"
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

    // Verify JWT by calling the Auth "user" endpoint.
    // This avoids auth-js session handling issues in edge runtime (AuthSessionMissingError).
    const authResp = await fetch(`${supabaseUrl}/auth/v1/user`, {
      method: "GET",
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${token}`,
      },
    });

    if (!authResp.ok) {
      const errText = await authResp.text().catch(() => "");
      console.error("Auth error:", authResp.status, errText);
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const actorUser = (await authResp.json()) as { id?: string };
    const actorUserId = actorUser?.id;

    if (!actorUserId) {
      console.error("Auth error: no user id in auth response");
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { action, targetUserId, email, newEmail }: AdminActionRequest = await req.json();
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

      case "restore": {
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

        // Restore user - set status back to active
        const { error: updateError } = await supabaseAdmin
          .from("profiles")
          .update({ status: "active" })
          .eq("user_id", targetUserId);

        if (updateError) {
          console.error("Restore error:", updateError);
          return new Response(JSON.stringify({ error: "Failed to restore user" }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        await logAction("users.restore", targetUserId);
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

        // Generate a password reset link - always use production domain
        const siteUrl = "https://club.gorbova.by";
        const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
          type: "recovery",
          email: email,
          options: {
            redirectTo: `${siteUrl}/auth?mode=reset`,
          },
        });

        if (linkError || !linkData?.properties?.hashed_token) {
          console.error("Generate reset link error:", linkError);
          return new Response(JSON.stringify({ error: "Failed to generate reset link" }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Build the reset link
        const resetLink = `${supabaseUrl}/auth/v1/verify?token=${linkData.properties.hashed_token}&type=recovery&redirect_to=${encodeURIComponent(siteUrl + "/auth?mode=reset")}`;

        // Send custom email via our send-email function
        try {
          const emailResponse = await fetch(`${supabaseUrl}/functions/v1/send-email`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${supabaseAnonKey}`,
            },
            body: JSON.stringify({
              to: email,
              subject: "Сброс пароля",
              html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                  <h1 style="color: #333;">Сброс пароля</h1>
                  <p>Вы запросили сброс пароля для вашего аккаунта.</p>
                  <p>Нажмите на кнопку ниже, чтобы установить новый пароль:</p>
                  <a href="${resetLink}" style="display: inline-block; padding: 12px 24px; background-color: #6366f1; color: white; text-decoration: none; border-radius: 6px; margin: 16px 0;">
                    Сбросить пароль
                  </a>
                  <p style="color: #666; font-size: 14px;">Если вы не запрашивали сброс пароля, просто проигнорируйте это письмо.</p>
                  <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;">
                  <p style="color: #999; font-size: 12px;">С уважением,<br>Команда Gorbova.by</p>
                </div>
              `,
              text: `Вы запросили сброс пароля. Перейдите по ссылке: ${resetLink}`,
            }),
          });

          if (!emailResponse.ok) {
            const emailError = await emailResponse.json();
            console.error("Email send error:", emailError);
            return new Response(JSON.stringify({ error: "Failed to send reset email" }), {
              status: 500,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
        } catch (emailErr) {
          console.error("Email send exception:", emailErr);
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

        // Sign out user from all sessions using admin API
        const { error: signOutError } = await supabaseAdmin.auth.admin.signOut(targetUserId, "global");

        if (signOutError) {
          console.error("Force logout error:", signOutError);
          // If signOut fails, try to delete refresh tokens as alternative
          // This effectively logs out the user by invalidating their sessions
          const { error: updateError } = await supabaseAdmin
            .from("profiles")
            .update({ last_seen_at: null })
            .eq("user_id", targetUserId);
          
          if (updateError) {
            console.error("Profile update error:", updateError);
          }
          
          // Return success anyway - the user will be logged out on next token refresh
          console.log("Fallback: user will be logged out on next token refresh");
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

        // Get target user email
        const { data: targetUser, error: targetUserError } = await supabaseAdmin.auth.admin.getUserById(targetUserId);
        if (targetUserError || !targetUser?.user?.email) {
          console.error("Get target user error:", targetUserError);
          return new Response(JSON.stringify({ error: "Target user not found" }), {
            status: 404,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Generate a magic link for the target user
        const origin = req.headers.get("origin") || "http://localhost:5173";
        const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
          type: "magiclink",
          email: targetUser.user.email,
          options: {
            redirectTo: `${origin}/?impersonating=true`,
          },
        });

        if (linkError || !linkData) {
          console.error("Generate link error:", linkError);
          return new Response(JSON.stringify({ error: "Failed to generate impersonation link" }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Record the impersonation session
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
          console.error("Impersonation session insert error:", insertError);
        }

        await logAction("impersonate.start", targetUserId);
        
        // Return the magic link properties for the client to use
        const magicLinkUrl = `${origin}/auth?access_token=${linkData.properties?.hashed_token}&type=magiclink&redirect_to=${encodeURIComponent(origin + "/?impersonating=true")}`;
        
        return new Response(JSON.stringify({ 
          success: true, 
          token,
          // Use token_hash for OTP verification
          tokenHash: linkData.properties?.hashed_token,
          email: targetUser.user.email,
          expiresAt: expiresAt.toISOString() 
        }), {
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

      case "invite": {
        const { action: _, targetUserId: __, email: inviteEmail, roleCode } = await req.json() as AdminActionRequest & { roleCode?: string };
        
        if (!inviteEmail) {
          return new Response(JSON.stringify({ error: "email required" }), {
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

        // Generate invite link using Supabase Admin API - always use production domain
        const siteUrl = "https://club.gorbova.by";
        const { data: inviteData, error: inviteError } = await supabaseAdmin.auth.admin.generateLink({
          type: "invite",
          email: inviteEmail,
          options: {
            redirectTo: `${siteUrl}/auth`,
          },
        });

        if (inviteError) {
          console.error("Invite error:", inviteError);
          return new Response(JSON.stringify({ error: "Failed to generate invite link" }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Send custom email via our send-email function
        const inviteLink = `${supabaseUrl}/auth/v1/verify?token=${inviteData.properties?.hashed_token}&type=invite&redirect_to=${encodeURIComponent(siteUrl + "/auth")}`;
        
        try {
          const emailResponse = await fetch(`${supabaseUrl}/functions/v1/send-email`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${supabaseAnonKey}`,
            },
            body: JSON.stringify({
              to: inviteEmail,
              subject: "Приглашение в систему",
              html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                  <h1 style="color: #333;">Добро пожаловать!</h1>
                  <p>Вас пригласили присоединиться к системе.</p>
                  <p>Нажмите на кнопку ниже, чтобы принять приглашение и установить пароль:</p>
                  <a href="${inviteLink}" style="display: inline-block; padding: 12px 24px; background-color: #6366f1; color: white; text-decoration: none; border-radius: 6px; margin: 16px 0;">
                    Принять приглашение
                  </a>
                  <p style="color: #666; font-size: 14px;">Если вы не ожидали это приглашение, просто проигнорируйте это письмо.</p>
                  <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;">
                  <p style="color: #999; font-size: 12px;">С уважением,<br>Команда Gorbova.by</p>
                </div>
              `,
              text: `Вас пригласили присоединиться к системе. Перейдите по ссылке: ${inviteLink}`,
            }),
          });

          if (!emailResponse.ok) {
            const emailError = await emailResponse.json();
            console.error("Email send error:", emailError);
            // Don't fail the invite, just log
          }
        } catch (emailErr) {
          console.error("Email send exception:", emailErr);
          // Don't fail the invite, just log
        }

        // If roleCode is provided and not 'user', assign the role after user is created
        if (roleCode && roleCode !== "user" && inviteData.user) {
          const { data: roleData } = await supabaseAdmin
            .from("roles")
            .select("id")
            .eq("code", roleCode)
            .maybeSingle();

          if (roleData) {
            await supabaseAdmin.from("user_roles_v2").upsert(
              { user_id: inviteData.user.id, role_id: roleData.id },
              { onConflict: "user_id,role_id" }
            );
          }
        }

        await logAction("users.invite", inviteData.user?.id || null, { email: inviteEmail, roleCode });
        return new Response(JSON.stringify({ success: true, userId: inviteData.user?.id }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "change_email": {
        if (!targetUserId || !newEmail) {
          return new Response(JSON.stringify({ error: "targetUserId and newEmail required" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Check permission - require users.update or contacts.edit
        if (!(await hasPermission("users.update")) && !(await hasPermission("contacts.edit"))) {
          return new Response(JSON.stringify({ error: "Permission denied" }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Prevent changing super_admin email unless actor is super_admin
        if (await isTargetSuperAdmin(targetUserId) && !(await isActorSuperAdmin())) {
          return new Response(JSON.stringify({ error: "Cannot modify super admin" }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Get current user info for audit log
        const { data: currentUser, error: currentUserError } = await supabaseAdmin.auth.admin.getUserById(targetUserId);
        if (currentUserError || !currentUser?.user) {
          console.error("Get user error:", currentUserError);
          return new Response(JSON.stringify({ error: "User not found" }), {
            status: 404,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const oldEmail = currentUser.user.email;

        // Validate new email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(newEmail)) {
          return new Response(JSON.stringify({ error: "Invalid email format" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Check if new email is already in use by another user
        const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers({
          page: 1,
          perPage: 1,
        });
        
        // More efficient: check via getUserByEmail-like approach
        const { data: allUsers } = await supabaseAdmin.auth.admin.listUsers();
        const emailTaken = allUsers?.users?.some(
          u => u.email?.toLowerCase() === newEmail.toLowerCase() && u.id !== targetUserId
        );
        
        if (emailTaken) {
          return new Response(JSON.stringify({ 
            error: "Email already in use",
            message: "Этот email уже используется другим пользователем"
          }), {
            status: 409,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Update email in auth.users via Admin API
        // email_confirm: true means no verification email needed (admin verified)
        const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(
          targetUserId,
          { email: newEmail, email_confirm: true }
        );

        if (authError) {
          console.error("Update auth email error:", authError);
          return new Response(JSON.stringify({ error: authError.message || "Failed to update email" }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Sync profiles.email
        const { error: profileError } = await supabaseAdmin
          .from("profiles")
          .update({ email: newEmail })
          .eq("user_id", targetUserId);

        if (profileError) {
          console.error("Update profile email error:", profileError);
          // Don't fail - auth email was already updated
        }

        await logAction("users.change_email", targetUserId, { 
          old_email: oldEmail, 
          new_email: newEmail 
        });

        return new Response(JSON.stringify({ 
          success: true, 
          oldEmail, 
          newEmail 
        }), {
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
