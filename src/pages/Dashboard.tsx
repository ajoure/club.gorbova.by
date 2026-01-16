import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { TelegramCompactCard } from "@/components/telegram/TelegramCompactCard";
import { TelegramLinkReminder } from "@/components/telegram/TelegramLinkReminder";
import { WelcomeOnboardingModal } from "@/components/onboarding/WelcomeOnboardingModal";
import { DailyAffirmation } from "@/components/dashboard/DailyAffirmation";
import { NewsBlock } from "@/components/dashboard/NewsBlock";
import { NavigationCards } from "@/components/dashboard/NavigationCards";
import { useAuth } from "@/contexts/AuthContext";
import { usePermissions } from "@/hooks/usePermissions";
import { ArrowUpRight } from "lucide-react";
import { Link } from "react-router-dom";

export default function Dashboard() {
  const { user } = useAuth();
  const { userRoles, hasAdminAccess, isAdmin } = usePermissions();

  // Get effective role for display (single role model)
  const getEffectiveRole = () => {
    const priority = ["super_admin", "admin", "editor", "support", "staff"];
    for (const code of priority) {
      const role = userRoles.find((r) => r.code === code);
      if (role) return role;
    }
    return null;
  };

  const effectiveRole = getEffectiveRole();
  const isStaff = effectiveRole !== null;
  const showAdmin = isAdmin() || hasAdminAccess();

  const getRoleDisplayName = (roleCode: string) => {
    const displayNames: Record<string, string> = {
      super_admin: "Владелец",
      admin: "Администратор",
      editor: "Редактор",
      support: "Поддержка",
      staff: "Сотрудник",
    };
    return displayNames[roleCode] || roleCode;
  };

  // Get user name from metadata
  const firstName = user?.user_metadata?.first_name || "";
  const lastName = user?.user_metadata?.last_name || "";
  const fullName = user?.user_metadata?.full_name || "";
  
  // Build display name: prefer first+last, fallback to full_name, then default
  const displayName = firstName 
    ? `${firstName}${lastName ? ` ${lastName}` : ""}` 
    : fullName || "Пользователь";

  return (
    <DashboardLayout>
      <WelcomeOnboardingModal />
      
      <div className="max-w-4xl mx-auto space-y-6 md:space-y-8">
        {/* Block 1: Welcome */}
        <div className="space-y-1">
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground">
            Добро пожаловать, {displayName}!
          </h1>
          {isStaff && effectiveRole && (
            <p className="text-sm text-muted-foreground">
              Роль: <span className="text-primary font-medium">{getRoleDisplayName(effectiveRole.code)}</span>
            </p>
          )}
          {showAdmin && (
            <Link
              to="/admin/users"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1 w-fit"
            >
              Перейти в админ-панель
              <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          )}
        </div>

        {/* Telegram compact + reminder */}
        <TelegramCompactCard />
        <TelegramLinkReminder />

        {/* Block 2: Daily Affirmation */}
        <DailyAffirmation />

        {/* Block 3: News Block */}
        <NewsBlock />

        {/* Block 4: Navigation Cards */}
        <div className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">Быстрый доступ</h2>
          <NavigationCards />
        </div>
      </div>
    </DashboardLayout>
  );
}
