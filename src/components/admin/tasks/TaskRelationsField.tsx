import { useState } from "react";
import { Briefcase, User as UserIcon, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DealPickerDialog, type PickedDeal } from "@/components/admin/shared/pickers/DealPickerDialog";
import { ContactPickerDialog, type PickedContact } from "@/components/admin/shared/pickers/ContactPickerDialog";
import { useTaskRelations } from "@/hooks/useTaskRelations";
import { TASK_DIALOG_SECTION } from "./taskUiTheme";
import { cn } from "@/lib/utils";

interface Props {
  dealId: string | null;
  contactId: string | null;
  onChangeDeal: (id: string | null) => void;
  onChangeContact: (id: string | null) => void;
  /** When dialog opened from deal/contact card we may want to lock that side. */
  lockDeal?: boolean;
  lockContact?: boolean;
}

/**
 * Shared deal/contact relation editor used inside Create/Edit task dialogs.
 * Uses pure DealPickerDialog / ContactPickerDialog (no DB write inside).
 */
export function TaskRelationsField({
  dealId,
  contactId,
  onChangeDeal,
  onChangeContact,
  lockDeal,
  lockContact,
}: Props) {
  const [dealPickerOpen, setDealPickerOpen] = useState(false);
  const [contactPickerOpen, setContactPickerOpen] = useState(false);

  const relations = useTaskRelations(
    dealId ? [dealId] : [],
    contactId ? [contactId] : [],
  );
  const deal = dealId ? relations.deals[dealId] : null;
  const contact = contactId ? relations.contacts[contactId] : null;

  const handlePickDeal = (picked: PickedDeal) => {
    onChangeDeal(picked.id);
    setDealPickerOpen(false);
  };

  const handlePickContact = (picked: PickedContact) => {
    onChangeContact(picked.id);
    setContactPickerOpen(false);
  };

  return (
    <div className={cn(TASK_DIALOG_SECTION, "grid grid-cols-1 sm:grid-cols-2 gap-3")}>
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium flex items-center gap-1.5">
            <Briefcase className="h-3.5 w-3.5 text-muted-foreground" />
            Сделка
          </span>
          {dealId && !lockDeal ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-6 w-6 p-0 text-muted-foreground hover:text-rose-600"
              onClick={() => onChangeDeal(null)}
              title="Отвязать сделку"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          ) : null}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full justify-start bg-white/80 font-normal"
          onClick={() => setDealPickerOpen(true)}
          disabled={lockDeal}
        >
          {deal ? (
            <span className="truncate">
              <span className="font-mono text-xs mr-1">
                {deal.public_id ?? deal.id.slice(0, 8)}
              </span>
              <span className="text-muted-foreground">· {deal.status ?? "—"}</span>
            </span>
          ) : (
            <span className="text-muted-foreground">Выбрать сделку…</span>
          )}
        </Button>
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium flex items-center gap-1.5">
            <UserIcon className="h-3.5 w-3.5 text-muted-foreground" />
            Контакт
          </span>
          {contactId && !lockContact ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-6 w-6 p-0 text-muted-foreground hover:text-rose-600"
              onClick={() => onChangeContact(null)}
              title="Отвязать контакт"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          ) : null}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full justify-start bg-white/80 font-normal"
          onClick={() => setContactPickerOpen(true)}
          disabled={lockContact}
        >
          {contact ? (
            <span className="truncate">
              {contact.full_name || contact.email || contact.phone || "Контакт"}
            </span>
          ) : (
            <span className="text-muted-foreground">Выбрать контакт…</span>
          )}
        </Button>
      </div>

      <DealPickerDialog
        open={dealPickerOpen}
        onOpenChange={setDealPickerOpen}
        onPick={handlePickDeal}
        options={{ title: "Привязать сделку к задаче" }}
      />
      <ContactPickerDialog
        open={contactPickerOpen}
        onOpenChange={setContactPickerOpen}
        onPick={handlePickContact}
        options={{ title: "Привязать контакт к задаче" }}
      />
    </div>
  );
}
