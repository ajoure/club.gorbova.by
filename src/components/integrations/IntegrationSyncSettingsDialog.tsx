import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  ArrowLeftRight,
  Users,
  ShoppingCart,
  CreditCard,
  FolderOpen,
  Building2,
  Handshake,
  RefreshCw,
  Trash2,
  Settings2,
} from "lucide-react";
import { IntegrationInstance } from "@/hooks/useIntegrations";
import {
  useSyncSettings,
  useFieldMappings,
  useSyncLogs,
  useSyncMutations,
  PROVIDER_ENTITIES,
  PROJECT_FIELDS,
  SyncSetting,
} from "@/hooks/useIntegrationSync";
import { toast } from "sonner";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";

const ENTITY_ICONS: Record<string, React.ElementType> = {
  users: Users,
  contacts: Users,
  orders: ShoppingCart,
  payments: CreditCard,
  groups: FolderOpen,
  companies: Building2,
  deals: Handshake,
};

const DIRECTION_OPTIONS = [
  { value: "import", label: "Импорт", icon: ArrowDownToLine, description: "Из внешней системы → Проект" },
  { value: "export", label: "Экспорт", icon: ArrowUpFromLine, description: "Из проекта → Внешняя система" },
  { value: "bidirectional", label: "Двусторонняя", icon: ArrowLeftRight, description: "В обе стороны" },
];

const CONFLICT_STRATEGIES = [
  { value: "project_wins", label: "Приоритет проекта" },
  { value: "external_wins", label: "Приоритет внешней системы" },
  { value: "by_updated_at", label: "По дате обновления" },
];

interface Props {
  instance: IntegrationInstance | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function IntegrationSyncSettingsDialog({ instance, open, onOpenChange }: Props) {
  const [activeTab, setActiveTab] = useState("entities");
  const [selectedEntity, setSelectedEntity] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const { data: syncSettings = [], refetch: refetchSettings } = useSyncSettings(instance?.id ?? null);
  const { data: fieldMappings = [] } = useFieldMappings(instance?.id ?? null, selectedEntity ?? undefined);
  const { data: syncLogs = [], refetch: refetchLogs } = useSyncLogs(instance?.id ?? null);
  const { upsertSyncSetting, clearSyncLogs } = useSyncMutations();

  if (!instance) return null;

  const entities = PROVIDER_ENTITIES[instance.provider] || [];
  
  const getSettingForEntity = (entityType: string): SyncSetting | undefined => {
    return syncSettings.find((s) => s.entity_type === entityType);
  };

  const handleToggleEntity = async (entityType: string, enabled: boolean) => {
    await upsertSyncSetting.mutateAsync({
      instance_id: instance.id,
      entity_type: entityType,
      is_enabled: enabled,
    });
    refetchSettings();
  };

  const handleDirectionChange = async (entityType: string, direction: string) => {
    await upsertSyncSetting.mutateAsync({
      instance_id: instance.id,
      entity_type: entityType,
      direction,
    });
    refetchSettings();
  };

  const handleConflictStrategyChange = async (entityType: string, strategy: string) => {
    await upsertSyncSetting.mutateAsync({
      instance_id: instance.id,
      entity_type: entityType,
      conflict_strategy: strategy,
    });
    refetchSettings();
  };

  const handleSyncNow = async () => {
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke("integration-sync", {
        body: {
          instance_id: instance.id,
          provider: instance.provider,
          config: instance.config,
        },
      });
      
      if (error) throw error;
      
      toast.success("Синхронизация запущена");
      refetchLogs();
    } catch (err) {
      toast.error("Ошибка синхронизации: " + (err instanceof Error ? err.message : "Неизвестная ошибка"));
    } finally {
      setSyncing(false);
    }
  };

  const handleClearLogs = async () => {
    await clearSyncLogs.mutateAsync(instance.id);
    refetchLogs();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings2 className="h-5 w-5" />
            Настройки синхронизации: {instance.alias}
          </DialogTitle>
          <DialogDescription>
            Настройте сущности, направление синхронизации и маппинг полей
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="entities">Сущности</TabsTrigger>
            <TabsTrigger value="mapping" disabled={!selectedEntity}>
              Маппинг полей
            </TabsTrigger>
            <TabsTrigger value="logs">Журнал</TabsTrigger>
          </TabsList>

          <TabsContent value="entities" className="mt-4">
            <ScrollArea className="h-[400px] pr-4">
              <div className="space-y-4">
                {entities.map((entity) => {
                  const Icon = ENTITY_ICONS[entity.id] || Users;
                  const setting = getSettingForEntity(entity.id);
                  const isEnabled = setting?.is_enabled ?? false;
                  const direction = setting?.direction ?? "import";
                  const conflictStrategy = setting?.conflict_strategy ?? "project_wins";

                  return (
                    <div
                      key={entity.id}
                      className={`border rounded-lg p-4 space-y-4 transition-colors ${
                        isEnabled ? "border-primary/50 bg-primary/5" : "border-border"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <Icon className="h-5 w-5 text-muted-foreground" />
                          <span className="font-medium">{entity.label}</span>
                          {isEnabled && (
                            <Badge variant="secondary" className="text-xs">
                              {DIRECTION_OPTIONS.find((d) => d.value === direction)?.label}
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-3">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setSelectedEntity(entity.id);
                              setActiveTab("mapping");
                            }}
                          >
                            Маппинг
                          </Button>
                          <Switch
                            checked={isEnabled}
                            onCheckedChange={(checked) => handleToggleEntity(entity.id, checked)}
                          />
                        </div>
                      </div>

                      {isEnabled && (
                        <div className="grid gap-4 md:grid-cols-2 pl-8">
                          <div className="space-y-2">
                            <Label className="text-sm text-muted-foreground">Направление</Label>
                            <RadioGroup
                              value={direction}
                              onValueChange={(val) => handleDirectionChange(entity.id, val)}
                              className="flex flex-col gap-2"
                            >
                              {DIRECTION_OPTIONS.map((opt) => (
                                <div key={opt.value} className="flex items-center gap-2">
                                  <RadioGroupItem value={opt.value} id={`${entity.id}-${opt.value}`} />
                                  <Label
                                    htmlFor={`${entity.id}-${opt.value}`}
                                    className="flex items-center gap-2 cursor-pointer"
                                  >
                                    <opt.icon className="h-4 w-4" />
                                    <span>{opt.label}</span>
                                  </Label>
                                </div>
                              ))}
                            </RadioGroup>
                          </div>

                          <div className="space-y-2">
                            <Label className="text-sm text-muted-foreground">Стратегия конфликтов</Label>
                            <Select
                              value={conflictStrategy}
                              onValueChange={(val) => handleConflictStrategyChange(entity.id, val)}
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {CONFLICT_STRATEGIES.map((s) => (
                                  <SelectItem key={s.value} value={s.value}>
                                    {s.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </ScrollArea>

            <div className="flex justify-between mt-4 pt-4 border-t">
              <Button variant="outline" onClick={handleSyncNow} disabled={syncing}>
                <RefreshCw className={`h-4 w-4 mr-2 ${syncing ? "animate-spin" : ""}`} />
                {syncing ? "Синхронизация..." : "Синхронизировать сейчас"}
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="mapping" className="mt-4">
            {selectedEntity && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="font-medium">
                    Маппинг полей: {entities.find((e) => e.id === selectedEntity)?.label}
                  </h4>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setSelectedEntity(null);
                      setActiveTab("entities");
                    }}
                  >
                    ← Назад к сущностям
                  </Button>
                </div>

                <ScrollArea className="h-[350px]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Поле проекта</TableHead>
                        <TableHead>Тип</TableHead>
                        <TableHead>Поле внешней системы</TableHead>
                        <TableHead className="w-[100px]">Ключевое</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(PROJECT_FIELDS[selectedEntity] || []).map((field) => {
                        const mapping = fieldMappings.find((m) => m.project_field === field.key);
                        return (
                          <TableRow key={field.key}>
                            <TableCell className="font-medium">
                              {field.label}
                              {field.required && <span className="text-destructive ml-1">*</span>}
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className="text-xs">
                                {field.type}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <input
                                type="text"
                                className="w-full px-2 py-1 text-sm border rounded bg-background"
                                placeholder="Название поля в системе"
                                defaultValue={mapping?.external_field || ""}
                              />
                            </TableCell>
                            <TableCell>
                              {field.key === "email" && (
                                <Badge className="bg-amber-500/10 text-amber-600 border-amber-500/20">
                                  Ключ
                                </Badge>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </ScrollArea>

                <div className="flex justify-end gap-2 pt-4 border-t">
                  <Button variant="outline" onClick={() => toast.info("Маппинг сброшен")}>
                    Сбросить
                  </Button>
                  <Button onClick={() => toast.success("Маппинг сохранён")}>
                    Сохранить маппинг
                  </Button>
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="logs" className="mt-4">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="font-medium">Журнал синхронизации</h4>
                <Button variant="ghost" size="sm" onClick={handleClearLogs}>
                  <Trash2 className="h-4 w-4 mr-2" />
                  Очистить
                </Button>
              </div>

              <ScrollArea className="h-[350px]">
                {syncLogs.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    Нет записей в журнале
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Дата</TableHead>
                        <TableHead>Сущность</TableHead>
                        <TableHead>Направление</TableHead>
                        <TableHead>Результат</TableHead>
                        <TableHead>Детали</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {syncLogs.map((log) => (
                        <TableRow key={log.id}>
                          <TableCell className="text-sm text-muted-foreground">
                            {format(new Date(log.created_at), "dd.MM.yy HH:mm", { locale: ru })}
                          </TableCell>
                          <TableCell>{log.entity_type}</TableCell>
                          <TableCell>
                            {log.direction === "import" ? (
                              <ArrowDownToLine className="h-4 w-4" />
                            ) : (
                              <ArrowUpFromLine className="h-4 w-4" />
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={log.result === "success" ? "default" : "destructive"}
                              className={log.result === "success" ? "bg-green-500/10 text-green-600" : ""}
                            >
                              {log.result === "success" ? "OK" : log.result === "skipped" ? "Пропущено" : "Ошибка"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">
                            {log.error_message || log.object_id || "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </ScrollArea>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
