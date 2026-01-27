import { cn } from "@/lib/utils";
import { Folder, Video, BookOpen, FileText } from "lucide-react";

export type ContentType = "module" | "lesson";

interface ContentTypeSelectorProps {
  value: ContentType;
  onChange: (value: ContentType) => void;
}

const OPTIONS = [
  {
    value: "module" as const,
    icon: Folder,
    title: "Модуль",
    description: "Папка с уроками внутри (курс, раздел)",
  },
  {
    value: "lesson" as const,
    icon: Video,
    title: "Урок",
    description: "Отдельный урок (видеоответ, выпуск)",
  },
];

export function ContentTypeSelector({ value, onChange }: ContentTypeSelectorProps) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Выберите, что хотите создать:
      </p>
      
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {OPTIONS.map((option) => {
          const Icon = option.icon;
          const isSelected = value === option.value;
          
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onChange(option.value)}
              className={cn(
                "relative flex flex-col items-center p-6 rounded-xl border-2 transition-all duration-200 text-left",
                "hover:border-primary/50 hover:bg-accent/30",
                isSelected
                  ? "border-primary bg-primary/10 shadow-md"
                  : "border-border/50 bg-background/50"
              )}
            >
              <div
                className={cn(
                  "w-14 h-14 rounded-xl flex items-center justify-center mb-4 transition-colors",
                  isSelected
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground"
                )}
              >
                <Icon className="h-7 w-7" />
              </div>
              
              <h3 className="text-base font-semibold text-foreground mb-1">
                {option.title}
              </h3>
              <p className="text-sm text-muted-foreground text-center">
                {option.description}
              </p>
              
              {isSelected && (
                <div className="absolute top-3 right-3 w-5 h-5 rounded-full bg-primary flex items-center justify-center">
                  <svg className="w-3 h-3 text-primary-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
