import { ReactNode } from "react";
import { useNavigate, Link } from "react-router-dom";
import { usePermissions } from "@/hooks/usePermissions";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AdminSidebar } from "./AdminSidebar";
import { Loader2, HelpCircle } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useHelpMode } from "@/contexts/HelpModeContext";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";

interface AdminLayoutProps {
  children: ReactNode;
}

export function AdminLayout({ children }: AdminLayoutProps) {
  const navigate = useNavigate();
  const { hasAdminAccess, loading } = usePermissions();
  const { helpMode, toggleHelpMode } = useHelpMode();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!hasAdminAccess()) {
    navigate("/");
    return null;
  }

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full">
        <AdminSidebar />
        <main className="flex-1 flex flex-col min-w-0">
          <header className="h-14 border-b flex items-center justify-between px-3 md:px-4 bg-background/80 backdrop-blur-sm sticky top-0 z-10">
            <div className="flex items-center min-w-0">
              <SidebarTrigger className="mr-3 md:mr-4 shrink-0" />
              <h2 className="text-base md:text-lg font-semibold truncate">Админ-панель</h2>
            </div>
            <div className="flex items-center gap-2 md:gap-4 shrink-0">
              {/* Help mode toggle */}
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="flex items-center gap-2">
                      <Switch
                        id="help-mode"
                        checked={helpMode}
                        onCheckedChange={toggleHelpMode}
                        className="data-[state=checked]:bg-primary"
                      />
                      <Label 
                        htmlFor="help-mode" 
                        className="text-sm text-muted-foreground cursor-pointer hidden md:inline"
                      >
                        Подсказки
                      </Label>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>
                    {helpMode ? 'Скрыть подсказки' : 'Показать подсказки'}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              
              {/* Help link */}
              <Link 
                to="/help" 
                className="text-muted-foreground hover:text-foreground transition-colors"
                title="Помощь"
              >
                <HelpCircle className="h-5 w-5" />
              </Link>
            </div>
          </header>
          <div className="flex-1 p-4 md:p-6 overflow-auto">
            {children}
          </div>
        </main>
      </div>
    </SidebarProvider>
  );
}
