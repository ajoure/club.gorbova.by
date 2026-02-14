import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Eye, Shield, ShieldCheck, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

interface Permission {
  id: string;
  code: string;
  name: string;
  category: string | null;
}

interface RoleTemplateSelectorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  allPermissions: Permission[];
  onSelectTemplate: (permissionCodes: string[]) => void;
}

interface Template {
  id: string;
  name: string;
  description: string;
  icon: React.ElementType;
  getPermissions: (all: Permission[]) => string[];
}

const templates: Template[] = [
  {
    id: "view_only",
    name: "Только просмотр",
    description: "Доступ ко всем разделам в режиме чтения. Идеально для наблюдателей и аудиторов.",
    icon: Eye,
    getPermissions: (all) => all.filter((p) => p.code.endsWith(".view")).map((p) => p.code),
  },
  {
    id: "full_access",
    name: "Полный доступ",
    description: "Все права на просмотр и редактирование. Для администраторов.",
    icon: ShieldCheck,
    getPermissions: (all) => all.map((p) => p.code),
  },
  {
    id: "empty",
    name: "Пустая роль",
    description: "Начните с нуля и выберите права вручную.",
    icon: Shield,
    getPermissions: () => [],
  },
];

export function RoleTemplateSelector({
  open,
  onOpenChange,
  allPermissions,
  onSelectTemplate,
}: RoleTemplateSelectorProps) {
  const handleSelect = (template: Template) => {
    const permissions = template.getPermissions(allPermissions);
    onSelectTemplate(permissions);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md overflow-hidden rounded-2xl border-border/30 backdrop-blur-xl bg-card/80">
        <DialogHeader className="pb-4 border-b border-border/20">
          <DialogTitle className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <Sparkles className="h-4 w-4 text-primary" />
            </div>
            Выберите шаблон роли
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground/70">
            Шаблон определит начальный набор прав для новой роли
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2.5 py-4 max-h-[60vh] overflow-y-auto">
          {templates.map((template) => {
            const Icon = template.icon;
            const permCount = template.getPermissions(allPermissions).length;

            return (
              <button
                key={template.id}
                className={cn(
                  "w-full text-left p-4 rounded-xl border border-border/20 bg-white/[0.03]",
                  "transition-all duration-200",
                  "hover:bg-white/[0.06] hover:shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.12)]",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                )}
                onClick={() => handleSelect(template)}
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <Icon className="h-4.5 w-4.5 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-sm">{template.name}</span>
                      <span className="text-xs text-muted-foreground/50 tabular-nums shrink-0">
                        {permCount} прав
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground/60 mt-0.5 line-clamp-1">
                      {template.description}
                    </p>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
