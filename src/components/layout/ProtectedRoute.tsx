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
  
  // Дополнительная задержка для HMR — даём время Supabase восстановить сессию
  const [isInitializing, setIsInitializing] = useState(true);
  const [retryCount, setRetryCount] = useState(0);
  
  useEffect(() => {
    // Определяем мобильный Safari — там восстановление сессии занимает дольше
    const isMobileSafari = /iPhone|iPad|iPod/.test(navigator.userAgent) && 
                           /Safari/.test(navigator.userAgent) &&
                           !/Chrome/.test(navigator.userAgent);
    
    // Для мобильного Safari даём 1500ms, для остальных 600ms
    const delay = isMobileSafari ? 1500 : 600;
    
    const timer = setTimeout(() => setIsInitializing(false), delay);
    return () => clearTimeout(timer);
  }, []);

  // Повторная проверка сессии если пользователь не найден после инициализации
  useEffect(() => {
    if (!loading && !isInitializing && !user && retryCount < 2) {
      // Попробуем ещё раз получить сессию
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session) {
          // Сессия найдена — перезагрузим страницу для корректной инициализации
          window.location.reload();
        }
      });
      setRetryCount(prev => prev + 1);
    }
  }, [loading, isInitializing, user, retryCount]);

  // Сохраняем текущий маршрут при каждом изменении (если авторизован)
  useEffect(() => {
    if (user && !loading) {
      saveLastRoute(location.pathname, location.search);
    }
  }, [user, loading, location.pathname, location.search]);

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
