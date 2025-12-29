import { useState } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, ArrowLeft, ArrowRight } from "lucide-react";
import {
  PROVIDERS,
  ProviderConfig,
  IntegrationCategory,
  useIntegrationMutations,
  getSmtpSettings,
} from "@/hooks/useIntegrations";

interface AddIntegrationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  category?: IntegrationCategory;
  preselectedProvider?: string;
}

export function AddIntegrationDialog({
  open,
  onOpenChange,
  category,
  preselectedProvider,
}: AddIntegrationDialogProps) {
  const { createInstance } = useIntegrationMutations();
  const [step, setStep] = useState<"provider" | "config">(preselectedProvider ? "config" : "provider");
  const [selectedProvider, setSelectedProvider] = useState<ProviderConfig | null>(
    preselectedProvider ? PROVIDERS.find((p) => p.id === preselectedProvider) || null : null
  );
  const [formData, setFormData] = useState<Record<string, string | boolean>>({
    alias: "",
    is_default: false,
  });

  const availableProviders = category
    ? PROVIDERS.filter((p) => p.category === category)
    : PROVIDERS;

  const handleSelectProvider = (provider: ProviderConfig) => {
    setSelectedProvider(provider);
    setFormData({ alias: provider.name, is_default: false });
    setStep("config");
  };

  const handleFieldChange = (key: string, value: string | boolean) => {
    setFormData((prev) => ({ ...prev, [key]: value }));

    // Auto-detect SMTP settings for email
    if (key === "email" && selectedProvider?.id === "smtp" && typeof value === "string") {
      const settings = getSmtpSettings(value);
      if (settings) {
        setFormData((prev) => ({
          ...prev,
          [key]: value,
          smtp_host: settings.host,
          smtp_port: String(settings.port),
        }));
      }
    }
  };

  const handleSubmit = async () => {
    if (!selectedProvider) return;

    const { alias, is_default, ...configFields } = formData;

    await createInstance.mutateAsync({
      category: selectedProvider.category,
      provider: selectedProvider.id,
      alias: String(alias) || selectedProvider.name,
      is_default: Boolean(is_default),
      status: "disconnected",
      config: configFields as Record<string, unknown>,
      error_message: null,
    });

    handleClose();
  };

  const handleClose = () => {
    setStep(preselectedProvider ? "config" : "provider");
    setSelectedProvider(preselectedProvider ? PROVIDERS.find((p) => p.id === preselectedProvider) || null : null);
    setFormData({ alias: "", is_default: false });
    onOpenChange(false);
  };

  const isValid = () => {
    if (!selectedProvider) return false;
    const requiredFields = selectedProvider.fields.filter((f) => f.required);
    return requiredFields.every((f) => formData[f.key]);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {step === "provider" ? "Выберите провайдера" : `Настройка ${selectedProvider?.name}`}
          </DialogTitle>
        </DialogHeader>

        {step === "provider" && (
          <div className="grid gap-2">
            {availableProviders.map((provider) => (
              <Button
                key={provider.id}
                variant="outline"
                className="justify-start h-auto py-3"
                onClick={() => handleSelectProvider(provider)}
              >
                <div className="text-left">
                  <div className="font-medium">{provider.name}</div>
                  {provider.description && (
                    <div className="text-xs text-muted-foreground">{provider.description}</div>
                  )}
                </div>
              </Button>
            ))}
          </div>
        )}

        {step === "config" && selectedProvider && (
          <div className="space-y-4">
            {!preselectedProvider && (
              <Button
                variant="ghost"
                size="sm"
                className="mb-2"
                onClick={() => setStep("provider")}
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                Назад
              </Button>
            )}

            <div className="space-y-2">
              <Label htmlFor="alias">Название подключения</Label>
              <Input
                id="alias"
                value={String(formData.alias || "")}
                onChange={(e) => handleFieldChange("alias", e.target.value)}
                placeholder={selectedProvider.name}
              />
            </div>

            {selectedProvider.fields.map((field) => (
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
              <Label htmlFor="is_default">Сделать подключением по умолчанию</Label>
            </div>

            <div className="flex justify-end gap-2 pt-4">
              <Button variant="outline" onClick={handleClose}>
                Отмена
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={!isValid() || createInstance.isPending}
              >
                {createInstance.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Создать
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
