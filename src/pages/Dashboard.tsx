import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { GlassCard } from "@/components/ui/GlassCard";
import { TelegramCard } from "@/components/telegram/TelegramCard";
import { useAuth } from "@/contexts/AuthContext";
import { usePermissions } from "@/hooks/usePermissions";
import { 
  Calculator, 
  Briefcase, 
  ClipboardCheck, 
  Sparkles, 
  Target,
  ArrowUpRight,
  LayoutGrid,
} from "lucide-react";
import { Link } from "react-router-dom";

const quickLinks = [
  {
    title: "Бухгалтер",
    description: "Финансовый учет и отчетность",
    icon: Calculator,
    url: "/accountant",
    color: "from-blue-500 to-cyan-500",
  },
  {
    title: "Бизнес",
    description: "Управление бизнес-процессами",
    icon: Briefcase,
    url: "/business",
    color: "from-purple-500 to-pink-500",
  },
  {
    title: "Проверки",
    description: "Аудит и контроль качества",
    icon: ClipboardCheck,
    url: "/audits",
    color: "from-green-500 to-emerald-500",
  },
  {
    title: "Саморазвитие",
    description: "Личностный рост и обучение",
    icon: Sparkles,
    url: "/self-development",
    color: "from-orange-500 to-amber-500",
  },
];

const leaderTools = [
  {
    title: "Матрица продуктивности",
    description: "Приоритизация задач по важности и срочности",
    icon: LayoutGrid,
    url: "/tools/eisenhower",
  },
  {
    title: "Колесо баланса",
    description: "Стратегическое планирование через 8 этапов",
    icon: Target,
    url: "/tools/balance-wheel",
  },
];

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
    return null; // Regular user - no role to display
  };

  const effectiveRole = getEffectiveRole();
  const isStaff = effectiveRole !== null; // Has any privileged role
  const showAdmin = isAdmin() || hasAdminAccess();

  const getRoleDisplayName = (roleCode: string) => {
    const displayNames: Record<string, string> = {
      super_admin: "Супер-администратор",
      admin: "Администратор",
      editor: "Редактор",
      support: "Поддержка",
      staff: "Сотрудник",
    };
    return displayNames[roleCode] || roleCode;
  };

  return (
    <DashboardLayout>
      <div className="max-w-7xl mx-auto space-y-6 md:space-y-8">
        {/* Welcome section + Telegram card */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
          {/* Welcome */}
          <div className="lg:col-span-2 flex flex-col justify-center">
            <h1 className="text-2xl sm:text-3xl font-bold text-foreground mb-1 truncate">
              Добро пожаловать, {user?.user_metadata?.full_name || "Пользователь"}!
            </h1>
            {isStaff && effectiveRole && (
              <p className="text-sm text-muted-foreground">
                Роль: <span className="text-primary font-medium">{getRoleDisplayName(effectiveRole.code)}</span>
              </p>
            )}
            {showAdmin && (
              <Link
                to="/admin/users"
                className="text-sm text-muted-foreground hover:text-foreground transition-colors mt-2 inline-flex items-center gap-1 w-fit"
              >
                Перейти в админ-панель
                <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            )}
          </div>

          {/* Telegram Card */}
          <div className="lg:col-span-1">
            <TelegramCard />
          </div>
        </div>

        {/* Quick links grid */}
        <div>
          <h2 className="text-lg sm:text-xl font-semibold text-foreground mb-3 md:mb-4">Разделы</h2>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
            {quickLinks.map((link) => (
              <Link key={link.url} to={link.url}>
                <GlassCard className="h-full hover:shadow-xl transition-all duration-300 hover:-translate-y-1 cursor-pointer group p-4 md:p-6">
                  <div className="flex flex-col h-full">
                    <div
                      className={`w-10 h-10 md:w-12 md:h-12 rounded-xl bg-gradient-to-br ${link.color} flex items-center justify-center mb-3 md:mb-4`}
                    >
                      <link.icon className="w-5 h-5 md:w-6 md:h-6 text-primary-foreground" />
                    </div>
                    <h3 className="font-semibold text-foreground text-sm md:text-base mb-0.5 md:mb-1 flex items-center gap-1">
                      {link.title}
                      <ArrowUpRight className="w-3.5 h-3.5 md:w-4 md:h-4 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </h3>
                    <p className="text-xs md:text-sm text-muted-foreground line-clamp-2">
                      {link.description}
                    </p>
                  </div>
                </GlassCard>
              </Link>
            ))}
          </div>
        </div>

        {/* Leader tools */}
        <div>
          <h2 className="text-lg sm:text-xl font-semibold text-foreground mb-3 md:mb-4">
            Инструменты лидера
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 md:gap-4">
            {leaderTools.map((tool) => (
              <Link key={tool.url} to={tool.url}>
                <GlassCard className="hover:shadow-xl transition-all duration-300 hover:-translate-y-1 cursor-pointer group p-4 md:p-6">
                  <div className="flex items-start gap-3 md:gap-4">
                    <div className="w-12 h-12 md:w-14 md:h-14 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center shrink-0">
                      <tool.icon className="w-6 h-6 md:w-7 md:h-7 text-primary-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-foreground text-sm md:text-base mb-0.5 md:mb-1 flex items-center gap-1">
                        <span className="truncate">{tool.title}</span>
                        <ArrowUpRight className="w-3.5 h-3.5 md:w-4 md:h-4 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                      </h3>
                      <p className="text-xs md:text-sm text-muted-foreground line-clamp-2">
                        {tool.description}
                      </p>
                    </div>
                  </div>
                </GlassCard>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
