import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  BookOpen,
  Pencil,
  Trash2,
  Eye,
  EyeOff,
  ChevronRight,
} from "lucide-react";
import { TrainingModule } from "@/hooks/useTrainingModules";

interface TrainingModuleCardProps {
  module: TrainingModule;
  onEdit: () => void;
  onDelete: () => void;
  onOpenLessons: () => void;
}

export default function TrainingModuleCard({
  module,
  onEdit,
  onDelete,
  onOpenLessons,
}: TrainingModuleCardProps) {
  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-2xl transition-all duration-300",
        "backdrop-blur-xl bg-card/60 dark:bg-card/40",
        "border border-border/50 hover:border-border",
        "shadow-lg hover:shadow-xl",
      )}
    >
      {/* Glassmorphism background */}
      <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent pointer-events-none" />
      
      {/* Color gradient bar */}
      <div className={cn("h-1.5 bg-gradient-to-r", module.color_gradient)} />
      
      <div className="relative p-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-lg truncate">{module.title}</h3>
            {module.description && (
              <p className="text-sm text-muted-foreground line-clamp-2 mt-1">
                {module.description}
              </p>
            )}
          </div>
          
          {/* Status badge */}
          <Badge
            variant={module.is_active ? "default" : "secondary"}
            className={cn(
              "shrink-0 gap-1",
              module.is_active && "bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20"
            )}
          >
            {module.is_active ? (
              <Eye className="h-3 w-3" />
            ) : (
              <EyeOff className="h-3 w-3" />
            )}
            {module.is_active ? "Активен" : "Скрыт"}
          </Badge>
        </div>
        
        {/* Stats row */}
        <div className="flex items-center gap-3 mb-4">
          <Badge variant="outline" className="gap-1 bg-background/50">
            <BookOpen className="h-3 w-3" />
            {module.lesson_count || 0} уроков
          </Badge>
          
          <code className="text-xs bg-muted/50 px-2 py-1 rounded text-muted-foreground">
            /library/{module.slug}
          </code>
        </div>
        
        {/* Tariffs */}
        {module.accessible_tariffs && module.accessible_tariffs.length > 0 && (
          <p className="text-xs text-muted-foreground mb-4">
            Тарифы: {module.accessible_tariffs.filter(Boolean).join(", ")}
          </p>
        )}
        
        {/* Actions */}
        <div className="flex items-center justify-between gap-2 pt-3 border-t border-border/50">
          <Button
            variant="ghost"
            size="sm"
            onClick={onOpenLessons}
            className="gap-1.5 text-primary hover:text-primary"
          >
            <BookOpen className="h-4 w-4" />
            Уроки
            <ChevronRight className="h-4 w-4" />
          </Button>
          
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={onEdit}
              className="h-8 w-8"
            >
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={onDelete}
              className="h-8 w-8 text-destructive hover:text-destructive"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
