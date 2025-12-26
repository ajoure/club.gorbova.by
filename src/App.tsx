import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { ImpersonationBar } from "@/components/layout/ImpersonationBar";
import Dashboard from "./pages/Dashboard";
import Auth from "./pages/Auth";
import Accountant from "./pages/Accountant";
import Business from "./pages/Business";
import Audits from "./pages/Audits";
import SelfDevelopment from "./pages/SelfDevelopment";
import EisenhowerMatrix from "./pages/tools/EisenhowerMatrix";
import BalanceWheel from "./pages/tools/BalanceWheel";
import Pricing from "./pages/Pricing";
import NotFound from "./pages/NotFound";
import { AdminLayout } from "./components/layout/AdminLayout";
import AdminUsers from "./pages/admin/AdminUsers";
import AdminRoles from "./pages/admin/AdminRoles";
import AdminAudit from "./pages/admin/AdminAudit";
import AdminEntitlements from "./pages/admin/AdminEntitlements";
import AdminContent from "./pages/admin/AdminContent";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <ImpersonationBar />
          <div className="impersonation-offset">
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/auth" element={<Auth />} />
              <Route path="/accountant" element={<Accountant />} />
              <Route path="/business" element={<Business />} />
              <Route path="/audits" element={<Audits />} />
              <Route path="/self-development" element={<SelfDevelopment />} />
              <Route path="/tools/eisenhower" element={<EisenhowerMatrix />} />
              <Route path="/tools/balance-wheel" element={<BalanceWheel />} />
              <Route path="/pricing" element={<Pricing />} />
              {/* Admin routes */}
              <Route path="/admin/users" element={<AdminLayout><AdminUsers /></AdminLayout>} />
              <Route path="/admin/roles" element={<AdminLayout><AdminRoles /></AdminLayout>} />
              <Route path="/admin/audit" element={<AdminLayout><AdminAudit /></AdminLayout>} />
              <Route path="/admin/entitlements" element={<AdminLayout><AdminEntitlements /></AdminLayout>} />
              <Route path="/admin/content" element={<AdminLayout><AdminContent /></AdminLayout>} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </div>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
