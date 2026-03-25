import { useEffect } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import type { ChatScenario } from "@/hooks/useAiChat";

interface ChatScenarioLauncherProps {
  scenarios: ChatScenario[];
  loading: boolean;
  onFetch: () => void;
  onSelect: (scenario: ChatScenario) => void;
  disabled?: boolean;
}

export function ChatScenarioLauncher({ scenarios, loading, onFetch, onSelect, disabled }: ChatScenarioLauncherProps) {
  useEffect(() => {
    onFetch();
  }, [onFetch]);

  if (scenarios.length === 0 && !loading) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-[44px] w-[44px] shrink-0" disabled={disabled || loading}>
          <Sparkles className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-72">
        <DropdownMenuLabel>Возможности помощника</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {scenarios.map(scenario => (
          <DropdownMenuItem key={scenario.id} onClick={() => onSelect(scenario)} className="flex flex-col items-start py-2">
            <span className="font-medium text-sm">{scenario.launcher_title}</span>
            {scenario.launcher_description && (
              <span className="text-xs text-muted-foreground mt-0.5">{scenario.launcher_description}</span>
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
