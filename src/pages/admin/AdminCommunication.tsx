import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MessageCircle, Send, LifeBuoy } from "lucide-react";

// Import support content
import { SupportTabContent } from "@/components/admin/communication/SupportTabContent";
// Import broadcasts content
import { BroadcastsTabContent } from "@/components/admin/communication/BroadcastsTabContent";

export default function AdminCommunication() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<string>(
    searchParams.get("tab") || "support"
  );

  // Sync tab with URL
  useEffect(() => {
    const tabFromUrl = searchParams.get("tab");
    if (tabFromUrl && tabFromUrl !== activeTab) {
      setActiveTab(tabFromUrl);
    }
  }, [searchParams]);

  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    setSearchParams({ tab });
  };

  return (
    <AdminLayout>
      <div className="h-full flex flex-col">
        {/* Header */}
        <div className="p-4 md:p-6 border-b">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center">
              <MessageCircle className="h-5 w-5 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-xl md:text-2xl font-bold">Общение</h1>
              <p className="text-sm text-muted-foreground">
                Техподдержка и рассылки
              </p>
            </div>
          </div>

          {/* Tabs */}
          <Tabs value={activeTab} onValueChange={handleTabChange}>
            <TabsList className="grid w-full max-w-md grid-cols-2">
              <TabsTrigger value="support" className="gap-2">
                <LifeBuoy className="h-4 w-4" />
                Техподдержка
              </TabsTrigger>
              <TabsTrigger value="broadcasts" className="gap-2">
                <Send className="h-4 w-4" />
                Рассылки
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-hidden">
          {activeTab === "support" && <SupportTabContent />}
          {activeTab === "broadcasts" && <BroadcastsTabContent />}
        </div>
      </div>
    </AdminLayout>
  );
}
