import { useEffect, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { readCapturedReferral, REFERRAL_STORAGE_KEY } from "@/lib/referrals";

/** Attaches a captured referral as soon as an authenticated profile is ready. */
export function ReferralAttributionSync() {
  const { user } = useAuth();
  const activeUserRef = useRef<string | null>(null);

  useEffect(() => {
    if (!user?.id || activeUserRef.current === user.id) return;
    const captured = readCapturedReferral();
    if (!captured) return;

    activeUserRef.current = user.id;
    let cancelled = false;

    const attach = async () => {
      // The profiles row is trigger-created and can lag the first auth event briefly.
      for (let attempt = 0; attempt < 4 && !cancelled; attempt += 1) {
        const { data, error } = await (supabase.rpc as any)("referral_attach_current_profile", {
          p_partner_code: captured.code,
          p_captured_at: captured.capturedAt,
        });

        if (!error) {
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
  }, [user?.id]);

  return null;
}
