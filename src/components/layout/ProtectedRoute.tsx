import { ReactNode, useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Loader2 } from "lucide-react";

interface ProtectedRouteProps {
  children: ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { user, loading } = useAuth();
  const location = useLocation();
  
  // Дополнительная задержка для HMR — даём время Supabase восстановить сессию
  const [isInitializing, setIsInitializing] = useState(true);
  
  useEffect(() => {
    // Определяем мобильный Safari — там восстановление сессии занимает дольше
    const isMobileSafari = /iPhone|iPad|iPod/.test(navigator.userAgent) && 
                           /Safari/.test(navigator.userAgent) &&
                           !/Chrome/.test(navigator.userAgent);
    
    // Для мобильного Safari даём 1200ms, для остальных 500ms
    const delay = isMobileSafari ? 1200 : 500;
    
    const timer = setTimeout(() => setIsInitializing(false), delay);
    return () => clearTimeout(timer);
  }, []);

  // Показываем loader пока loading ИЛИ пока идёт инициализация
  if (loading || isInitializing) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-muted to-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    // Encode the full path including search params
    const redirectTo = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/auth?redirectTo=${redirectTo}`} replace />;
  }

  return <>{children}</>;
}
