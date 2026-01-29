import { ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useConsent } from "@/hooks/useConsent";
import { SidebarProvider, SidebarTrigger, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "./AppSidebar";
import { DashboardBreadcrumbs } from "./DashboardBreadcrumbs";
import { ConsentUpdateModal } from "@/components/consent/ConsentUpdateModal";
import { PullToRefresh } from "./PullToRefresh";
import { MobileBottomNav } from "./MobileBottomNav";
import { Loader2, Shield } from "lucide-react";

interface DashboardLayoutProps {
  children: ReactNode;
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
  const { loading } = useAuth();
  const { needsConsentUpdate, isLoading: consentLoading } = useConsent();
  const location = useLocation();
  
  // Hide global breadcrumbs on /library routes (they have their own custom breadcrumbs)
  const hideGlobalBreadcrumbs = location.pathname.startsWith("/library");

  if (loading || consentLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-muted to-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Block all content if consent is required - only show the modal
  if (needsConsentUpdate) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-muted to-background">
        <ConsentUpdateModal />
        <div className="text-center p-8 max-w-md">
          <Shield className="h-16 w-16 mx-auto mb-4 text-muted-foreground/50" />
          <h2 className="text-xl font-semibold mb-2">Требуется согласие</h2>
          <p className="text-muted-foreground">
            Для продолжения использования сервиса необходимо подтвердить согласие с политикой конфиденциальности.
          </p>
        </div>
      </div>
    );
  }

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full">
        <AppSidebar />
        <SidebarInset className="flex-1 flex flex-col min-w-0">
          <header 
            className="sticky top-0 z-40 border-b border-border/50 bg-background/80 backdrop-blur-xl flex items-center px-3 md:px-4"
            style={{ 
              paddingTop: 'env(safe-area-inset-top, 0px)',
              minHeight: 'calc(3.5rem + env(safe-area-inset-top, 0px))'
            }}
          >
            <SidebarTrigger className="mr-3 md:mr-4 h-9 w-9" />
            {!hideGlobalBreadcrumbs && <DashboardBreadcrumbs />}
            <div className="flex-1" />
          </header>
          <PullToRefresh>
            <main 
              className="flex-1 p-4 md:p-6 bg-gradient-to-br from-background via-muted/30 to-background overflow-x-hidden pb-20 md:pb-6"
              style={{
                paddingLeft: 'max(1rem, env(safe-area-inset-left, 0px))',
                paddingRight: 'max(1rem, env(safe-area-inset-right, 0px))',
              }}
            >
              {children}
            </main>
          </PullToRefresh>
        </SidebarInset>
        <MobileBottomNav />
      </div>
    </SidebarProvider>
  );
}
