import { useMemo } from "react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useMenuSections, MenuSectionWithChildren } from "@/hooks/useMenuSections";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Activity,
  BookOpen,
  Wallet,
  Sparkles,
  Cpu,
  GraduationCap,
  Briefcase,
  Calculator,
  ClipboardCheck,
  Folder,
  HelpCircle,
  Video,
  Scale,
  Library,
  Package,
  LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

// Icon mapping
const ICONS: Record<string, LucideIcon> = {
  Activity,
  BookOpen,
  Wallet,
  Sparkles,
  Cpu,
  GraduationCap,
  Briefcase,
  Calculator,
  ClipboardCheck,
  Folder,
  HelpCircle,
  Video,
  Scale,
  Library,
  Package,
};

interface MenuSectionSelectorProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

export function MenuSectionSelector({
  value,
  onChange,
  className,
}: MenuSectionSelectorProps) {
  const { data: sections, isLoading } = useMenuSections();

  // Build options with indentation for children
  const options = useMemo(() => {
    if (!sections) return [];

    const result: Array<{
      key: string;
      label: string;
      icon: string;
      isChild: boolean;
    }> = [];

    sections.forEach((parent) => {
      result.push({
        key: parent.key,
        label: parent.label,
        icon: parent.icon,
        isChild: false,
      });

      parent.children.forEach((child) => {
        result.push({
          key: child.key,
          label: child.label,
          icon: child.icon,
          isChild: true,
        });
      });
    });

    return result;
  }, [sections]);

  if (isLoading) {
    return (
      <div className={cn("space-y-2", className)}>
        <Label>Раздел меню</Label>
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  const getIcon = (iconName: string) => {
    const Icon = ICONS[iconName] || Folder;
    return Icon;
  };

  const selectedOption = options.find((o) => o.key === value);

  return (
    <div className={cn("space-y-2", className)}>
      <Label>Раздел меню</Label>
      <p className="text-xs text-muted-foreground mb-1">
        Где модуль будет отображаться в навигации пользователя
      </p>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue placeholder="Выберите раздел...">
            {selectedOption && (
              <div className="flex items-center gap-2">
                {(() => {
                  const Icon = getIcon(selectedOption.icon);
                  return <Icon className="h-4 w-4" />;
                })()}
                <span>{selectedOption.label}</span>
              </div>
            )}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => {
            const Icon = getIcon(option.icon);
            return (
              <SelectItem
                key={option.key}
                value={option.key}
                className={cn(option.isChild && "pl-8")}
              >
                <div className="flex items-center gap-2">
                  <Icon className="h-4 w-4" />
                  <span>{option.label}</span>
                </div>
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
    </div>
  );
}
