import { ReactNode, useEffect } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";
import { saveLastRoute } from "@/hooks/useLastRoute";

/**
 * ProtectedRoute — deterministic state matrix:
 *
 *   loading === true           → spinner
 *   loading === false && !user → redirect to /auth
 *   loading === false && user  → render children
 *
 * No artificial delays, no retry loops, no manual getSession calls.
 */

interface ProtectedRouteProps {
  children: ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { user, loading } = useAuth();
  const location = useLocation();

  // Check banned status (cached across remounts via React Query)
  const { data: isBanned } = useQuery({
    queryKey: ["user-banned-status", user?.id],
    queryFn: async () => {
      if (!user) return false;
      const { data, error } = await supabase
        .from("profiles")
        .select("status")
        .eq("user_id", user.id)
        .single();
      return !error && data?.status === "banned";
    },
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });

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

  if (isBanned === true) {
    return <Navigate to="/banned" replace />;
  }

  return <>{children}</>;
}
