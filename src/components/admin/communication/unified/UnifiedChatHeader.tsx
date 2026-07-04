import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Link2, Link2Off } from "lucide-react";
import { ContactDetailSheet } from "@/components/admin/ContactDetailSheet";
import { AttachProfileDialog } from "./AttachProfileDialog";
import { SourceBadge } from "./SourceBadge";
import type { UnifiedDialog } from "@/hooks/useUnifiedInbox";

/**
 * UnifiedChatHeader (V2-HEADERS)
 * Единый заголовок над правой панелью для TG/IG/Support:
 *   - имя/аватар → ContactDetailSheet in-place (без перехода на новую страницу)
 *     когда profileId привязан;
 *   - IG без profileId → компактная icon-кнопка Link2 (tooltip «Привязать к профилю»)
 *     открывает AttachProfileDialog;
 *   - TG/Support без profileId → tooltip «Не привязан к профилю», без ошибок.
 */
interface Props {
  row: UnifiedDialog;
}

export function UnifiedChatHeader({ row }: Props) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const profileId = row.meta.profileId ?? null;
  const igContactId = row.meta.instagramContactId ?? null;
  const linked = !!profileId;

  const profileQ = useQuery({
    queryKey: ["unified-header-profile", profileId],
    enabled: !!profileId && sheetOpen,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", profileId as string)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border/10 bg-background/60 shrink-0">
        <button
          type="button"
          disabled={!linked}
          onClick={() => linked && setSheetOpen(true)}
          className="flex items-center gap-2 min-w-0 flex-1 text-left rounded-md p-1 -m-1 hover:bg-muted/40 disabled:cursor-default disabled:hover:bg-transparent"
          title={linked ? "Открыть карточку контакта" : undefined}
        >
          <Avatar className="h-8 w-8 ring-1 ring-border/20">
            <AvatarImage src={row.avatarUrl || undefined} />
            <AvatarFallback className="text-[11px]">
              {row.displayName[0]?.toUpperCase() || "?"}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-sm font-semibold truncate">
              <span className="truncate">{row.displayName}</span>
              {!linked && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span>
                      <Link2Off className="h-3 w-3 text-muted-foreground shrink-0" />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-[11px]">
                    Не привязан к профилю
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
            <div className="flex items-center gap-1.5 mt-0.5">
              <SourceBadge source={row.source} label={row.sourceLabel} />
            </div>
          </div>
        </button>

        {!linked && row.source === "instagram" && igContactId && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-7 w-7 shrink-0"
                onClick={() => setAttachOpen(true)}
                aria-label="Привязать к профилю"
              >
                <Link2 className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-[11px]">
              Привязать к профилю
            </TooltipContent>
          </Tooltip>
        )}
      </div>

      {linked && (
        <ContactDetailSheet
          contact={profileQ.data as any}
          open={sheetOpen && !!profileQ.data}
          onOpenChange={setSheetOpen}
        />
      )}

      {row.source === "instagram" && igContactId && (
        <AttachProfileDialog
          open={attachOpen}
          onOpenChange={setAttachOpen}
          instagramContactId={igContactId}
          igLabel={row.displayName}
        />
      )}
    </TooltipProvider>
  );
}
