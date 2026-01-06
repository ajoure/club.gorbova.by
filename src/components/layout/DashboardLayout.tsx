import { ReactNode } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { SidebarProvider, SidebarTrigger, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "./AppSidebar";
import { DashboardBreadcrumbs } from "./DashboardBreadcrumbs";
import { Loader2 } from "lucide-react";

interface DashboardLayoutProps {
  children: ReactNode;
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
  const { loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-muted to-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
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
            <DashboardBreadcrumbs />
            <div className="flex-1" />
          </header>
          <main 
            className="flex-1 p-4 md:p-6 bg-gradient-to-br from-background via-muted/30 to-background overflow-x-hidden"
            style={{
              paddingLeft: 'max(1rem, env(safe-area-inset-left, 0px))',
              paddingRight: 'max(1rem, env(safe-area-inset-right, 0px))',
              paddingBottom: 'max(1rem, env(safe-area-inset-bottom, 0px))'
            }}
          >
            {children}
          </main>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}
