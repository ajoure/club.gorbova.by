import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MessageCircle, Send, LifeBuoy, Inbox, Settings } from "lucide-react";

// Import tab contents
import { SupportTabContent } from "@/components/admin/communication/SupportTabContent";
import { BroadcastsTabContent } from "@/components/admin/communication/BroadcastsTabContent";
import { InboxTabContent } from "@/components/admin/communication/InboxTabContent";
import { CommunicationSettingsTabContent } from "@/components/admin/communication/CommunicationSettingsTabContent";

export default function AdminCommunication() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<string>(
    searchParams.get("tab") || "inbox"
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
        <div className="px-4 md:px-6 pt-4 md:pt-6 pb-4 border-b shrink-0">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center">
              <MessageCircle className="h-5 w-5 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-xl md:text-2xl font-bold">Общение</h1>
              <p className="text-sm text-muted-foreground">
                Почта, техподдержка, рассылки и настройки
              </p>
            </div>
          </div>

          {/* Tabs */}
          <Tabs value={activeTab} onValueChange={handleTabChange}>
            <TabsList className="grid w-full max-w-2xl grid-cols-4">
              <TabsTrigger value="inbox" className="gap-2">
                <Inbox className="h-4 w-4" />
                <span className="hidden sm:inline">Почта</span>
              </TabsTrigger>
              <TabsTrigger value="support" className="gap-2">
                <LifeBuoy className="h-4 w-4" />
                <span className="hidden sm:inline">Техподдержка</span>
              </TabsTrigger>
              <TabsTrigger value="broadcasts" className="gap-2">
                <Send className="h-4 w-4" />
                <span className="hidden sm:inline">Рассылки</span>
              </TabsTrigger>
              <TabsTrigger value="settings" className="gap-2">
                <Settings className="h-4 w-4" />
                <span className="hidden sm:inline">Настройки</span>
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {/* Tab Content */}
        <div className="flex-1 min-h-0 overflow-hidden">
          {activeTab === "inbox" && <InboxTabContent />}
          {activeTab === "support" && <SupportTabContent />}
          {activeTab === "broadcasts" && <BroadcastsTabContent />}
          {activeTab === "settings" && <CommunicationSettingsTabContent />}
        </div>
      </div>
    </AdminLayout>
  );
}
