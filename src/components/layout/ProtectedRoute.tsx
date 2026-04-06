import { ReactNode, useEffect } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useAuthBootstrap } from "@/hooks/useAuthBootstrap";
import { Loader2 } from "lucide-react";
import { saveLastRoute } from "@/hooks/useLastRoute";

/**
 * ProtectedRoute — deterministic state matrix:
 *
 *   loading === true           → spinner
 *   loading === false && !user → redirect to /auth
 *   loading === false && user  → render children
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

  // Save route for post-login redirect
  useEffect(() => {
    if (user && !loading) {
      saveLastRoute(location.pathname, location.search);
    }
  }, [user, loading, location.pathname, location.search]);

  // State matrix
  if (loading) {
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
