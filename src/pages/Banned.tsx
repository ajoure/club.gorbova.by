import { useNavigate } from "react-router-dom";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

export default function Banned() {
  const navigate = useNavigate();

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/auth");
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-destructive/5 via-background to-destructive/10 p-4">
      <div className="max-w-md w-full text-center space-y-6">
        <div className="mx-auto w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center">
          <ShieldAlert className="h-8 w-8 text-destructive" />
        </div>
        
        <div className="space-y-2">
          <h1 className="text-2xl font-bold text-destructive">
            Доступ запрещён
          </h1>
          <p className="text-muted-foreground">
            Доступ к сервису заблокирован администратором.
          </p>
          <p className="text-sm text-muted-foreground">
            Если вы считаете, что это ошибка — обратитесь в поддержку.
          </p>
        </div>

        <Button variant="outline" onClick={handleLogout}>
          Выйти из аккаунта
        </Button>
      </div>
    </div>
  );
}
