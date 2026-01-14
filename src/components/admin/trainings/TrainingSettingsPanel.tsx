import { useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Settings2,
  ChevronDown,
  LayoutGrid,
  LayoutList,
  SlidersHorizontal,
} from "lucide-react";

export type ViewDensity = 'compact' | 'comfortable';

interface TrainingSettingsPanelProps {
  density: ViewDensity;
  onDensityChange: (density: ViewDensity) => void;
  showAdvanced: boolean;
  onShowAdvancedChange: (show: boolean) => void;
}

export default function TrainingSettingsPanel({
  density,
  onDensityChange,
  showAdvanced,
  onShowAdvancedChange,
}: TrainingSettingsPanelProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl",
        "backdrop-blur-xl bg-card/60 dark:bg-card/40",
        "border border-border/50",
        "shadow-lg"
      )}
    >
      {/* Glassmorphism background */}
      <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent pointer-events-none" />
      
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger asChild>
          <Button
            variant="ghost"
            className="w-full justify-between p-4 h-auto rounded-xl hover:bg-transparent"
          >
            <div className="flex items-center gap-2">
              <Settings2 className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">Настройки отображения</span>
            </div>
            <ChevronDown
              className={cn(
                "h-4 w-4 text-muted-foreground transition-transform",
                isOpen && "rotate-180"
              )}
            />
          </Button>
        </CollapsibleTrigger>
        
        <CollapsibleContent>
          <div className="px-4 pb-4 space-y-4">
            {/* Density toggle */}
            <div className="flex items-center justify-between py-2">
              <div className="flex items-center gap-2">
                <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
                <Label className="font-normal">Плотность</Label>
              </div>
              <div className="flex items-center gap-1 bg-muted/50 rounded-lg p-1">
                <Button
                  variant={density === 'compact' ? 'secondary' : 'ghost'}
                  size="sm"
                  onClick={() => onDensityChange('compact')}
                  className="gap-1.5 h-7 px-2.5"
                >
                  <LayoutList className="h-3.5 w-3.5" />
                  Компакт
                </Button>
                <Button
                  variant={density === 'comfortable' ? 'secondary' : 'ghost'}
                  size="sm"
                  onClick={() => onDensityChange('comfortable')}
                  className="gap-1.5 h-7 px-2.5"
                >
                  <LayoutGrid className="h-3.5 w-3.5" />
                  Удобный
                </Button>
              </div>
            </div>
            
            {/* Advanced settings toggle */}
            <div className="flex items-center justify-between py-2">
              <div className="flex flex-col gap-0.5">
                <Label htmlFor="show-advanced" className="font-normal">
                  Расширенные настройки
                </Label>
                <span className="text-xs text-muted-foreground">
                  Показывать дополнительные опции
                </span>
              </div>
              <Switch
                id="show-advanced"
                checked={showAdvanced}
                onCheckedChange={onShowAdvancedChange}
              />
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
