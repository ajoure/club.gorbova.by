import { AdminLayout } from "@/components/layout/AdminLayout";
import { useSearchParams } from "react-router-dom";
import { ClipboardList, FileText, GraduationCap, Layers, Download, LayoutList } from "lucide-react";
import { cn } from "@/lib/utils";
import { FormsAllTabContent } from "@/components/admin/forms/FormsAllTabContent";
import { FormsPreorderTabContent } from "@/components/admin/forms/FormsPreorderTabContent";
import { FormsSiteTabContent } from "@/components/admin/forms/FormsSiteTabContent";
import { FormsTrainingTabContent } from "@/components/admin/forms/FormsTrainingTabContent";
import { FormsByProductTabContent } from "@/components/admin/forms/FormsByProductTabContent";
import { FormsExportTabContent } from "@/components/admin/forms/FormsExportTabContent";

const tabs = [
  { id: "all", label: "Все", icon: LayoutList },
  { id: "site", label: "Анкеты сайта", icon: FileText },
  { id: "preorders", label: "Предзаписи", icon: ClipboardList },
  { id: "training", label: "Обучение", icon: GraduationCap },
  { id: "by-product", label: "По продуктам", icon: Layers },
  { id: "export", label: "Экспорт", icon: Download },
];

export default function AdminFormsHub() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get("tab") || "all";

  const handleTabChange = (tabId: string) => {
    setSearchParams({ tab: tabId }, { replace: true });
  };

  return (
    <AdminLayout fullHeight>
      <div className="h-full min-h-0 flex flex-col overflow-hidden">
        {/* Glass Pills Tabs */}
        <div className="px-3 md:px-4 pt-1 pb-1.5 shrink-0">
          <div className="inline-flex p-0.5 rounded-full bg-muted/40 backdrop-blur-md border border-border/20 overflow-x-auto max-w-full scrollbar-none">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => handleTabChange(tab.id)}
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

        {/* Tab Content — единственная вертикальная scroll-зона страницы.
            Горизонтальный скролл живёт ТОЛЬКО внутри таблиц (.table-scroll-x). */}
        <div
          className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden touch-scroll px-3 md:px-4 pb-4"
          style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom, 0px))' }}
        >
          {activeTab === "all" && <FormsAllTabContent />}
          {activeTab === "site" && <FormsSiteTabContent />}
          {activeTab === "preorders" && <FormsPreorderTabContent />}
          {activeTab === "training" && <FormsTrainingTabContent />}
          {activeTab === "by-product" && <FormsByProductTabContent />}
          {activeTab === "export" && <FormsExportTabContent />}
        </div>
      </div>
    </AdminLayout>
  );
}
