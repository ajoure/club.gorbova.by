import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Save } from "lucide-react";
import {
  PROVIDERS,
  IntegrationInstance,
  useIntegrationMutations,
} from "@/hooks/useIntegrations";
import { WebhookUrlDisplay } from "./WebhookUrlDisplay";

interface EditIntegrationDialogProps {
  instance: IntegrationInstance | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EditIntegrationDialog({
  instance,
  open,
  onOpenChange,
}: EditIntegrationDialogProps) {
  const { updateInstance } = useIntegrationMutations();
  const [formData, setFormData] = useState<Record<string, string | boolean>>({});

  const provider = instance ? PROVIDERS.find((p) => p.id === instance.provider) : null;

  useEffect(() => {
    if (instance) {
      setFormData({
        alias: instance.alias,
        is_default: instance.is_default,
        ...(instance.config as Record<string, string | boolean>),
      });
    }
  }, [instance]);

  const handleFieldChange = (key: string, value: string | boolean) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async () => {
    if (!instance) return;

    const { alias, is_default, ...configFields } = formData;

    await updateInstance.mutateAsync({
      id: instance.id,
      alias: String(alias),
      is_default: Boolean(is_default),
      config: configFields as Record<string, unknown>,
    });

    onOpenChange(false);
  };

  if (!instance || !provider) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Настройки: {instance.alias}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="alias">Название подключения</Label>
            <Input
              id="alias"
              value={String(formData.alias || "")}
              onChange={(e) => handleFieldChange("alias", e.target.value)}
            />
          </div>

          {provider.fields.map((field) => (
            <div key={field.key} className="space-y-2">
              {field.type === "checkbox" ? (
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id={field.key}
                    checked={Boolean(formData[field.key])}
                    onCheckedChange={(checked) => handleFieldChange(field.key, Boolean(checked))}
                  />
                  <Label htmlFor={field.key}>{field.label}</Label>
                </div>
              ) : field.type === "select" ? (
                <>
                  <Label htmlFor={field.key}>
                    {field.label}
                    {field.required && <span className="text-destructive ml-1">*</span>}
                  </Label>
                  <Select
                    value={String(formData[field.key] || "")}
                    onValueChange={(value) => handleFieldChange(field.key, value)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Выберите..." />
                    </SelectTrigger>
                    <SelectContent>
                      {field.options?.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </>
              ) : (
                <>
                  <Label htmlFor={field.key}>
                    {field.label}
                    {field.required && <span className="text-destructive ml-1">*</span>}
                  </Label>
                  <Input
                    id={field.key}
                    type={field.type}
                    value={String(formData[field.key] || "")}
                    onChange={(e) => handleFieldChange(field.key, e.target.value)}
                    placeholder={field.placeholder}
                  />
                </>
              )}
            </div>
          ))}

          <div className="flex items-center space-x-2">
            <Checkbox
              id="is_default"
              checked={Boolean(formData.is_default)}
              onCheckedChange={(checked) => handleFieldChange("is_default", Boolean(checked))}
            />
            <Label htmlFor="is_default">Подключение по умолчанию</Label>
          </div>

          {/* Webhook URL section for supported providers */}
          {["amocrm", "bepaid", "getcourse"].includes(instance.provider) && (
            <>
              <Separator className="my-4" />
              <WebhookUrlDisplay instanceId={instance.id} provider={instance.provider} />
            </>
          )}

          <div className="flex justify-end gap-2 pt-4">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Отмена
            </Button>
            <Button onClick={handleSubmit} disabled={updateInstance.isPending}>
              {updateInstance.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              <Save className="h-4 w-4 mr-2" />
              Сохранить
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
