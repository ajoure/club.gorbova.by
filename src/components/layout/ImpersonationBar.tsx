import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { ArrowLeft, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useAdminReturn } from "@/contexts/AdminReturnContext";
import { clearImpersonationStorage, getReturnFence, hasActiveImpersonationMarker, hasStaleImpersonationState,
  isValidImpersonationState, RETURN_STATE_EVENT, withAuthLease } from "@/lib/impersonationStorage";
import { saveVerifiedAdminBackup } from "@/lib/adminReturn";

/** A view only. Persistent orchestration lives above the guarded shell. No mount-time auth actions. */
export function ImpersonationBar() {
  const { user } = useAuth();
  const operation = useAdminReturn();
  const location = useLocation();
  const [active, setActive] = useState(isValidImpersonationState);
  useEffect(() => {
    const sync = () => setActive(isValidImpersonationState());
    sync();
    // Inert legacy garbage can be cleaned, but an active/unknown session or fence is never erased on mount.
    if (hasStaleImpersonationState() && !hasActiveImpersonationMarker() && !getReturnFence()) {
      void withAuthLease(async lease => {
        if (!hasActiveImpersonationMarker() && !getReturnFence()) clearImpersonationStorage(lease);
      }).catch(() => {});
    }
    window.addEventListener("storage", sync);
    window.addEventListener(RETURN_STATE_EVENT, sync);
    // URL activation never creates or extends an original timestamp.
    const params = new URLSearchParams(location.search);
    if (params.has("impersonating")) {
      params.delete("impersonating");
      window.history.replaceState({}, "", location.pathname + (params.size ? "?" + params.toString() : "") + location.hash);
    }
    return () => { window.removeEventListener("storage", sync); window.removeEventListener(RETURN_STATE_EVENT, sync); };
  }, [location.pathname, location.search, location.hash]);
  useEffect(() => {
    document.body.classList.toggle("impersonation-active", active);
    return () => document.body.classList.remove("impersonation-active");
  }, [active]);
  if (!active || !user) return null;
  return <div className="fixed top-0 left-0 right-0 z-[110] bg-amber-500 text-amber-950 pb-2 px-4 shadow-md"
    style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 0.5rem)" }}>
    <div className="max-w-7xl mx-auto flex items-center justify-between gap-2">
      <span className="flex min-w-0 items-center gap-2"><User className="shrink-0 w-4 h-4" /><span className="truncate">Вы вошли как: {user.email || "пользователь"}</span></span>
      <Button variant="outline" size="sm" disabled={!operation || operation.view.inFlight}
        onClick={() => void operation?.returnToAdmin()} className="shrink-0 bg-white/20 border-amber-700 text-amber-950">
        <ArrowLeft className="w-4 h-4 mr-2" />Вернуться в админку
      </Button>
    </div>
  </div>;
}

/** Backward-compatible first argument. A legacy caller without target binding fails closed. */
export async function saveAdminSessionForImpersonation(returnUrl = "/admin/contacts", targetUserId?: string): Promise<void> {
  await saveVerifiedAdminBackup(supabase.auth, returnUrl, targetUserId);
}
