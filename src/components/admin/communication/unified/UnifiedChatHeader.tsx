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
import type { UnifiedContactRow, UnifiedSource } from "@/hooks/useUnifiedInbox";

/**
 * UnifiedChatHeader (V3 profile-grouping).
 * Показывает единого «человека» + доступные каналы бейджами.
 * Клик по имени — ContactDetailSheet (если привязан profile).
 * Если у контакта есть IG-канал без profileId — иконка «Привязать».
 */
interface Props {
  contact: UnifiedContactRow;
  activeSource: UnifiedSource;
}

export function UnifiedChatHeader({ contact, activeSource }: Props) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const profileId = contact.profileId;
  const linked = !!profileId;

  // Единственный сценарий attach: одинокая IG-строка без profile.
  const igChannel = contact.channels.instagram;
  const igContactId = !linked && igChannel ? igChannel.sourceRow.meta.instagramContactId ?? null : null;

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

  const availableSources = contact.availableSources;

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
            <AvatarImage src={contact.avatarUrl || undefined} />
            <AvatarFallback className="text-[11px]">
              {contact.displayName[0]?.toUpperCase() || "?"}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-sm font-semibold truncate">
              <span className="truncate">{contact.displayName}</span>
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
            <div className="flex items-center gap-1 mt-0.5 flex-wrap">
              {availableSources.map((src) => (
                <SourceBadge
                  key={src}
                  source={src}
                  label={contact.channels[src]?.sourceRow.sourceLabel ?? null}
                  className={src === activeSource ? "ring-1 ring-primary/40" : "opacity-70"}
                />
              ))}
            </div>
          </div>
        </button>

        {igContactId && (
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

      {igContactId && (
        <AttachProfileDialog
          open={attachOpen}
          onOpenChange={setAttachOpen}
          instagramContactId={igContactId}
          igLabel={igChannel?.sourceRow.displayName ?? contact.displayName}
        />
      )}
    </TooltipProvider>
  );
}
