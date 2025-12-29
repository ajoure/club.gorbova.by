import { useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Link2, CreditCard, Mail } from "lucide-react";
import AdminAmoCRM from "./AdminAmoCRM";
import AdminPayments from "./AdminPayments";
import AdminEmail from "./AdminEmail";

const TABS = [
  { value: "crm", label: "CRM", icon: Link2, path: "/admin/integrations/crm" },
  { value: "payments", label: "Платежи", icon: CreditCard, path: "/admin/integrations/payments" },
  { value: "email", label: "Почта", icon: Mail, path: "/admin/integrations/email" },
];

export default function AdminIntegrations() {
  const navigate = useNavigate();
  const location = useLocation();
  
  // Determine active tab from URL
  const getActiveTab = () => {
    if (location.pathname.includes("/integrations/payments")) return "payments";
    if (location.pathname.includes("/integrations/email")) return "email";
    return "crm";
  };
  
  const activeTab = getActiveTab();
  
  const handleTabChange = (value: string) => {
    const tab = TABS.find(t => t.value === value);
    if (tab) {
      navigate(tab.path);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Интеграции</h1>
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
        <TabsList className="grid w-full grid-cols-3 max-w-md">
          {TABS.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value} className="flex items-center gap-2">
              <tab.icon className="h-4 w-4" />
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <div className="mt-6">
          <TabsContent value="crm" className="m-0">
            <AdminAmoCRM embedded />
          </TabsContent>
          
          <TabsContent value="payments" className="m-0">
            <AdminPayments embedded />
          </TabsContent>
          
          <TabsContent value="email" className="m-0">
            <AdminEmail />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
