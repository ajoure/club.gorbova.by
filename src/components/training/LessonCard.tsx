import { useNavigate } from "react-router-dom";
import { GlassCard } from "@/components/ui/GlassCard";
import { Badge } from "@/components/ui/badge";
import { Play, Clock, Calendar, Lock, Video, Timer } from "lucide-react";
import { cn } from "@/lib/utils";
import { format, isFuture } from "date-fns";
import { ru } from "date-fns/locale";
import { getStatusBadgeClass } from "@/utils/badgeUtils";
import { formatLockedMonth } from "@/hooks/useMonthGate";

export interface LessonCardData {
  id: string;
  title: string;
  slug: string;
  description?: string | null;
  cover_image?: string | null;
  video_duration?: number | null;
  created_at?: string;
  published_at?: string | null; // Use for display instead of created_at if available
  sort_order?: number;
  has_access?: boolean;
  lock_reason?: "month_mismatch" | null;
  locked_month?: string | null;
}

interface LessonCardProps {
  lesson: LessonCardData;
  moduleSlug: string;
  variant?: "default" | "compact";
  episodeNumber?: number;
  isAdmin?: boolean;  // Admin can click even if scheduled
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function LessonCard({ 
  lesson, 
  moduleSlug, 
  variant = "default",
  episodeNumber,
  isAdmin = false 
}: LessonCardProps) {
  const navigate = useNavigate();
  const hasAccess = lesson.has_access !== false;
  const isMonthLocked = !isAdmin && lesson.lock_reason === "month_mismatch" && !!lesson.locked_month;

  // Check if lesson is scheduled for future
  const isScheduled = lesson.published_at && isFuture(new Date(lesson.published_at));
  const scheduledDate = isScheduled ? new Date(lesson.published_at!) : null;

  const handleClick = () => {
    // Block navigation when locked by month-gate (non-admin only)
    if (isMonthLocked) return;
    // If scheduled and not admin - don't navigate
    if (isScheduled && !isAdmin) {
      return;
    }
    navigate(`/library/${moduleSlug}/${lesson.slug}`);
  };

  // Prefer published_at over created_at for display
  const displayDate = lesson.published_at || lesson.created_at;
  const formattedDate = displayDate
    ? format(new Date(displayDate), "dd.MM.yyyy")
    : null;


  return (
    <GlassCard
      className={cn(
        "overflow-hidden group relative bg-background/60 backdrop-blur-xl border border-border/30 transition-all duration-300",
        !isScheduled && !isMonthLocked && "hover:border-primary/40 hover:shadow-xl cursor-pointer",
        isScheduled && !isAdmin && "cursor-not-allowed",
        isScheduled && isAdmin && "hover:border-amber-500/40 cursor-pointer",
        isMonthLocked && "cursor-not-allowed opacity-80",
        !hasAccess && "opacity-80"
      )}
      onClick={handleClick}
    >
      {/* Subtle inner glow */}
      <div className="absolute inset-0 bg-gradient-to-br from-white/5 via-transparent to-black/5 pointer-events-none rounded-2xl" />

      {/* Cover image or video placeholder */}
      <div className="aspect-video bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center relative overflow-hidden">
        {lesson.cover_image ? (
          <img
            src={lesson.cover_image}
            alt={lesson.title}
            className="w-full h-full object-cover transition-all duration-300 saturate-[0.85] brightness-[0.95] group-hover:saturate-100 group-hover:brightness-100 group-hover:scale-105"
          />
        ) : (
          <div className="flex items-center justify-center">
            <Video className="h-12 w-12 text-muted-foreground/30" />
          </div>
        )}
        
        <div className="absolute inset-0 bg-gradient-to-t from-background/80 to-transparent" />
        
        {/* Play button - smaller, appears on hover */}
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300">
          <div className="relative z-10 h-12 w-12 rounded-full bg-primary/90 flex items-center justify-center group-hover:scale-110 transition-transform shadow-lg">
            <Play className="h-5 w-5 text-primary-foreground ml-0.5" />
          </div>
        </div>

        {/* Episode number badge - показываем только если явно задан и больше 0 */}
        {episodeNumber && episodeNumber > 0 && (
          <div className="absolute top-3 left-3">
            <Badge variant="secondary" className="bg-background/80 backdrop-blur-sm">
              Выпуск #{episodeNumber}
            </Badge>
          </div>
        )}

        {/* Month-gate badge — highest priority */}
        {isMonthLocked && (
          <div className="absolute top-3 right-3">
            <Badge
              variant="outline"
              className={cn("gap-1 backdrop-blur-sm", getStatusBadgeClass("warning"))}
            >
              <Lock className="h-3 w-3" />
              Доступно за отдельную плату
            </Badge>
          </div>
        )}

        {/* Scheduled badge - "Скоро" */}
        {!isMonthLocked && isScheduled && scheduledDate && (
          <div className="absolute top-3 right-3">
            <Badge className="gap-1 bg-amber-500 hover:bg-amber-600 text-white">
              <Timer className="h-3 w-3" />
              Скоро: {format(scheduledDate, "d MMM в HH:mm", { locale: ru })}
            </Badge>
          </div>
        )}

        {/* Access badge - only show if not scheduled and not month-locked */}
        {!hasAccess && !isScheduled && !isMonthLocked && (
          <div className="absolute top-3 right-3">
            <Badge variant="secondary" className="gap-1 bg-background/80 backdrop-blur-sm">
              <Lock className="h-3 w-3" />
              Нет доступа
            </Badge>
          </div>
        )}

        {/* Duration badge */}
        {lesson.video_duration && (
          <div className="absolute bottom-3 right-3">
            <Badge variant="secondary" className="gap-1 bg-background/80 backdrop-blur-sm">
              <Clock className="h-3 w-3" />
              {formatDuration(lesson.video_duration)}
            </Badge>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="relative p-4">
        <h3 className="text-base font-semibold text-foreground leading-tight mb-2 group-hover:text-primary transition-colors line-clamp-2">
          {lesson.title}
        </h3>

        {/* Meta info */}
        {formattedDate && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground mt-2">
            <Calendar className="h-3.5 w-3.5" />
            {formattedDate}
          </div>
        )}
      </div>
    </GlassCard>
  );
}
