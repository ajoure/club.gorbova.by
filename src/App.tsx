import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { ImpersonationBar } from "@/components/layout/ImpersonationBar";
import { ProtectedRoute } from "@/components/layout/ProtectedRoute";
import Landing from "./pages/Landing";
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
import MnsResponseService from "./pages/audits/MnsResponseService";
import MnsDocumentHistory from "./pages/audits/MnsDocumentHistory";

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
              {/* Public routes */}
              <Route path="/" element={<Landing />} />
              <Route path="/auth" element={<Auth />} />
              <Route path="/pricing" element={<Pricing />} />
              
              {/* Protected routes */}
              <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
              <Route path="/accountant" element={<ProtectedRoute><Accountant /></ProtectedRoute>} />
              <Route path="/business" element={<ProtectedRoute><Business /></ProtectedRoute>} />
              <Route path="/audits" element={<ProtectedRoute><Audits /></ProtectedRoute>} />
              <Route path="/audits/mns-response" element={<ProtectedRoute><MnsResponseService /></ProtectedRoute>} />
              <Route path="/audits/mns-history" element={<ProtectedRoute><MnsDocumentHistory /></ProtectedRoute>} />
              <Route path="/self-development" element={<ProtectedRoute><SelfDevelopment /></ProtectedRoute>} />
              <Route path="/tools/eisenhower" element={<ProtectedRoute><EisenhowerMatrix /></ProtectedRoute>} />
              <Route path="/tools/balance-wheel" element={<ProtectedRoute><BalanceWheel /></ProtectedRoute>} />
              
              {/* Admin routes */}
              <Route path="/admin/users" element={<ProtectedRoute><AdminLayout><AdminUsers /></AdminLayout></ProtectedRoute>} />
              <Route path="/admin/roles" element={<ProtectedRoute><AdminLayout><AdminRoles /></AdminLayout></ProtectedRoute>} />
              <Route path="/admin/audit" element={<ProtectedRoute><AdminLayout><AdminAudit /></AdminLayout></ProtectedRoute>} />
              <Route path="/admin/entitlements" element={<ProtectedRoute><AdminLayout><AdminEntitlements /></AdminLayout></ProtectedRoute>} />
              <Route path="/admin/content" element={<ProtectedRoute><AdminLayout><AdminContent /></AdminLayout></ProtectedRoute>} />
              
              <Route path="*" element={<NotFound />} />
            </Routes>
          </div>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
