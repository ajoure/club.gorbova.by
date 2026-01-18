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
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Loader2, Check, X, Video, ChevronDown, ChevronUp, Eye, EyeOff } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { IntegrationInstance, useIntegrationMutations } from "@/hooks/useIntegrations";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

interface KinescopeProject {
  id: string;
  name: string;
}

interface KinescopeConnectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existingInstance?: IntegrationInstance | null;
}

export function KinescopeConnectionDialog({
  open,
  onOpenChange,
  existingInstance,
}: KinescopeConnectionDialogProps) {
  const [apiToken, setApiToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [defaultProjectId, setDefaultProjectId] = useState("");
  const [privacyType, setPrivacyType] = useState("anywhere");
  const [privacyDomains, setPrivacyDomains] = useState("");
  
  const [isValidating, setIsValidating] = useState(false);
  const [validationResult, setValidationResult] = useState<{
    success: boolean;
    projects?: KinescopeProject[];
    error?: string;
  } | null>(null);
  
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  
  const queryClient = useQueryClient();
  const { createInstance, updateInstance } = useIntegrationMutations();

  // Load existing config
  useEffect(() => {
    if (existingInstance && open) {
      const config = existingInstance.config || {};
      setApiToken((config.api_token as string) || "");
      setDefaultProjectId((config.default_project_id as string) || "");
      setPrivacyType((config.privacy_type as string) || "anywhere");
      setPrivacyDomains((config.privacy_domains as string) || "");
      
      // If we have existing data, show validation as successful
      if (config.projects_count) {
        setValidationResult({
          success: true,
          projects: (config.projects as KinescopeProject[]) || [],
        });
      }
    } else if (!existingInstance && open) {
      // Reset form for new connection
      setApiToken("");
      setDefaultProjectId("");
      setPrivacyType("anywhere");
      setPrivacyDomains("");
      setValidationResult(null);
      setShowAdvanced(false);
    }
  }, [existingInstance, open]);

  const handleValidate = async () => {
    if (!apiToken.trim()) {
      toast.error("Введите API токен");
      return;
    }

    setIsValidating(true);
    setValidationResult(null);

    try {
      const { data, error } = await supabase.functions.invoke("kinescope-api", {
        body: {
          action: "validate_token",
          api_token: apiToken.trim(),
        },
      });

      if (error) {
        setValidationResult({ success: false, error: error.message });
        return;
      }

      if (data?.success) {
        setValidationResult({
          success: true,
          projects: data.projects || [],
        });
        toast.success(`Токен валиден! Найдено проектов: ${data.projects?.length || 0}`);
      } else {
        setValidationResult({
          success: false,
          error: data?.error || "Неверный токен",
        });
      }
    } catch (err) {
      setValidationResult({
        success: false,
        error: err instanceof Error ? err.message : "Ошибка валидации",
      });
    } finally {
      setIsValidating(false);
    }
  };

  const handleSave = async () => {
    if (!apiToken.trim()) {
      toast.error("Введите API токен");
      return;
    }

    if (!validationResult?.success) {
      toast.error("Сначала проверьте токен");
      return;
    }

    setIsSaving(true);

    try {
      const config = {
        api_token: apiToken.trim(),
        default_project_id: defaultProjectId || null,
        privacy_type: privacyType,
        privacy_domains: privacyDomains || null,
        projects_count: validationResult.projects?.length || 0,
        projects: validationResult.projects || [],
      };

      if (existingInstance) {
        await updateInstance.mutateAsync({
          id: existingInstance.id,
          config,
          status: "connected",
          error_message: null,
        });
      } else {
        await createInstance.mutateAsync({
          category: "other",
          provider: "kinescope",
          alias: "Kinescope",
          is_default: true,
          status: "connected",
          config,
          error_message: null,
        });
      }

      queryClient.invalidateQueries({ queryKey: ["integration-instances"] });
      onOpenChange(false);
      toast.success(existingInstance ? "Настройки обновлены" : "Kinescope подключен");
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
            <Video className="h-5 w-5" />
            {existingInstance ? "Настройки Kinescope" : "Подключение Kinescope"}
          </DialogTitle>
          <DialogDescription>
            Введите API токен из личного кабинета Kinescope для подключения видеохостинга
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* API Token */}
          <div className="space-y-2">
            <Label htmlFor="api_token">API Токен</Label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  id="api_token"
                  type={showToken ? "text" : "password"}
                  placeholder="Вставьте токен из Kinescope"
                  value={apiToken}
                  onChange={(e) => {
                    setApiToken(e.target.value);
                    setValidationResult(null);
                  }}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
                  onClick={() => setShowToken(!showToken)}
                >
                  {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={handleValidate}
                disabled={isValidating || !apiToken.trim()}
              >
                {isValidating ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Проверить"
                )}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Получите токен в{" "}
              <a
                href="https://app.kinescope.io/settings/api"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                настройках Kinescope → API
              </a>
            </p>
          </div>

          {/* Validation result */}
          {validationResult && (
            <div
              className={`p-3 rounded-lg ${
                validationResult.success
                  ? "bg-primary/10 text-primary"
                  : "bg-destructive/10 text-destructive"
              }`}
            >
              <div className="flex items-center gap-2">
                {validationResult.success ? (
                  <>
                    <Check className="h-4 w-4" />
                    <span>Токен валиден</span>
                    <Badge variant="secondary" className="ml-auto">
                      {validationResult.projects?.length || 0} проектов
                    </Badge>
                  </>
                ) : (
                  <>
                    <X className="h-4 w-4" />
                    <span>{validationResult.error}</span>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Projects list */}
          {validationResult?.success && validationResult.projects && validationResult.projects.length > 0 && (
            <div className="space-y-2">
              <Label>Проект по умолчанию</Label>
              <Select value={defaultProjectId || "__none__"} onValueChange={(v) => setDefaultProjectId(v === "__none__" ? "" : v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Выберите проект (опционально)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Не выбран</SelectItem>
                  {validationResult.projects.map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Advanced settings */}
          {validationResult?.success && (
            <Collapsible open={showAdvanced} onOpenChange={setShowAdvanced}>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="w-full justify-between">
                  <span>Расширенные настройки</span>
                  {showAdvanced ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-4 pt-4">
                <div className="space-y-2">
                  <Label>Приватность видео по умолчанию</Label>
                  <Select value={privacyType} onValueChange={setPrivacyType}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="anywhere">Доступно везде</SelectItem>
                      <SelectItem value="custom">Только на указанных доменах</SelectItem>
                      <SelectItem value="nowhere">Недоступно нигде</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {privacyType === "custom" && (
                  <div className="space-y-2">
                    <Label>Разрешённые домены</Label>
                    <Textarea
                      placeholder="gorbova.com&#10;school.gorbova.com"
                      value={privacyDomains}
                      onChange={(e) => setPrivacyDomains(e.target.value)}
                      rows={3}
                    />
                    <p className="text-xs text-muted-foreground">
                      Укажите по одному домену на строку
                    </p>
                  </div>
                )}
              </CollapsibleContent>
            </Collapsible>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button
            onClick={handleSave}
            disabled={isSaving || !validationResult?.success}
          >
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
