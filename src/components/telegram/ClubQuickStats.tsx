import { ReactNode } from "react";
import { cn } from "@/lib/utils";
import {
  Users,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Ghost,
  Crown,
  Layers,
  UserCheck,
  MessageCircle,
  Radio,
  UserX,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  TelegramClub,
  EnrichedClubMember,
  ClubBusinessStats,
  ClubMemberSummary,
} from "@/hooks/useTelegramIntegration";


// ---------- Типы ----------

type FilterTab = "in_club" | "with_access" | "bought_not_joined" | "violators" | "removed";

interface ClubQuickStatsProps {
  club: TelegramClub;
  businessStats: ClubBusinessStats | null | undefined;
  members: EnrichedClubMember[] | undefined;
  isLoading?: boolean;
  isError?: boolean;
  onTabChange?: (tab: FilterTab) => void;
  // Данные из useClubMemberSummary
  violatorsCount?: number;
  outsideSystemCount?: number | null;
  withAccessTotal?: number | null;
  summary?: ClubMemberSummary | null;
  // Управляемый период (из родителя)
  period: number;
  onPeriodChange: (v: number) => void;
}

// ---------- Варианты карточек ----------
type CardVariant =
  | "default"
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "amber"
  | "ghost"
  | "violet"
  | "teal";

const variantStyles: Record<
  CardVariant,
  { text: string; iconBg: string; border: string }
> = {
  default: {
    text: "text-white/90",
    iconBg: "bg-white/10",
    border: "border-white/20",
  },
  success: {
    text: "text-emerald-300",
    iconBg: "bg-emerald-400/15",
    border: "border-emerald-400/30",
  },
  warning: {
    text: "text-amber-300",
    iconBg: "bg-amber-400/15",
    border: "border-amber-400/30",
  },
  danger: {
    text: "text-rose-300",
    iconBg: "bg-rose-400/15",
    border: "border-rose-400/30",
  },
  info: {
    text: "text-sky-300",
    iconBg: "bg-sky-400/15",
    border: "border-sky-400/30",
  },
  amber: {
    text: "text-amber-200",
    iconBg: "bg-amber-300/15",
    border: "border-amber-300/20",
  },
  ghost: {
    text: "text-violet-300",
    iconBg: "bg-violet-400/15",
    border: "border-violet-400/30",
  },
  violet: {
    text: "text-purple-300",
    iconBg: "bg-purple-400/15",
    border: "border-purple-400/30",
  },
  teal: {
    text: "text-teal-300",
    iconBg: "bg-teal-400/15",
    border: "border-teal-400/30",
  },
};

// ---------- Одна стеклянная карточка ----------
interface GlassStatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: ReactNode;
  variant?: CardVariant;
  tooltip?: string;
  onClick?: () => void;
  isLoading?: boolean;
}

function GlassStatCard({
  title,
  value,
  subtitle,
  icon,
  variant = "default",
  tooltip,
  onClick,
  isLoading,
}: GlassStatCardProps) {
  const s = variantStyles[variant];

  const inner = (
    <div
      onClick={onClick}
      className={cn(
        "relative overflow-hidden rounded-[18px] px-3 py-2.5 h-[80px]",
        "flex flex-col justify-between",
        "bg-white/[0.07] border",
        s.border,
        "shadow-[0_12px_40px_rgba(0,0,0,0.25),inset_0_0_0_1px_rgba(255,255,255,0.06)]",
        "transition-all duration-200",
        onClick &&
          "cursor-pointer hover:bg-white/[0.12] hover:scale-[1.02] hover:shadow-[0_16px_48px_rgba(0,0,0,0.30)]"
      )}
      style={{
        backdropFilter: "blur(20px) saturate(160%)",
        WebkitBackdropFilter: "blur(20px) saturate(160%)",
      }}
    >
      {/* Блик */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-10 left-[-20%] h-28 w-[140%] rotate-[-10deg] bg-gradient-to-b from-white/20 via-white/6 to-transparent" />
      </div>

      {/* Верхняя строка: заголовок + иконка */}
      <div className="relative z-10 flex items-start justify-between gap-1">
        <p className="text-[9px] font-semibold uppercase tracking-widest text-white/50 leading-tight">
          {title}
        </p>
        <div className={cn("shrink-0 p-1 rounded-lg", s.iconBg)}>
          {icon}
        </div>
      </div>

      {/* Нижняя строка: значение + субтитл */}
      <div className="relative z-10">
        {isLoading ? (
          <div className="h-6 w-14 rounded-md bg-white/10 animate-pulse" />
        ) : (
          <p
            className={cn(
              "text-xl font-bold tabular-nums tracking-tight leading-none",
              s.text
            )}
          >
            {value}
          </p>
        )}
        {subtitle && (
          <p className="text-[10px] text-white/40 mt-0.5 leading-tight">
            {subtitle}
          </p>
        )}
      </div>
    </div>
  );

  if (tooltip) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div>{inner}</div>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs text-xs" side="bottom">
          {tooltip}
        </TooltipContent>
      </Tooltip>
    );
  }

  return inner;
}

// ---------- Переключатель периода ----------
const PERIODS = [
  { label: "7 дн.", value: 7 },
  { label: "30 дн.", value: 30 },
  { label: "90 дн.", value: 90 },
];

interface PeriodSwitcherProps {
  value: number;
  onChange: (v: number) => void;
}

function PeriodSwitcher({ value, onChange }: PeriodSwitcherProps) {
  return (
    <div
      className="flex items-center gap-0.5 rounded-xl p-0.5"
      style={{
        background: "rgba(255,255,255,0.08)",
        border: "1px solid rgba(255,255,255,0.12)",
      }}
    >
      {PERIODS.map((p) => (
        <button
          key={p.value}
          onClick={() => onChange(p.value)}
          className={cn(
            "px-2.5 py-1 rounded-[10px] text-[11px] font-semibold transition-all duration-150",
            value === p.value
              ? "bg-white/20 text-white shadow-sm"
              : "text-white/50 hover:text-white/80"
          )}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}

// ---------- Цвета для тарифов ----------
const TARIFF_COLORS: CardVariant[] = ["info", "teal", "violet", "amber", "success"];
const TARIFF_ICONS = [Crown, Layers, Users, UserCheck, Crown];

// ---------- Скелетон-загрузка ----------
function SkeletonGrid({ count }: { count: number }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="h-[80px] rounded-[18px] bg-white/[0.07] animate-pulse"
        />
      ))}
    </div>
  );
}

// ---------- Основной компонент ----------
export function ClubQuickStats({
  club,
  businessStats,
  members,
  isLoading,
  isError,
  onTabChange,
  violatorsCount,
  outsideSystemCount,
  withAccessTotal,
  summary,
  period,
  onPeriodChange,
}: ClubQuickStatsProps) {

  const fmt = (n: number | null | undefined): string =>
    n === null || n === undefined ? "—" : String(n);

  return (
    <div className="relative isolate rounded-3xl p-4 overflow-hidden">
      {/* Тёмно-синий фон */}
      <div
        className="absolute inset-0 -z-10"
        style={{
          background:
            "linear-gradient(135deg, #0B2A6F 0%, #123B8B 50%, #0A1E4A 100%)",
        }}
      />
      {/* Цветовые пятна */}
      <div className="absolute -z-10 top-[-80px] left-[-80px] h-[260px] w-[260px] rounded-full bg-cyan-400/15 blur-[80px] pointer-events-none" />
      <div className="absolute -z-10 bottom-[-100px] right-[-100px] h-[320px] w-[320px] rounded-full bg-violet-500/12 blur-[100px] pointer-events-none" />

      {/* Заголовок + переключатель периода */}
      <div className="relative flex items-center justify-between mb-3">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-white/40">
          Статистика клуба
        </p>
        <PeriodSwitcher value={period} onChange={onPeriodChange} />
      </div>

      {/* ---- РЯД 1: Тарифы + Всего с доступом ---- */}
      <div className="relative mb-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/30 mb-2 px-0.5">
          По тарифам
        </p>

        {isLoading ? (
          <SkeletonGrid count={4} />
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {/* Карточки тарифов */}
            {(businessStats?.tariffs ?? []).map((tariff, i) => {
              const IconComp = TARIFF_ICONS[i % TARIFF_ICONS.length];
              return (
                <GlassStatCard
                  key={tariff.tariff_id}
                  title={tariff.tariff_name}
                  value={tariff.count}
                  subtitle="участников"
                  icon={<IconComp className="h-4 w-4 text-current opacity-80" />}
                  variant={TARIFF_COLORS[i % TARIFF_COLORS.length]}
                  tooltip={`Активные подписки по тарифу «${tariff.tariff_name}»`}
                  onClick={() => onTabChange?.("with_access")}
                />
              );
            })}

            {/* Карточка «Всего с доступом» — всегда последняя */}
            <GlassStatCard
              title="Всего с доступом"
              value={isError ? "—" : fmt(withAccessTotal)}
              subtitle="уникальных участников"
              icon={<UserCheck className="h-4 w-4 text-emerald-300" />}
              variant="success"
              tooltip="Уникальные участники с действующим доступом (status=active и end_at > сейчас)"
              onClick={() => onTabChange?.("with_access")}
              isLoading={isLoading}
            />
          </div>
        )}
      </div>

      {/* ---- РЯД 2: Динамика ---- */}
      <div className="relative">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/30 mb-2 px-0.5">
          Динамика · {period} дней
        </p>

        {isLoading ? (
          <SkeletonGrid count={4} />
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {/* Новые */}
            <GlassStatCard
              title="Новые"
              value={isError ? "—" : fmt(businessStats?.newCount)}
              subtitle="получили первый доступ"
              icon={<TrendingUp className="h-4 w-4 text-emerald-300" />}
              variant="success"
              tooltip={`Пользователи, чей первый доступ (грант) был создан за последние ${period} дней. Включает тех, кто уже ушёл.`}
              onClick={() => onTabChange?.("with_access")}
              isLoading={isLoading}
            />

            {/* Не продлили */}
            <GlassStatCard
              title="Не продлили"
              value={isError ? "—" : fmt(businessStats?.revokedCount)}
              subtitle="ушли из клуба"
              icon={<TrendingDown className="h-4 w-4 text-rose-300" />}
              variant="danger"
              tooltip={`Участники, чей последний доступ истёк за последние ${period} дней и которые не вернулись`}
              onClick={() => onTabChange?.("removed")}
              isLoading={isLoading}
            />

            {/* Вне системы */}
            <GlassStatCard
              title="Вне системы"
              value={outsideSystemCount !== null && outsideSystemCount !== undefined ? outsideSystemCount : "—"}
              subtitle="не привязали Telegram"
              icon={<Ghost className="h-4 w-4 text-violet-300" />}
              variant="ghost"
              tooltip="Физически в чате/канале, но не привязали Telegram к нашей системе — бот не может их удалить"
            />

            {/* Нарушители */}
            <GlassStatCard
              title="Нарушители"
              value={isError ? "—" : fmt(violatorsCount)}
              subtitle="в чате без доступа"
              icon={<AlertTriangle className="h-4 w-4 text-rose-300" />}
              variant="danger"
              tooltip="Присутствуют в чате или канале, но активного доступа нет — подлежат удалению"
              onClick={violatorsCount ? () => onTabChange?.("violators") : undefined}
            />
          </div>
        )}
      </div>

    </div>
  );
}
