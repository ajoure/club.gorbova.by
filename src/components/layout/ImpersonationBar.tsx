import { useState, useEffect, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ArrowLeft, User } from "lucide-react";
import { toast } from "sonner";

const ADMIN_RETURN_URL_KEY = "admin_return_url";
const IS_IMPERSONATING_KEY = "is_impersonating";
const ADMIN_SESSION_KEY = "admin_session_backup";
const IMPERSONATION_START_KEY = "impersonation_start_time";
const MAX_IMPERSONATION_DURATION_MS = 15 * 60 * 1000; // 15 minutes max

export function ImpersonationBar() {
  const [isImpersonating, setIsImpersonating] = useState(false);
  const [impersonatedEmail, setImpersonatedEmail] = useState<string | null>(null);
  const [isReturning, setIsReturning] = useState(false);
  const suspiciousStateLoggedRef = useRef(false);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    // Check if we're in impersonation mode from URL or localStorage
    const params = new URLSearchParams(location.search);
    const impersonating = params.get("impersonating") === "true";
    
    if (impersonating) {
      // Store current state as impersonated
      setIsImpersonating(true);
      
      // Get current user email
      supabase.auth.getUser().then(({ data }) => {
        if (data?.user?.email) {
          setImpersonatedEmail(data.user.email);
        }
      });

      // Clean up URL
      const newParams = new URLSearchParams(location.search);
      newParams.delete("impersonating");
      const newUrl = newParams.toString() 
        ? `${location.pathname}?${newParams.toString()}`
        : location.pathname;
      window.history.replaceState({}, "", newUrl);
      
      // Mark as impersonating in localStorage with timestamp
      localStorage.setItem(IS_IMPERSONATING_KEY, "true");
      localStorage.setItem(IMPERSONATION_START_KEY, Date.now().toString());
    } else {
      // Check localStorage for persistent impersonation state
      const hasAdminSessionBackup = !!localStorage.getItem(ADMIN_SESSION_KEY);
      const storedImpersonating =
        localStorage.getItem(IS_IMPERSONATING_KEY) === "true" || hasAdminSessionBackup;
      const impersonationStartTime = localStorage.getItem(IMPERSONATION_START_KEY);

      // Backward/bug-compat: if we have admin session backup but the flag is missing,
      // force-enable impersonation mode so it's never "silent".
      // PATCH-10: This is a "suspicious state" that should be audited.
      if (hasAdminSessionBackup && localStorage.getItem(IS_IMPERSONATING_KEY) !== "true") {
        localStorage.setItem(IS_IMPERSONATING_KEY, "true");
        if (!impersonationStartTime) {
          localStorage.setItem(IMPERSONATION_START_KEY, Date.now().toString());
        }
        
        // Audit suspicious state (async, fire-and-forget, only once per session)
        if (!suspiciousStateLoggedRef.current) {
          suspiciousStateLoggedRef.current = true;
          supabase.auth.getUser().then(({ data }) => {
            if (data?.user) {
              supabase.from('audit_logs').insert({
                actor_type: 'system',
                actor_user_id: null,
                actor_label: 'ImpersonationBar: suspicious state detected',
                action: 'auth.suspicious_state_detected',
                meta: {
                  has_admin_session_backup: true,
                  is_impersonating_flag_was_missing: true,
                  current_user_email: data.user.email,
                  current_user_id: data.user.id,
                  url: window.location.href,
                  detected_at: new Date().toISOString(),
                },
              }).then((result) => {
                if (result.error) {
                  console.error('[ImpersonationBar] Failed to log suspicious state:', result.error);
                } else {
                  console.warn('[ImpersonationBar] Suspicious state detected and logged');
                }
              });
            }
          });
        }
      }
      
      // Check if impersonation session has expired (15 minute limit)
      if (storedImpersonating && impersonationStartTime) {
        const elapsed = Date.now() - parseInt(impersonationStartTime, 10);
        if (elapsed > MAX_IMPERSONATION_DURATION_MS) {
          // Auto-return to admin due to session timeout
          console.log("Impersonation session expired, auto-returning to admin");
          handleReturnToAdmin();
          return;
        }
      }
      
      setIsImpersonating(storedImpersonating);
      
      if (storedImpersonating) {
        supabase.auth.getUser().then(({ data }) => {
          if (data?.user?.email) {
            setImpersonatedEmail(data.user.email);
          }
        });
      }
    }
  }, [location]);

  const handleReturnToAdmin = async () => {
    if (isReturning) return;
    setIsReturning(true);
    
    try {
      // Get stored admin session
      const storedSession = localStorage.getItem(ADMIN_SESSION_KEY);
      const returnUrl = localStorage.getItem(ADMIN_RETURN_URL_KEY) || "/admin/users";
      
      // Sign out from impersonated session
      await supabase.auth.signOut();
      
      // Clear impersonation state immediately
      localStorage.removeItem(IS_IMPERSONATING_KEY);
      localStorage.removeItem(ADMIN_SESSION_KEY);
      localStorage.removeItem(ADMIN_RETURN_URL_KEY);
      localStorage.removeItem(IMPERSONATION_START_KEY);
      localStorage.removeItem("admin_token");
      localStorage.removeItem("admin_session"); // Also clear alternative key used in ContactDetailSheet
      
      setIsImpersonating(false);
      setImpersonatedEmail(null);
      
      // Try to restore admin session
      if (storedSession) {
        try {
          const sessionData = JSON.parse(storedSession);
          if (sessionData.refresh_token) {
            const { error } = await supabase.auth.setSession({
              access_token: sessionData.access_token,
              refresh_token: sessionData.refresh_token,
            });
            
            if (!error) {
              toast.success("Вернулись в аккаунт администратора");
              navigate(returnUrl);
              return;
            }
          }
        } catch (e) {
          console.error("Error restoring admin session:", e);
        }
      }
      
      // Fallback: redirect to login
      toast.info("Сессия истекла, войдите снова");
      navigate("/auth");
    } catch (error) {
      console.error("Error returning from impersonation:", error);
      toast.error("Ошибка выхода из режима просмотра");
      setIsReturning(false);
    }
  };

  // Add/remove class to body for CSS offset targeting
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

  if (!isImpersonating) {
    return null;
  }

  return (
    <>
      {/* Spacer to push content down */}
      <div className="h-11" />
      <div className="fixed top-0 left-0 right-0 z-[100] bg-amber-500 text-amber-950 py-2 px-4 shadow-md">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <User className="w-4 h-4" />
            <span className="font-medium">
              Вы вошли как: <span className="font-bold">{impersonatedEmail || "пользователь"}</span>
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
    </>
  );
}

// Helper function to start impersonation - call this before switching sessions
export function saveAdminSessionForImpersonation(returnUrl: string = "/admin/users") {
  return new Promise<void>(async (resolve) => {
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      if (sessionData?.session) {
        localStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify({
          access_token: sessionData.session.access_token,
          refresh_token: sessionData.session.refresh_token,
        }));
        localStorage.setItem(ADMIN_RETURN_URL_KEY, returnUrl);
      }
    } catch (e) {
      console.error("Error saving admin session:", e);
    }
    resolve();
  });
}
