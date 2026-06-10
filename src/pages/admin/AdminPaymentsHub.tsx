import { AdminLayout } from "@/components/layout/AdminLayout";
import { useLocation, useNavigate } from "react-router-dom";
import { CreditCard, BarChart3, RefreshCw, FileSpreadsheet, Repeat, Link2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAutoRenewalAlerts } from "@/hooks/useAutoRenewalAlerts";
import { usePaymentIssuesCounters } from "@/hooks/admin/usePaymentIssuesCounters";

// Tab content components
import { PaymentsTabContent } from "@/components/admin/payments/PaymentsTabContent";
import { DiagnosticsTabContent } from "@/components/admin/payments/DiagnosticsTabContent";
import { AutoRenewalsTabContent } from "@/components/admin/payments/AutoRenewalsTabContent";
import { BepaidStatementTabContent } from "@/components/admin/payments/BepaidStatementTabContent";
import { BepaidSubscriptionsTabContent } from "@/components/admin/payments/BepaidSubscriptionsTabContent";
import { LinksTabContent } from "@/components/admin/payments/links/LinksTabContent";
import { PaymentIssuesTabContent } from "@/components/admin/payments/PaymentIssuesTabContent";

// PATCH-STRIPE-UI-INTEGRATION-CLEANUP-V1 (PATCH-F): «Проблемы с оплатой» скрыта из nav.
// Route /admin/payments/payment-issues остаётся доступным напрямую (legacy hidden);
// backend / PaymentIssuesTabContent НЕ удалены.
const tabs = [
  { id: "transactions", label: "Платежи", icon: CreditCard, path: "/admin/payments" },
  { id: "links", label: "Ссылки", icon: Link2, path: "/admin/payments/links" },
  { id: "auto-renewals", label: "Автопродления", icon: RefreshCw, path: "/admin/payments/auto-renewals" },
  { id: "bepaid-subs", label: "Подписки", icon: Repeat, path: "/admin/payments/bepaid-subscriptions" },
  { id: "diagnostics", label: "Диагностика", icon: BarChart3, path: "/admin/payments/diagnostics" },
  { id: "statement", label: "Выписка BePaid", icon: FileSpreadsheet, path: "/admin/payments/statement" },
];

export default function AdminPaymentsHub() {
  const location = useLocation();
  const navigate = useNavigate();
  const { data: renewalAlerts } = useAutoRenewalAlerts();
  const { data: paymentIssues } = usePaymentIssuesCounters();
  
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
    <AdminLayout fullHeight>
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
                  {/* PATCH 3.2: Alert dot for auto-renewals tab */}
                  {tab.id === 'auto-renewals' && renewalAlerts?.hasProblems && !isActive && (
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-destructive opacity-75" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-destructive" />
                    </span>
                  )}
                  {/* Phase 3.6-B: Alert dot for payment-issues tab */}
                  {tab.id === 'payment-issues' && paymentIssues?.hasProblems && !isActive && (
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-destructive opacity-75" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-destructive" />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Tab Content — единственная вертикальная scroll-зона страницы.
            Горизонтальный скролл живёт ТОЛЬКО внутри таблиц (.table-scroll-x). */}
        <div
          className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden touch-scroll px-3 md:px-4 pb-4"
          style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom, 0px))' }}
        >
          {activeTab === "transactions" && <PaymentsTabContent />}
          {activeTab === "links" && <LinksTabContent />}
          {activeTab === "auto-renewals" && <AutoRenewalsTabContent />}
          {activeTab === "bepaid-subs" && <BepaidSubscriptionsTabContent />}
          {activeTab === "payment-issues" && <PaymentIssuesTabContent />}
          {activeTab === "diagnostics" && <DiagnosticsTabContent />}
          {activeTab === "statement" && <BepaidStatementTabContent />}
        </div>
      </div>
    </AdminLayout>
  );
}
