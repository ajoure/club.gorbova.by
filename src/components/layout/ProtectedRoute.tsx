import { ReactNode, useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";
import { saveLastRoute } from "@/hooks/useLastRoute";

interface ProtectedRouteProps {
  children: ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { user, loading } = useAuth();
  const location = useLocation();
  
  const [isInitializing, setIsInitializing] = useState(true);
  const [retryCount, setRetryCount] = useState(0);
  const [isBanned, setIsBanned] = useState<boolean | null>(null);
  
  useEffect(() => {
    const isMobileSafari = /iPhone|iPad|iPod/.test(navigator.userAgent) && 
                           /Safari/.test(navigator.userAgent) &&
                           !/Chrome/.test(navigator.userAgent);
    const delay = isMobileSafari ? 1500 : 600;
    const timer = setTimeout(() => setIsInitializing(false), delay);
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

  // Check banned status
  useEffect(() => {
    if (!user) {
      setIsBanned(null);
      return;
    }

    let mounted = true;
    const checkBanned = async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("status")
        .eq("user_id", user.id)
        .single();

      if (mounted) {
        setIsBanned(!error && data?.status === "banned");
      }
    };

    checkBanned();
    return () => { mounted = false; };
  }, [user]);

  // Save route
  useEffect(() => {
    if (user && !loading) {
      saveLastRoute(location.pathname, location.search);
    }
  }, [user, loading, location.pathname, location.search]);

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

  // Still checking banned status
  if (isBanned === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-muted to-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return <>{children}</>;
}
