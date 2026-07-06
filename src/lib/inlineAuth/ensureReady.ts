/**
 * ensureInlineAuthReady — shared guard used by every inline-auth call-site
 * (LeadRequestDialog, InvoiceCheckoutDialog, PublicPayPage, FormSection).
 *
 * PATCH-INLINE-OTP-FIX-BROKEN-FLOW (2026-07-06):
 *   Prevents business actions (create lead, start payment, bePaid init) from
 *   firing before Supabase actually holds a verified session. The inline OTP
 *   form calls `onAuthenticated` only after `verifyOtp` success, but a stale
 *   session, race, or refactor could bypass that — this guard is defense in
 *   depth. Callers MUST await this before any create-order / create-lead
 *   / bePaid init.
 */
import { supabase } from "@/integrations/supabase/client";

export interface InlineAuthReady {
  ok: boolean;
  userId?: string;
  email?: string;
  reason?: "no_session" | "no_user" | "error";
}

export async function ensureInlineAuthReady(): Promise<InlineAuthReady> {
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session?.access_token) {
      return { ok: false, reason: "no_session" };
    }
    // getUser re-validates with the Auth server (per security guidance).
    const { data: userData, error } = await supabase.auth.getUser();
    if (error || !userData.user) {
      return { ok: false, reason: "no_user" };
    }
    return {
      ok: true,
      userId: userData.user.id,
      email: userData.user.email ?? undefined,
    };
  } catch (e) {
    console.error("[ensureInlineAuthReady] failed", e);
    return { ok: false, reason: "error" };
  }
}
