import { ReactNode, useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useAuthBootstrap } from "@/hooks/useAuthBootstrap";
import { Loader2 } from "lucide-react";
import { saveLastRoute } from "@/hooks/useLastRoute";

/**
 * ProtectedRoute — deterministic state matrix:
 *
 *   loading === true                        → spinner
 *   loading === false && !user && !settled  → spinner (grace period for session restore)
 *   loading === false && !user && settled   → redirect to /auth
 *   loading === false && user               → render children
 *
 * The "settled" guard prevents premature redirects during HMR / preview reloads
 * where getSession() hasn't finished restoring the session yet.
 *
 * Banned check uses canonical bootstrap profile (no separate profiles SELECT).
 */

interface ProtectedRouteProps {
  children: ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { user, loading } = useAuth();
  const { profile, bootstrapReady } = useAuthBootstrap();
  const location = useLocation();
  const [settled, setSettled] = useState(false);

  // Grace period: after auth reports "no user", wait before redirecting.
  // If a Supabase auth token exists in localStorage, give it 1500ms to restore
  // (covers slow HMR/preview reloads). Otherwise redirect immediately.
  useEffect(() => {
    if (loading || user) {
      setSettled(false);
      return;
    }
    // Check for stored auth token — if present, session restoration is in flight
    const hasStoredToken = (() => {
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && key.startsWith("sb-") && key.endsWith("-auth-token")) {
            return true;
          }
        }
      } catch { /* ignore */ }
      return false;
    })();
    const graceMs = hasStoredToken ? 1500 : 0;
    const timer = setTimeout(() => setSettled(true), graceMs);
    return () => clearTimeout(timer);
  }, [loading, user]);

  // Save route for post-login redirect
  useEffect(() => {
    if (user && !loading) {
      saveLastRoute(location.pathname, location.search);
    }
  }, [user, loading, location.pathname, location.search]);

  // State matrix
  if (loading || (!user && !settled)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-muted to-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    if (location.pathname === "/products") {
      return <Navigate to="/" replace />;
    }
    const redirectTo = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/auth?redirectTo=${redirectTo}`} replace />;
  }

  // Banned check from canonical bootstrap profile — no separate profiles query
  if (bootstrapReady && profile?.status === "banned") {
    return <Navigate to="/banned" replace />;
  }

  return <>{children}</>;
}
