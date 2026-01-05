import { ReactNode } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { SidebarProvider, SidebarTrigger, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "./AppSidebar";
import { DashboardBreadcrumbs } from "./DashboardBreadcrumbs";
import { Loader2, Menu } from "lucide-react";

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
          <header className="sticky top-0 z-40 h-14 md:h-16 border-b border-border/50 bg-background/80 backdrop-blur-xl flex items-center px-3 md:px-4">
            <SidebarTrigger className="mr-3 md:mr-4">
              <Menu className="h-5 w-5" />
            </SidebarTrigger>
            <DashboardBreadcrumbs />
            <div className="flex-1" />
          </header>
          <main className="flex-1 p-4 md:p-6 bg-gradient-to-br from-background via-muted/30 to-background overflow-x-hidden">
            {children}
          </main>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}
