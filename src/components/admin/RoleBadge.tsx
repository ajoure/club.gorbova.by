import { Badge } from "@/components/ui/badge";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface Role {
  code: string;
  name: string;
}

interface RoleBadgeProps {
  role: Role;
  onRemove?: () => void;
  canRemove?: boolean;
  className?: string;
}

export function RoleBadge({ role, onRemove, canRemove = false, className }: RoleBadgeProps) {
  const getRoleBadgeStyles = (code: string) => {
    switch (code) {
      case "super_admin":
        return "bg-red-500/20 text-red-400 border-red-500/30";
      case "admin":
        return "bg-purple-500/20 text-purple-400 border-purple-500/30";
      case "editor":
        return "bg-blue-500/20 text-blue-400 border-blue-500/30";
      case "support":
        return "bg-green-500/20 text-green-400 border-green-500/30";
      case "staff":
        return "bg-amber-500/20 text-amber-400 border-amber-500/30";
      case "user":
      default:
        return "bg-muted text-muted-foreground border-border";
    }
  };

  const getRoleDisplayName = (role: Role) => {
    const displayNames: Record<string, string> = {
      super_admin: "Владелец",
      admin: "Администратор",
      editor: "Редактор",
      support: "Поддержка",
      staff: "Сотрудник",
      user: "Пользователь",
    };
    return displayNames[role.code] || role.name;
  };

  return (
    <Badge 
      variant="outline" 
      className={cn(
        "flex items-center gap-1 text-xs",
        getRoleBadgeStyles(role.code),
        className
      )}
    >
      {getRoleDisplayName(role)}
      {canRemove && onRemove && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="ml-1 hover:opacity-70 transition-opacity"
          aria-label={`Удалить роль ${getRoleDisplayName(role)}`}
        >
          <X className="w-3 h-3" />
        </button>
      )}
    </Badge>
  );
}
