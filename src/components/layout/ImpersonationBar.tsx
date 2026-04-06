import { useState, useEffect, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { ArrowLeft, User } from "lucide-react";
import { toast } from "sonner";
import {
  isValidImpersonationState,
  hasStaleImpersonationState,
  clearImpersonationStorage,
  getAdminSessionBackup,
  getAdminReturnUrl,
  IMPERSONATION_KEYS,
} from "@/lib/impersonationStorage";

/**
 * ImpersonationBar — shows admin impersonation banner.
 *
 * ARCHITECTURE RULES:
 * - Mounted ONLY inside authenticated app shell (after ProtectedRoute).
 * - Never calls signOut automatically on mount.
 * - handleReturnToAdmin is triggered ONLY by user click.
 * - Stale/garbage impersonation state is silently cleaned without side effects.
 * - Cross-tab safety: cleanup does not trigger auth events in other tabs.
 */
export function ImpersonationBar() {
  const { user } = useAuth();
  const [isImpersonating, setIsImpersonating] = useState(false);
  const [impersonatedEmail, setImpersonatedEmail] = useState<string | null>(null);
  const [isReturning, setIsReturning] = useState(false);
  const cleanupDoneRef = useRef(false);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (!user || cleanupDoneRef.current) return;

    // Handle URL-based impersonation activation
    const params = new URLSearchParams(location.search);
    if (params.get("impersonating") === "true") {
      setIsImpersonating(true);
      setImpersonatedEmail(user.email ?? null);
      // Mark as impersonating in localStorage
      localStorage.setItem(IMPERSONATION_KEYS.IS_IMPERSONATING, "true");
      localStorage.setItem(IMPERSONATION_KEYS.IMPERSONATION_START, Date.now().toString());
      // Clean URL
      const newParams = new URLSearchParams(location.search);
      newParams.delete("impersonating");
      const newUrl = newParams.toString()
        ? `${location.pathname}?${newParams.toString()}`
        : location.pathname;
      window.history.replaceState({}, "", newUrl);
      return;
    }

    // Check localStorage for persistent impersonation state
    if (isValidImpersonationState()) {
      setIsImpersonating(true);
      setImpersonatedEmail(user.email ?? null);
    } else if (hasStaleImpersonationState()) {
      // Silent cleanup — no signOut, no toast, no redirect
      if (import.meta.env.DEV) {
        console.info("[ImpersonationBar] Cleaning stale impersonation state");
      }
      clearImpersonationStorage();
      cleanupDoneRef.current = true;
      setIsImpersonating(false);
    }
  }, [user, location.search]);

  const handleReturnToAdmin = async () => {
    if (isReturning) return;
    setIsReturning(true);

    try {
      const sessionBackup = getAdminSessionBackup();
      const returnUrl = getAdminReturnUrl();

      // Sign out from impersonated session
      await supabase.auth.signOut();

      // Clear impersonation state
      clearImpersonationStorage();
      setIsImpersonating(false);
      setImpersonatedEmail(null);

      // Try to restore admin session
      if (sessionBackup) {
        try {
          const { error } = await supabase.auth.setSession({
            access_token: sessionBackup.access_token,
            refresh_token: sessionBackup.refresh_token,
          });

          if (!error) {
            toast.success("Вернулись в аккаунт администратора");
            navigate(returnUrl);
            return;
          }
        } catch (e) {
          console.error("[ImpersonationBar] Error restoring admin session:", e);
        }
      }

      // Fallback: redirect to login
      toast.info("Сессия истекла, войдите снова");
      navigate("/auth");
    } catch (error) {
      console.error("[ImpersonationBar] Error returning:", error);
      toast.error("Ошибка выхода из режима просмотра");
    } finally {
      setIsReturning(false);
    }
  };

  // Body class for CSS offset
  useEffect(() => {
    if (isImpersonating) {
      document.body.classList.add("impersonation-active");
    } else {
      document.body.classList.remove("impersonation-active");
    }
    return () => {
      document.body.classList.remove("impersonation-active");
    };
  }, [isImpersonating]);

  if (!isImpersonating) return null;

  return (
    <div
      className="fixed top-0 left-0 right-0 z-[110] bg-amber-500 text-amber-950 pb-2 px-4 shadow-md"
      style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 0.5rem)" }}
    >
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        <div className="flex items-center gap-2">
          <User className="w-4 h-4" />
          <span className="font-medium">
            Вы вошли как:{" "}
            <span className="font-bold">{impersonatedEmail || "пользователь"}</span>
          </span>
        </div>
        <Button
          onClick={handleReturnToAdmin}
          variant="outline"
          size="sm"
          disabled={isReturning}
          className="bg-white/20 border-amber-700 text-amber-950 hover:bg-white/30"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          {isReturning ? "Возврат..." : "Вернуться в админку"}
        </Button>
      </div>
    </div>
  );
}

// Helper function to start impersonation - call this before switching sessions
// Maintains backward-compatible signature: saveAdminSessionForImpersonation(returnUrl?)
export async function saveAdminSessionForImpersonation(returnUrl: string = "/admin/contacts"): Promise<void> {
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    if (sessionData?.session) {
      const { saveImpersonationState } = await import("@/lib/impersonationStorage");
      saveImpersonationState(
        {
          access_token: sessionData.session.access_token,
          refresh_token: sessionData.session.refresh_token,
        },
        returnUrl
      );
    }
  } catch (e) {
    console.error("Error saving admin session:", e);
  }
}
