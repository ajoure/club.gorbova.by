import { useState, useEffect } from "react";
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
  lockDeal?: boolean;
  lockContact?: boolean;
}

interface DealDisplay {
  contact_name: string | null;
  product_name: string | null;
  short_id: string;
}

interface ContactDisplay {
  name: string;
}

/**
 * Shared deal/contact relation editor used inside Create/Edit task dialogs.
 * Uses optimistic display from picker payload so the pick is visible immediately
 * (before useTaskRelations refetch), which is what makes the pick feel "saved".
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

  // Optimistic cache — filled when user picks from picker.
  const [dealCache, setDealCache] = useState<Record<string, DealDisplay>>({});
  const [contactCache, setContactCache] = useState<Record<string, ContactDisplay>>({});

  const relations = useTaskRelations(
    dealId ? [dealId] : [],
    contactId ? [contactId] : [],
  );
  const dealFromServer = dealId ? relations.deals[dealId] : null;
  const contactFromServer = contactId ? relations.contacts[contactId] : null;

  // Merge: prefer server data (fresh) but fallback to picker cache while it loads.
  const dealDisplay: DealDisplay | null = dealId
    ? {
        contact_name:
          (dealFromServer as any)?.contact_name ?? dealCache[dealId]?.contact_name ?? null,
        product_name:
          (dealFromServer as any)?.product_name ?? dealCache[dealId]?.product_name ?? null,
        short_id:
          dealFromServer?.public_id ??
          dealCache[dealId]?.short_id ??
          dealId.slice(0, 8),
      }
    : null;

  const contactDisplay: ContactDisplay | null = contactId
    ? {
        name:
          contactFromServer?.full_name ||
          contactFromServer?.email ||
          contactFromServer?.phone ||
          contactCache[contactId]?.name ||
          "Контакт",
      }
    : null;

  // Clear cache entries when picker closes for entries no longer referenced.
  useEffect(() => {
    if (!dealId) return;
    // no-op; kept for potential eviction logic
  }, [dealId]);

  const handlePickDeal = (picked: PickedDeal) => {
    setDealCache((prev) => ({
      ...prev,
      [picked.id]: {
        contact_name: picked.contact_name ?? null,
        product_name: picked.product_name ?? null,
        short_id: picked.order_number ?? picked.id.slice(0, 8),
      },
    }));
    // If deal has a contact and current contact is empty, auto-fill it.
    if (picked.profile_id && !contactId) {
      setContactCache((prev) => ({
        ...prev,
        [picked.profile_id!]: { name: picked.contact_name || "Контакт" },
      }));
      onChangeContact(picked.profile_id);
    }
    onChangeDeal(picked.id);
    setDealPickerOpen(false);
  };

  const handlePickContact = (picked: PickedContact) => {
    setContactCache((prev) => ({
      ...prev,
      [picked.id]: {
        name:
          (picked as any).full_name ||
          (picked as any).email ||
          (picked as any).phone ||
          "Контакт",
      },
    }));
    onChangeContact(picked.id);
    setContactPickerOpen(false);
  };

  const renderClearButton = (visible: boolean, onClick: () => void, title: string) => (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      className={cn(
        "h-6 w-6 p-0 text-muted-foreground hover:text-rose-600",
        !visible && "invisible pointer-events-none",
      )}
      onClick={visible ? onClick : undefined}
      tabIndex={visible ? 0 : -1}
      title={title}
    >
      <X className="h-3.5 w-3.5" />
    </Button>
  );

  return (
    <div className={cn(TASK_DIALOG_SECTION, "grid grid-cols-1 sm:grid-cols-2 gap-3")}>
      {/* Deal */}
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2 h-6">
          <span className="text-sm font-medium flex items-center gap-1.5">
            <Briefcase className="h-3.5 w-3.5 text-muted-foreground" />
            Сделка
          </span>
          {renderClearButton(!!dealId && !lockDeal, () => onChangeDeal(null), "Отвязать сделку")}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full h-9 justify-start bg-white/80 font-normal px-2"
          onClick={() => setDealPickerOpen(true)}
          disabled={lockDeal}
        >
          {dealDisplay ? (
            <span className="flex flex-col items-start min-w-0 max-w-full leading-tight text-left">
              <span className="text-xs font-medium truncate max-w-full">
                {dealDisplay.contact_name || "Без контакта"}
              </span>
              <span className="text-[10px] text-muted-foreground truncate max-w-full">
                {dealDisplay.product_name || dealDisplay.short_id}
              </span>
            </span>
          ) : (
            <span className="text-muted-foreground">Выбрать сделку…</span>
          )}
        </Button>
      </div>

      {/* Contact */}
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2 h-6">
          <span className="text-sm font-medium flex items-center gap-1.5">
            <UserIcon className="h-3.5 w-3.5 text-muted-foreground" />
            Контакт
          </span>
          {renderClearButton(!!contactId && !lockContact, () => onChangeContact(null), "Отвязать контакт")}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full h-9 justify-start bg-white/80 font-normal px-2"
          onClick={() => setContactPickerOpen(true)}
          disabled={lockContact}
        >
          {contactDisplay ? (
            <span className="truncate text-xs">{contactDisplay.name}</span>
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
