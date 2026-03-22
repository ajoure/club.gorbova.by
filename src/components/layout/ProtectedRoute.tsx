import { ReactNode, useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { saveLastRoute } from "@/hooks/useLastRoute";

// Module-level flag: skip 600ms delay after first successful init
let hasInitialized = false;

interface ProtectedRouteProps {
  children: ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { user, loading } = useAuth();
  const location = useLocation();
  
  const [isInitializing, setIsInitializing] = useState(!hasInitialized);
  const [retryCount, setRetryCount] = useState(0);
  
  // First-time init delay (cold start only)
  useEffect(() => {
    if (hasInitialized) {
      setIsInitializing(false);
      return;
    }
    const isMobileSafari = /iPhone|iPad|iPod/.test(navigator.userAgent) && 
                           /Safari/.test(navigator.userAgent) &&
                           !/Chrome/.test(navigator.userAgent);
    const delay = isMobileSafari ? 1500 : 600;
    const timer = setTimeout(() => {
      setIsInitializing(false);
      hasInitialized = true;
    }, delay);
    return () => clearTimeout(timer);
  }, []);

  // Retry session
  useEffect(() => {
    if (!loading && !isInitializing && !user && retryCount < 2) {
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session) {
          console.log("Session found on retry, waiting for AuthContext sync");
        }
      });
      setRetryCount(prev => prev + 1);
    }
  }, [loading, isInitializing, user, retryCount]);

  // Check banned status via React Query (cached across remounts)
  const { data: isBanned, isLoading: isBannedLoading } = useQuery({
    queryKey: ['user-banned-status', user?.id],
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
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000,
  });

  // Save route
  useEffect(() => {
    if (user && !loading) {
      saveLastRoute(location.pathname, location.search);
    }
  }, [user, loading, location.pathname, location.search]);

  // Mark initialized on successful render
  useEffect(() => {
    if (user && !loading) {
      hasInitialized = true;
    }
  }, [user, loading]);

  if (loading || isInitializing) {
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

  // Redirect banned users
  if (isBanned === true) {
    return <Navigate to="/banned" replace />;
  }

  // Only show spinner on first load when ban status is unknown AND not cached
  if (isBannedLoading && !hasInitialized) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-muted to-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return <>{children}</>;
}
