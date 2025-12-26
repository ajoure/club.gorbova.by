import { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ArrowLeft, User } from "lucide-react";
import { toast } from "sonner";

export function ImpersonationBar() {
  const [isImpersonating, setIsImpersonating] = useState(false);
  const [impersonatedEmail, setImpersonatedEmail] = useState<string | null>(null);
  const [originalAdminToken, setOriginalAdminToken] = useState<string | null>(null);
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
      
      // Store admin token if not already stored
      const storedToken = localStorage.getItem("admin_token");
      if (!storedToken) {
        supabase.auth.getSession().then(({ data }) => {
          if (data?.session?.access_token) {
            // On first impersonation, we should have stored the admin token BEFORE switching
            // This is handled in AdminUsers when starting impersonation
          }
        });
      } else {
        setOriginalAdminToken(storedToken);
      }

      // Clean up URL
      const newParams = new URLSearchParams(location.search);
      newParams.delete("impersonating");
      const newUrl = newParams.toString() 
        ? `${location.pathname}?${newParams.toString()}`
        : location.pathname;
      window.history.replaceState({}, "", newUrl);
      
      // Mark as impersonating in localStorage
      localStorage.setItem("is_impersonating", "true");
    } else {
      // Check localStorage for persistent impersonation state
      const storedImpersonating = localStorage.getItem("is_impersonating") === "true";
      setIsImpersonating(storedImpersonating);
      
      if (storedImpersonating) {
        supabase.auth.getUser().then(({ data }) => {
          if (data?.user?.email) {
            setImpersonatedEmail(data.user.email);
          }
        });
        
        const storedToken = localStorage.getItem("admin_token");
        if (storedToken) {
          setOriginalAdminToken(storedToken);
        }
      }
    }
  }, [location]);

  const handleReturnToAdmin = async () => {
    try {
      // Sign out from impersonated session
      await supabase.auth.signOut();
      
      // Clear impersonation state
      localStorage.removeItem("is_impersonating");
      localStorage.removeItem("admin_token");
      
      setIsImpersonating(false);
      setImpersonatedEmail(null);
      setOriginalAdminToken(null);
      
      toast.success("Вышли из режима просмотра");
      
      // Redirect to login - admin will need to log back in
      navigate("/auth");
    } catch (error) {
      console.error("Error returning from impersonation:", error);
      toast.error("Ошибка выхода из режима просмотра");
    }
  };

  if (!isImpersonating) {
    return null;
  }

  return (
    <div className="fixed top-0 left-0 right-0 z-50 bg-amber-500/90 text-amber-950 py-2 px-4 shadow-md backdrop-blur-sm">
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
          className="bg-white/20 border-amber-700 text-amber-950 hover:bg-white/30"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Вернуться в аккаунт администратора
        </Button>
      </div>
    </div>
  );
}
