import { useEffect } from "react";
import { Sparkles, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { ChatScenario } from "@/hooks/useAiChat";
import type { AiAccessStatus } from "@/hooks/useAiAccess";
import { isScenarioAllowed, scenarioDenialMessage } from "@/hooks/useAiAccess";

interface ChatScenarioLauncherProps {
  scenarios: ChatScenario[];
  loading: boolean;
  onFetch: () => void;
  onSelect: (scenario: ChatScenario) => void;
  disabled?: boolean;
  access?: AiAccessStatus;
  onLockedClick?: (scenario: ChatScenario, message: string) => void;
}

export function ChatScenarioLauncher({
  scenarios,
  loading,
  onFetch,
  onSelect,
  disabled,
  access,
  onLockedClick,
}: ChatScenarioLauncherProps) {
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
      <DropdownMenuContent side="top" align="start" className="w-80">
        <DropdownMenuLabel>Возможности помощника</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <TooltipProvider>
          {scenarios.map((scenario) => {
            const code = scenario.code ?? null;
            // Если access ещё не загружен — считаем доступным (не блокируем UX до резолва).
            const allowed = access && code ? isScenarioAllowed(access, code) : true;
            const denialMsg = scenarioDenialMessage(access, code);
            const item = (
              <DropdownMenuItem
                key={scenario.id}
                onSelect={(e) => {
                  if (!allowed) {
                    e.preventDefault();
                    if (onLockedClick && denialMsg) onLockedClick(scenario, denialMsg);
                    return;
                  }
                  onSelect(scenario);
                }}
                className={`flex flex-col items-start py-2 ${!allowed ? "opacity-60 cursor-not-allowed" : ""}`}
              >
                <div className="flex items-center gap-2 w-full">
                  {!allowed && <Lock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                  <span className="font-medium text-sm">{scenario.launcher_title}</span>
                </div>
                {scenario.launcher_description && (
                  <span className="text-xs text-muted-foreground mt-0.5">{scenario.launcher_description}</span>
                )}
                {!allowed && denialMsg && (
                  <span className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">{denialMsg}</span>
                )}
              </DropdownMenuItem>
            );
            return allowed ? item : (
              <Tooltip key={`${scenario.id}-wrap`}>
                <TooltipTrigger asChild>{item}</TooltipTrigger>
                <TooltipContent side="right">{denialMsg || "Недоступно на вашем тарифе"}</TooltipContent>
              </Tooltip>
            );
          })}
        </TooltipProvider>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
