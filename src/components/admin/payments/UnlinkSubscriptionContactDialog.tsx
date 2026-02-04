import { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, UserMinus } from "lucide-react";

interface UnlinkSubscriptionContactDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subscriptionId: string; // bePaid subscription ID (sbs_*)
  profileId: string;
  profileName?: string | null;
  onSuccess: () => void;
}

export function UnlinkSubscriptionContactDialog({
  open,
  onOpenChange,
  subscriptionId,
  profileId,
  profileName,
  onSuccess,
}: UnlinkSubscriptionContactDialogProps) {
  const [loading, setLoading] = useState(false);

  const handleUnlink = async () => {
    setLoading(true);
    try {
      // Clear profile_id and user_id from provider_subscriptions
      const { error } = await supabase
        .from("provider_subscriptions")
        .update({ 
          profile_id: null,
          user_id: null 
        })
        .eq("provider_subscription_id", subscriptionId);
      
      if (error) throw error;
      
      toast.success("Контакт отвязан от подписки");
      onSuccess();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(`Ошибка: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="sm:max-w-[425px]">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <div className="h-10 w-10 rounded-full bg-destructive/10 flex items-center justify-center">
              <UserMinus className="h-5 w-5 text-destructive" />
            </div>
            Отвязать контакт
          </AlertDialogTitle>
          <AlertDialogDescription>
            Вы уверены, что хотите отвязать контакт{" "}
            <strong>{profileName || "Без имени"}</strong> от подписки?
            <br /><br />
            <code className="text-xs bg-muted px-1 py-0.5 rounded">{subscriptionId}</code>
          </AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading}>Отмена</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleUnlink}
            disabled={loading}
            className="bg-destructive hover:bg-destructive/90"
          >
            {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Отвязать
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
