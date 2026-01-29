import { ReactNode, useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";
import { saveLastRoute } from "@/hooks/useLastRoute";

interface ProtectedRouteProps {
  children: ReactNode;
}

// Защита от бесконечного цикла перезагрузок
const RELOAD_KEY = 'protected_route_reload_count';
const MAX_RELOADS = 2;

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
    
    // Для мобильного Safari даём 2500ms, для остальных 800ms
    const delay = isMobileSafari ? 2500 : 800;
    
    const timer = setTimeout(() => setIsInitializing(false), delay);
    return () => clearTimeout(timer);
  }, []);

  // Улучшенная retry-логика с защитой от бесконечного цикла через sessionStorage
  useEffect(() => {
    if (!loading && !isInitializing && !user) {
      const reloadCount = parseInt(sessionStorage.getItem(RELOAD_KEY) || '0', 10);
      
      if (reloadCount < MAX_RELOADS) {
        // Попробуем ещё раз получить сессию
        supabase.auth.getSession().then(({ data: { session } }) => {
          if (session) {
            // Сессия найдена — инкрементируем счётчик и перезагружаем
            sessionStorage.setItem(RELOAD_KEY, String(reloadCount + 1));
            window.location.reload();
          }
        });
      }
      // Если MAX_RELOADS достигнут — просто редиректим на /auth (ниже)
    }
  }, [loading, isInitializing, user]);

  // Очищаем счётчик при успешной авторизации
  useEffect(() => {
    if (user) {
      sessionStorage.removeItem(RELOAD_KEY);
    }
  }, [user]);

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
