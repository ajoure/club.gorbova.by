import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Combine, AlertTriangle } from "lucide-react";

interface Contact {
  id: string;
  user_id: string | null;
  email: string | null;
  full_name: string | null;
  phone: string | null;
  telegram_username: string | null;
  avatar_url: string | null;
  status: string;
  deals_count: number;
}

interface MergeContactsDialogProps {
  contacts: Contact[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function MergeContactsDialog({
  contacts,
  open,
  onOpenChange,
}: MergeContactsDialogProps) {
  const getInitials = (name: string | null) => {
    if (!name) return "?";
    return name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);
  };

  if (contacts.length < 2) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Combine className="h-5 w-5" />
            Объединить контакты
          </DialogTitle>
          <DialogDescription>
            Объединение временно недоступно: текущая реализация может частично
            перенести связанные данные и оставить служебные записи без результата.
          </DialogDescription>
        </DialogHeader>

        <div className="py-4 space-y-4">
          <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
            <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
            <p className="text-sm text-amber-700 dark:text-amber-400">
              Никакие контакты, сделки, доступы, платежи и переписки не будут изменены.
              Операция вернётся после согласования атомарного сценария и проверяемого разъединения.
            </p>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium">Выбранные контакты</p>
            <div className="space-y-2">
              {contacts.map((contact) => (
                <div
                  key={contact.id}
                  className="flex items-center gap-3 p-3 rounded-lg border"
                >
                  <Avatar className="h-10 w-10">
                    <AvatarImage src={contact.avatar_url || undefined} />
                    <AvatarFallback>{getInitials(contact.full_name)}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">
                      {contact.full_name || "Без имени"}
                    </p>
                    <p className="text-sm text-muted-foreground truncate">
                      {contact.email || contact.phone || "—"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {contact.deals_count > 0 && (
                      <Badge variant="secondary" className="text-xs">
                        {contact.deals_count} сделок
                      </Badge>
                    )}
                    {contact.status === "active" && (
                      <Badge variant="default" className="text-xs bg-green-500/20 text-green-600 border-green-500/30">
                        Активен
                      </Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

        </div>

        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Закрыть</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
