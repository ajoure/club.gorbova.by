import { useEffect, useState } from "react";
import type { SiteBlock } from "@/services/sitePages/types";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { FormSection } from "./blocks/FormSection";
import { resolveSiteRegistrationAction } from "@/lib/siteRegistrationAction";

/** Existing HTML bridge + canonical form; no alternate auth or submission path. */
export function SiteRegistrationDialog({ blocks, pageId }: { blocks: SiteBlock[]; pageId: string }) {
  const [registration, setRegistration] = useState<ReturnType<typeof resolveSiteRegistrationAction>>(null);
  useEffect(() => {
    function open(event: Event) {
      const resolved = resolveSiteRegistrationAction(blocks, pageId, (event as CustomEvent).detail);
      if (resolved) setRegistration(resolved);
    }
    window.addEventListener("lovable:site-action", open);
    return () => window.removeEventListener("lovable:site-action", open);
  }, [blocks, pageId]);
  return <Dialog open={!!registration} onOpenChange={open => { if (!open) setRegistration(null); }}>
    <DialogContent className="site-webinar-registration max-h-[90dvh] overflow-y-auto sm:max-w-xl">
      <DialogTitle>Регистрация на вебинар</DialogTitle>
      <DialogDescription>Подтвердите почту и подключите support-бота. Пароль создавать не нужно.</DialogDescription>
      {registration && <FormSection content={registration.form.content} pageId={pageId} blockId={registration.form.id} initialContactValues={registration.contacts} />}
    </DialogContent>
  </Dialog>;
}
