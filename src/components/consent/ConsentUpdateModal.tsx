import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useConsent } from "@/hooks/useConsent";
import { usePolicyVersions, PolicyVersion } from "@/hooks/usePolicyVersions";
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
import { Badge } from "@/components/ui/badge";
import { Shield, ExternalLink, Loader2, Plus, Minus, RefreshCw } from "lucide-react";
import { toast } from "sonner";

interface PolicyChange {
  type: "added" | "changed" | "removed";
  text: string;
}

function VersionChanges({ version }: { version: PolicyVersion | undefined }) {
  if (!version?.changes?.length) return null;

  const getChangeIcon = (type: PolicyChange["type"]) => {
    switch (type) {
      case "added":
        return <Plus className="h-3 w-3 text-green-500" />;
      case "removed":
        return <Minus className="h-3 w-3 text-destructive" />;
      case "changed":
        return <RefreshCw className="h-3 w-3 text-primary" />;
    }
  };

  const getChangeBadgeVariant = (type: PolicyChange["type"]) => {
    switch (type) {
      case "added":
        return "default" as const;
      case "removed":
        return "destructive" as const;
      case "changed":
        return "secondary" as const;
    }
  };

  const getChangeLabel = (type: PolicyChange["type"]) => {
    switch (type) {
      case "added":
        return "Добавлено";
      case "removed":
        return "Удалено";
      case "changed":
        return "Изменено";
    }
  };

  return (
    <div className="rounded-lg bg-muted/50 p-4 space-y-3">
      <p className="text-sm font-medium">Что изменилось:</p>
      {version.summary && (
        <p className="text-sm text-muted-foreground">{version.summary}</p>
      )}
      <div className="space-y-2">
        {version.changes.map((change, idx) => (
          <div key={idx} className="flex items-start gap-2 text-sm">
            {getChangeIcon(change.type)}
            <Badge variant={getChangeBadgeVariant(change.type)} className="shrink-0 text-xs">
              {getChangeLabel(change.type)}
            </Badge>
            <span className="text-muted-foreground">{change.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ConsentUpdateModal() {
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const { needsConsentUpdate, currentPolicy, grantConsent, isLoading } = useConsent();
  const { data: policyVersions } = usePolicyVersions();
  const [accepted, setAccepted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const currentVersion = policyVersions?.find((v) => v.is_current);

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
          <VersionChanges version={currentVersion} />

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
