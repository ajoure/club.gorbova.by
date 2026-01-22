import { ReactNode, useMemo } from "react";
import { useNavigate, Link, useLocation } from "react-router-dom";
import { usePermissions } from "@/hooks/usePermissions";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AdminSidebar } from "./AdminSidebar";
import { PullToRefresh } from "./PullToRefresh";
import { Loader2, HelpCircle } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";

interface AdminLayoutProps {
  children: ReactNode;
}

// Map admin routes to help section anchors
const routeToHelpAnchor: Record<string, string> = {
  '/admin/users': 'admin-impersonate',
  '/admin/deals': 'orders',
  '/admin/contacts': 'admin',
  '/admin/orders': 'orders',
  '/admin/orders-v2': 'orders',
  '/admin/payments': 'orders',
  '/admin/products': 'admin',
  '/admin/products-v2': 'admin',
  '/admin/subscriptions-v2': 'subscriptions',
  '/admin/entitlements': 'admin',
  '/admin/duplicates': 'duplicates',
  '/admin/integrations': 'integrations',
  '/admin/amocrm': 'amocrm',
  '/admin/telegram/bots': 'telegram-bots',
  '/admin/telegram/clubs': 'telegram-clubs',
  '/admin/telegram/invites': 'telegram-notifications',
  '/admin/telegram/members': 'telegram-clubs',
  '/admin/telegram/logs': 'telegram-bots',
  '/admin/telegram/mtproto': 'telegram-bots',
  '/admin/email': 'email',
  '/admin/content': 'admin',
  '/admin/roles': 'roles',
  '/admin/fields': 'integrations-mapping',
  '/admin/audit': 'admin',
};

export function AdminLayout({ children }: AdminLayoutProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { hasAdminAccess, loading } = usePermissions();

  // Get the help anchor for the current route
  const helpAnchor = useMemo(() => {
    const path = location.pathname;
    // Check for exact match first
    if (routeToHelpAnchor[path]) {
      return routeToHelpAnchor[path];
    }
    // Check for prefix match (for nested routes)
    for (const [route, anchor] of Object.entries(routeToHelpAnchor)) {
      if (path.startsWith(route)) {
        return anchor;
      }
    }
    return 'admin';
  }, [location.pathname]);

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
          <header 
            className="border-b flex items-center justify-between px-3 md:px-4 bg-background/80 backdrop-blur-sm sticky top-0 z-10"
            style={{ 
              paddingTop: 'env(safe-area-inset-top, 0px)',
              minHeight: 'calc(3.5rem + env(safe-area-inset-top, 0px))'
            }}
          >
            <div className="flex items-center min-w-0">
              <SidebarTrigger className="mr-3 md:mr-4 shrink-0" />
              <h2 className="text-base md:text-lg font-semibold truncate">Админ-панель</h2>
            </div>
            {/* Contextual help link */}
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Link 
                    to={`/help#${helpAnchor}`}
                    className="text-muted-foreground hover:text-foreground transition-colors p-1"
                  >
                    <HelpCircle className="h-5 w-5" />
                  </Link>
                </TooltipTrigger>
                <TooltipContent>
                  Помощь по текущему разделу
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </header>
          <PullToRefresh>
            <div 
              className="flex-1 flex flex-col overflow-hidden"
              style={{
                paddingLeft: 'max(1rem, env(safe-area-inset-left, 0px))',
                paddingRight: 'max(1rem, env(safe-area-inset-right, 0px))',
                paddingBottom: 'max(1rem, env(safe-area-inset-bottom, 0px))'
              }}
            >
              {children}
            </div>
          </PullToRefresh>
        </main>
      </div>
    </SidebarProvider>
  );
}
