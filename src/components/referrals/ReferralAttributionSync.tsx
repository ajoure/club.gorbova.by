import { useEffect, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { readCapturedReferral, REFERRAL_STORAGE_KEY, storeCapturedReferral } from "@/lib/referrals";

/** Attaches a captured referral as soon as an authenticated profile is ready. */
export function ReferralAttributionSync() {
  const { user } = useAuth();
  const activeUserRef = useRef<string | null>(null);

  useEffect(() => {
    if (!user?.id || activeUserRef.current === user.id) return;

    // Prefer localStorage capture; fall back to user_metadata so cross-browser
    // email confirmations (where localStorage was lost) still attribute exactly once.
    let captured = readCapturedReferral();
    if (!captured) {
      const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
      const code = typeof meta.referral_code === "string" ? meta.referral_code : null;
      const capturedAt = typeof meta.referral_captured_at === "string" ? meta.referral_captured_at : null;
      if (code && capturedAt) {
        captured = { code, capturedAt };
        // Re-hydrate localStorage so retries and other tabs see the same capture.
        try { storeCapturedReferral(code); } catch { /* ignore */ }
      }
    }
    if (!captured) return;

    activeUserRef.current = user.id;
    let cancelled = false;
    const capturedAtIso = captured.capturedAt;
    const capturedCode = captured.code;

    const attach = async () => {
      // The profiles row is trigger-created and can lag the first auth event briefly.
      for (let attempt = 0; attempt < 4 && !cancelled; attempt += 1) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: attachResult, error } = await (supabase.rpc as any)("referral_attach_current_profile", {
          p_partner_code: capturedCode,
          p_captured_at: capturedAtIso,
        });

        if (!error) {
          try {
            if (attachResult?.attached && attachResult?.relationship_id) {
              void supabase.functions.invoke('referral-notify', { body: { event_type: 'registration', relationship_id: attachResult.relationship_id } });
            }
          } catch (notifyError) {
            console.warn('[ReferralAttributionSync] registration notification failed', notifyError);
          }
          localStorage.removeItem(REFERRAL_STORAGE_KEY);
          return;
        }

        if (attempt < 3) {
          await new Promise((resolve) => window.setTimeout(resolve, 500 * (attempt + 1)));
        }
      }

      // Preserve the capture after transient errors so a later authenticated page can retry.
      if (!cancelled) activeUserRef.current = null;
    };

    void attach();
    return () => { cancelled = true; };
  }, [user?.id, user?.user_metadata]);

  return null;
}
