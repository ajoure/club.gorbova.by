import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { GlassCard } from "@/components/ui/GlassCard";
import { useAuth } from "@/contexts/AuthContext";
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
  const { user, role } = useAuth();

  const getRoleLabel = () => {
    switch (role) {
      case "superadmin":
        return "Супер Администратор";
      case "admin":
        return "Администратор";
      default:
        return "Пользователь";
    }
  };

  return (
    <DashboardLayout>
      <div className="max-w-7xl mx-auto space-y-8">
        {/* Welcome section */}
        <div>
          <h1 className="text-3xl font-bold text-foreground mb-2">
            Добро пожаловать, {user?.user_metadata?.full_name || "Пользователь"}!
          </h1>
          <p className="text-muted-foreground">
            Ваша роль: <span className="text-primary font-medium">{getRoleLabel()}</span>
          </p>
        </div>

        {/* Quick links grid */}
        <div>
          <h2 className="text-xl font-semibold text-foreground mb-4">Разделы</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {quickLinks.map((link) => (
              <Link key={link.url} to={link.url}>
                <GlassCard className="h-full hover:shadow-xl transition-all duration-300 hover:-translate-y-1 cursor-pointer group">
                  <div className="flex flex-col h-full">
                    <div
                      className={`w-12 h-12 rounded-xl bg-gradient-to-br ${link.color} flex items-center justify-center mb-4`}
                    >
                      <link.icon className="w-6 h-6 text-primary-foreground" />
                    </div>
                    <h3 className="font-semibold text-foreground mb-1 flex items-center gap-2">
                      {link.title}
                      <ArrowUpRight className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </h3>
                    <p className="text-sm text-muted-foreground">
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
          <h2 className="text-xl font-semibold text-foreground mb-4">
            Инструменты лидера
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {leaderTools.map((tool) => (
              <Link key={tool.url} to={tool.url}>
                <GlassCard className="hover:shadow-xl transition-all duration-300 hover:-translate-y-1 cursor-pointer group">
                  <div className="flex items-start gap-4">
                    <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center shrink-0">
                      <tool.icon className="w-7 h-7 text-primary-foreground" />
                    </div>
                    <div className="flex-1">
                      <h3 className="font-semibold text-foreground mb-1 flex items-center gap-2">
                        {tool.title}
                        <ArrowUpRight className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity" />
                      </h3>
                      <p className="text-sm text-muted-foreground">
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
