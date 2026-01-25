import { AdminLayout } from "@/components/layout/AdminLayout";
import { LinkBotStatusCard } from "@/components/admin/telegram/LinkBotStatusCard";
import { TelegramProfilesStats } from "@/components/admin/telegram/TelegramProfilesStats";
import { TelegramLogsSection } from "@/components/admin/telegram/TelegramLogsSection";
import { TelegramAuditSection } from "@/components/admin/telegram/TelegramAuditSection";

export default function AdminTelegramDiagnostics() {
  return (
    <AdminLayout>
      <div className="space-y-6 px-4 pb-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold">Telegram диагностика</h1>
        </div>
        
        {/* Section 1: Link-bot Status */}
        <LinkBotStatusCard />
        
        {/* Section 2: Telegram Profiles Stats */}
        <TelegramProfilesStats />
        
        {/* Section 3: Telegram Logs with filters */}
        <TelegramLogsSection />
        
        {/* Section 4: Audit Logs for Telegram */}
        <TelegramAuditSection />
      </div>
    </AdminLayout>
  );
}
