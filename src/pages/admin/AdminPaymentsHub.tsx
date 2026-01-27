import { AdminLayout } from "@/components/layout/AdminLayout";
import { useLocation, useNavigate } from "react-router-dom";
import { CreditCard, ClipboardList, BarChart3, RefreshCw, FileSpreadsheet } from "lucide-react";
import { cn } from "@/lib/utils";

// Tab content components
import { PaymentsTabContent } from "@/components/admin/payments/PaymentsTabContent";
import { PreregistrationsTabContent } from "@/components/admin/payments/PreregistrationsTabContent";
import { DiagnosticsTabContent } from "@/components/admin/payments/DiagnosticsTabContent";
import { AutoRenewalsTabContent } from "@/components/admin/payments/AutoRenewalsTabContent";
import { BepaidStatementTabContent } from "@/components/admin/payments/BepaidStatementTabContent";

const tabs = [
  { id: "transactions", label: "Платежи", icon: CreditCard, path: "/admin/payments" },
  { id: "auto-renewals", label: "Автопродления", icon: RefreshCw, path: "/admin/payments/auto-renewals" },
  { id: "preorders", label: "Предзаписи", icon: ClipboardList, path: "/admin/payments/preorders" },
  { id: "diagnostics", label: "Диагностика", icon: BarChart3, path: "/admin/payments/diagnostics" },
  { id: "statement", label: "Выписка BePaid", icon: FileSpreadsheet, path: "/admin/payments/statement" },
];

export default function AdminPaymentsHub() {
  const location = useLocation();
  const navigate = useNavigate();
  
  // Determine active tab from path
  const getActiveTab = () => {
    const path = location.pathname;
    const matchedTab = tabs.find(t => t.path === path);
    return matchedTab?.id || "transactions";
  };
  
  const activeTab = getActiveTab();
  
  const handleTabChange = (path: string) => {
    navigate(path);
  };

  return (
    <AdminLayout>
      <div className="h-full min-h-0 flex flex-col overflow-hidden">
        {/* Glass Pills Tabs - identical to Contact Center */}
        <div className="px-3 md:px-4 pt-1 pb-1.5 shrink-0">
          <div className="inline-flex p-0.5 rounded-full bg-muted/40 backdrop-blur-md border border-border/20 overflow-x-auto max-w-full scrollbar-none">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              
              return (
                <button
                  key={tab.id}
                  onClick={() => handleTabChange(tab.path)}
                  className={cn(
                    "relative flex items-center gap-1.5 px-3 h-8 rounded-full text-xs transition-all duration-200 whitespace-nowrap",
                    isActive 
                      ? "bg-background text-foreground shadow-sm font-semibold" 
                      : "text-muted-foreground hover:text-foreground font-medium"
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">{tab.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Tab Content - unified padding */}
        <div className="flex-1 min-h-0 overflow-auto px-3 md:px-4 pb-4">
          {activeTab === "transactions" && <PaymentsTabContent />}
          {activeTab === "auto-renewals" && <AutoRenewalsTabContent />}
          {activeTab === "preorders" && <PreregistrationsTabContent />}
          {activeTab === "diagnostics" && <DiagnosticsTabContent />}
          {activeTab === "statement" && <BepaidStatementTabContent />}
        </div>
      </div>
    </AdminLayout>
  );
}
