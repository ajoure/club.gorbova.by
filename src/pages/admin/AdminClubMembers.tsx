import { AdminLayout } from "@/components/layout/AdminLayout";
import { TelegramClubsTab } from "@/components/telegram/TelegramClubsTab";

/**
 * Dedicated entry point for the independently configurable "Club members"
 * section. The previous menu link reused the Telegram integrations route,
 * which made a valid club-members grant fail the route guard (or exposed
 * unrelated integration tabs).
 */
export default function AdminClubMembers() {
  return (
    <AdminLayout>
      <div className="space-y-4 p-4 sm:p-6">
        <div>
          <h1 className="text-2xl font-semibold">Участники клуба</h1>
          <p className="text-sm text-muted-foreground">
            Выберите клуб, чтобы открыть состав, доступы и историю участников.
          </p>
        </div>
        <TelegramClubsTab />
      </div>
    </AdminLayout>
  );
}
