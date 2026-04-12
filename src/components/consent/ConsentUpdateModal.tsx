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
import { Shield, ExternalLink, Loader2, X } from "lucide-react";
import { toast } from "sonner";

const DOCUMENT_LINKS = [
  { href: "/offer", label: "Публичная оферта" },
  { href: "/privacy", label: "Политика конфиденциальности" },
  { href: "/consent", label: "Согласие на обработку персональных данных" },
];

export function ConsentUpdateModal() {
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const { needsConsentUpdate, grantConsent, isLoading } = useConsent();
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
        className="sm:max-w-lg max-h-[90vh] overflow-y-auto"
        showCloseButton={false}
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        {/* Custom close button = logout */}
        <button
          type="button"
          onClick={handleLogout}
          className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
          aria-label="Закрыть"
        >
          <X className="h-4 w-4" />
        </button>

        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            Обновление юридических документов
          </DialogTitle>
          <DialogDescription>
            Для продолжения использования сервиса необходимо ознакомиться с обновлёнными документами и подтвердить согласие.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Document links */}
          <div className="rounded-lg bg-muted/50 p-4 space-y-3">
            <p className="text-sm font-medium">Ознакомьтесь с документами:</p>
            <div className="space-y-2">
              {DOCUMENT_LINKS.map((doc) => (
                <a
                  key={doc.href}
                  href={doc.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-sm text-primary hover:underline"
                >
                  <ExternalLink className="h-4 w-4 shrink-0" />
                  {doc.label}
                </a>
              ))}
            </div>
          </div>

          {/* Consent checkbox */}
          <div className="flex items-start gap-3 p-4 border rounded-lg">
            <Checkbox
              id="consent-accept"
              checked={accepted}
              onCheckedChange={(checked) => setAccepted(!!checked)}
            />
            <Label htmlFor="consent-accept" className="text-sm leading-snug cursor-pointer">
              Я ознакомлен(а) и согласен(на) с{" "}
              <a href="/offer" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                Публичной офертой
              </a>
              ,{" "}
              <a href="/privacy" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                Политикой конфиденциальности
              </a>{" "}
              и{" "}
              <a href="/consent" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                Согласием на обработку персональных данных
              </a>
            </Label>
          </div>

          {/* Action buttons */}
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
