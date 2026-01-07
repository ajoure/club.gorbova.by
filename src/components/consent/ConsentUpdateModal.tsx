import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useConsent } from "@/hooks/useConsent";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Shield, ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";

export function ConsentUpdateModal() {
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const { needsConsentUpdate, currentPolicy, grantConsent, isLoading } = useConsent();
  const [accepted, setAccepted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleAccept = async () => {
    if (!accepted) {
      toast.error("Необходимо подтвердить согласие");
      return;
    }

    setIsSubmitting(true);
    try {
      await grantConsent.mutateAsync({ source: "modal" });
      toast.success("Согласие подтверждено");
    } catch (error) {
      console.error("Error granting consent:", error);
      toast.error("Ошибка при сохранении согласия");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLogout = async () => {
    await signOut();
    navigate("/");
  };

  if (isLoading || !needsConsentUpdate) {
    return null;
  }

  return (
    <Dialog open={needsConsentUpdate} onOpenChange={() => {}}>
      <DialogContent 
        className="sm:max-w-lg"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            Обновление политики конфиденциальности
          </DialogTitle>
          <DialogDescription>
            Для продолжения использования сервиса необходимо подтвердить согласие с новой редакцией политики.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {currentPolicy?.summary && (
            <div className="rounded-lg bg-muted/50 p-4">
              <p className="text-sm font-medium mb-2">Что изменилось:</p>
              <p className="text-sm text-muted-foreground">{currentPolicy.summary}</p>
            </div>
          )}

          <a
            href="/privacy"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-sm text-primary hover:underline"
          >
            <ExternalLink className="h-4 w-4" />
            Ознакомиться с политикой конфиденциальности
          </a>

          <div className="flex items-start gap-3 p-4 border rounded-lg">
            <Checkbox
              id="consent-accept"
              checked={accepted}
              onCheckedChange={(checked) => setAccepted(!!checked)}
            />
            <Label htmlFor="consent-accept" className="text-sm leading-snug cursor-pointer">
              Я ознакомлен(а) и согласен(на) с новой редакцией{" "}
              <a href="/privacy" target="_blank" className="text-primary hover:underline">
                Политики конфиденциальности
              </a>{" "}
              и даю согласие на обработку персональных данных
            </Label>
          </div>

          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={handleLogout}
              disabled={isSubmitting}
              className="flex-1"
            >
              Выйти из системы
            </Button>
            <Button
              onClick={handleAccept}
              disabled={!accepted || isSubmitting}
              className="flex-1"
            >
              {isSubmitting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Подтвердить
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
