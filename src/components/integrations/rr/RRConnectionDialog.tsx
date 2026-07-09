import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, Wallet, Eye, EyeOff, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import {
  IntegrationInstance,
  useIntegrationMutations,
} from "@/hooks/useIntegrations";

interface RRConnectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existingInstance?: IntegrationInstance | null;
}

type RRMode = "test" | "battle";

export function RRConnectionDialog({
  open,
  onOpenChange,
  existingInstance,
}: RRConnectionDialogProps) {
  const [mode, setMode] = useState<RRMode>("test");
  const [testLogin, setTestLogin] = useState("");
  const [testPassword, setTestPassword] = useState("");
  const [battleLogin, setBattleLogin] = useState("");
  const [battlePassword, setBattlePassword] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [showSecrets, setShowSecrets] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const queryClient = useQueryClient();
  const { createInstance, updateInstance } = useIntegrationMutations();

  // Признаки уже сохранённых секретов (для placeholder «не менять»)
  const hasSavedTestPassword = !!existingInstance?.config?.test_password_configured;
  const hasSavedBattlePassword = !!existingInstance?.config?.battle_password_configured;
  const hasSavedSecretKey = !!existingInstance?.config?.secret_key_configured;

  useEffect(() => {
    if (!open) return;
    if (existingInstance) {
      const config = existingInstance.config || {};
      setMode(((config.mode as RRMode) || "test") as RRMode);
      setTestLogin((config.test_login as string) || "");
      setBattleLogin((config.battle_login as string) || "");
      // Секреты обратно не подтягиваем — пустое поле = «не менять».
      setTestPassword("");
      setBattlePassword("");
      setSecretKey("");
    } else {
      setMode("test");
      setTestLogin("");
      setBattleLogin("");
      setTestPassword("");
      setBattlePassword("");
      setSecretKey("");
    }
  }, [existingInstance, open]);

  const handleSave = async () => {
    // Валидация для нового подключения — секретный ключ обязателен
    if (!existingInstance && !secretKey.trim()) {
      toast.error("Секретный ключ обязателен");
      return;
    }
    // Для боевого режима нужен как минимум логин
    if (mode === "battle" && !battleLogin.trim() && !existingInstance) {
      toast.error("Для боевого режима укажите боевой логин");
      return;
    }
    if (mode === "test" && !testLogin.trim() && !existingInstance) {
      toast.error("Для тестового режима укажите тестовый логин");
      return;
    }

    setIsSaving(true);

    try {
      // Плоский набор полей — splitConfigBySecrets разложит по config / config_secrets.
      // Пустые пароли/ключ не отправляем, чтобы merge-логика в updateInstance сохранила старые.
      const fields: Record<string, unknown> = {
        mode,
        test_login: testLogin.trim() || null,
        battle_login: battleLogin.trim() || null,
        // Маркеры «configured» — для отображения в карточке без раскрытия значений.
        test_password_configured:
          hasSavedTestPassword || !!testPassword.trim(),
        battle_password_configured:
          hasSavedBattlePassword || !!battlePassword.trim(),
        secret_key_configured: hasSavedSecretKey || !!secretKey.trim(),
      };
      if (testPassword.trim()) fields.test_password = testPassword.trim();
      if (battlePassword.trim()) fields.battle_password = battlePassword.trim();
      if (secretKey.trim()) fields.secret_key = secretKey.trim();

      if (existingInstance) {
        await updateInstance.mutateAsync({
          id: existingInstance.id,
          provider: "rr",
          config: fields,
          error_message: null,
        });
      } else {
        await createInstance.mutateAsync({
          category: "other",
          provider: "rr",
          alias: "Ресурс Развития",
          is_default: true,
          status: "disconnected",
          config: fields,
          error_message: null,
        });
      }

      queryClient.invalidateQueries({ queryKey: ["integration-instances"] });
      onOpenChange(false);
      toast.success(existingInstance ? "Настройки обновлены" : "Ресурс Развития подключён");
    } catch (err) {
      toast.error("Ошибка сохранения");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wallet className="h-5 w-5" />
            {existingInstance
              ? "Настройки «Ресурс Развития»"
              : "Подключение «Ресурс Развития»"}
          </DialogTitle>
          <DialogDescription>
            Все данные хранятся безопасно: пароли и секретный ключ не отображаются
            обратно после сохранения. Оставьте поле пустым — прежнее значение
            сохранится.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <Alert>
            <ShieldCheck className="h-4 w-4" />
            <AlertDescription className="text-xs">
              Секреты сохраняются в защищённое хранилище (encrypted-at-rest),
              не попадают в логи и не выводятся в интерфейсе.
            </AlertDescription>
          </Alert>

          {/* Режим */}
          <div className="space-y-2">
            <Label htmlFor="rr-mode">Режим</Label>
            <Select value={mode} onValueChange={(v) => setMode(v as RRMode)}>
              <SelectTrigger id="rr-mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="test">Тестовый</SelectItem>
                <SelectItem value="battle">Боевой</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Показать/скрыть секреты */}
          <div className="flex items-center justify-end">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setShowSecrets((v) => !v)}
            >
              {showSecrets ? (
                <>
                  <EyeOff className="h-4 w-4 mr-2" /> Скрыть значения
                </>
              ) : (
                <>
                  <Eye className="h-4 w-4 mr-2" /> Показать вводимые значения
                </>
              )}
            </Button>
          </div>

          {/* Тестовые креды */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="rr-test-login">Логин (тестовый)</Label>
              <Input
                id="rr-test-login"
                value={testLogin}
                onChange={(e) => setTestLogin(e.target.value)}
                placeholder="test-login"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rr-test-password">Пароль (тестовый)</Label>
              <Input
                id="rr-test-password"
                type={showSecrets ? "text" : "password"}
                value={testPassword}
                onChange={(e) => setTestPassword(e.target.value)}
                placeholder={hasSavedTestPassword ? "•••••••• (не менять)" : "введите пароль"}
              />
            </div>
          </div>

          {/* Боевые креды */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="rr-battle-login">Логин (боевой)</Label>
              <Input
                id="rr-battle-login"
                value={battleLogin}
                onChange={(e) => setBattleLogin(e.target.value)}
                placeholder="battle-login"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rr-battle-password">Пароль (боевой)</Label>
              <Input
                id="rr-battle-password"
                type={showSecrets ? "text" : "password"}
                value={battlePassword}
                onChange={(e) => setBattlePassword(e.target.value)}
                placeholder={hasSavedBattlePassword ? "•••••••• (не менять)" : "введите пароль"}
              />
            </div>
          </div>

          {/* Секретный ключ */}
          <div className="space-y-2">
            <Label htmlFor="rr-secret-key">Секретный ключ</Label>
            <Input
              id="rr-secret-key"
              type={showSecrets ? "text" : "password"}
              value={secretKey}
              onChange={(e) => setSecretKey(e.target.value)}
              placeholder={
                hasSavedSecretKey
                  ? "•••••••• (не менять)"
                  : "Секретный ключ для подписи запросов"
              }
            />
            <p className="text-xs text-muted-foreground">
              Используется для валидации подписи webhook-ов «Ресурс Развития».
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Сохранение...
              </>
            ) : existingInstance ? (
              "Сохранить"
            ) : (
              "Подключить"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
