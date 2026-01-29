import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { GlassCard } from "@/components/ui/GlassCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Play, Clock, Calendar, Lock, Video, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

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
}

interface LessonCardProps {
  lesson: LessonCardData;
  moduleSlug: string;
  variant?: "default" | "compact";
  episodeNumber?: number;
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

// Minimum character count before showing expand option
const DESCRIPTION_TRUNCATE_THRESHOLD = 80;

export function LessonCard({ 
  lesson, 
  moduleSlug, 
  variant = "default",
  episodeNumber 
}: LessonCardProps) {
  const navigate = useNavigate();
  const hasAccess = lesson.has_access !== false;
  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false);

  const handleClick = () => {
    navigate(`/library/${moduleSlug}/${lesson.slug}`);
  };

  // Prefer published_at over created_at for display
  const displayDate = lesson.published_at || lesson.created_at;
  const formattedDate = displayDate
    ? format(new Date(displayDate), "dd.MM.yyyy")
    : null;

  // Check if description is long enough to need expand/hover
  const description = lesson.description || "";
  const isDescriptionLong = description.length > DESCRIPTION_TRUNCATE_THRESHOLD;

  // Toggle description expansion (for mobile)
  const handleExpandClick = (e: React.MouseEvent) => {
    e.stopPropagation(); // Don't navigate to lesson
    setIsDescriptionExpanded(!isDescriptionExpanded);
  };

  return (
    <GlassCard
      className={cn(
        "overflow-hidden group relative bg-background/60 backdrop-blur-xl border border-border/30 transition-all duration-300",
        "hover:border-primary/40 hover:shadow-xl cursor-pointer",
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

        {/* Access badge */}
        {!hasAccess && (
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

        {/* Description with expand/hover functionality */}
        {description && (
          <>
            {/* Desktop: HoverCard for long descriptions */}
            <div className="hidden md:block">
              {isDescriptionLong ? (
                <HoverCard openDelay={300} closeDelay={100}>
                  <HoverCardTrigger asChild>
                    <p className="text-sm text-muted-foreground leading-relaxed mb-3 line-clamp-2 cursor-help hover:text-foreground/70 transition-colors">
                      {description}
                    </p>
                  </HoverCardTrigger>
                  <HoverCardContent 
                    side="top" 
                    align="start" 
                    className="w-80 max-w-[90vw] p-4 bg-popover/95 backdrop-blur-md"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">
                      {description}
                    </p>
                  </HoverCardContent>
                </HoverCard>
              ) : (
                <p className="text-sm text-muted-foreground leading-relaxed mb-3 line-clamp-2">
                  {description}
                </p>
              )}
            </div>

            {/* Mobile/Tablet: Collapsible for long descriptions */}
            <div className="md:hidden">
              {isDescriptionLong ? (
                <Collapsible open={isDescriptionExpanded} onOpenChange={setIsDescriptionExpanded}>
                  <p className={cn(
                    "text-sm text-muted-foreground leading-relaxed transition-all",
                    !isDescriptionExpanded && "line-clamp-2"
                  )}>
                    {description}
                  </p>
                  <CollapsibleContent className="overflow-hidden">
                    {/* Content is shown in the p above when expanded */}
                  </CollapsibleContent>
                  <CollapsibleTrigger asChild>
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="h-8 px-2 mt-1 text-xs text-primary hover:text-primary/80 -ml-2"
                      onClick={handleExpandClick}
                    >
                      <ChevronDown className={cn(
                        "h-3 w-3 mr-1 transition-transform",
                        isDescriptionExpanded && "rotate-180"
                      )} />
                      {isDescriptionExpanded ? "Свернуть" : "Показать полностью"}
                    </Button>
                  </CollapsibleTrigger>
                </Collapsible>
              ) : (
                <p className="text-sm text-muted-foreground leading-relaxed mb-3">
                  {description}
                </p>
              )}
            </div>
          </>
        )}

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
