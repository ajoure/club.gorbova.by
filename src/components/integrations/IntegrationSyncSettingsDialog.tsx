import { useState, useRef } from "react";
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
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
  CalendarIcon,
  Filter,
  Save,
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
import { cn } from "@/lib/utils";

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

const ORDER_STATUSES = [
  { value: "new", label: "Новый" },
  { value: "pending", label: "Ожидает оплаты" },
  { value: "paid", label: "Оплачен" },
  { value: "cancelled", label: "Отменён" },
  { value: "refunded", label: "Возврат" },
];

const PAYMENT_TYPES = [
  { value: "card", label: "Карта" },
  { value: "invoice", label: "Счёт" },
  { value: "cash", label: "Наличные" },
  { value: "online", label: "Онлайн-платёж" },
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
  const [savingMapping, setSavingMapping] = useState(false);
  const mappingRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const { data: syncSettings = [], refetch: refetchSettings } = useSyncSettings(instance?.id ?? null);
  const { data: fieldMappings = [], refetch: refetchMappings } = useFieldMappings(instance?.id ?? null, selectedEntity ?? undefined);
  const { data: syncLogs = [], refetch: refetchLogs } = useSyncLogs(instance?.id ?? null);
  const { upsertSyncSetting, upsertFieldMapping, clearSyncLogs } = useSyncMutations();

  if (!instance) return null;

  const entities = PROVIDER_ENTITIES[instance.provider] || [];
  const isGetCourse = instance.provider === 'getcourse';
  
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

  const handleFilterChange = async (entityType: string, filters: Record<string, unknown>) => {
    const currentSetting = getSettingForEntity(entityType);
    const currentFilters = currentSetting?.filters || {};
    
    await upsertSyncSetting.mutateAsync({
      instance_id: instance.id,
      entity_type: entityType,
      filters: { ...currentFilters, ...filters },
    });
    refetchSettings();
  };

  const handleSaveMapping = async () => {
    if (!selectedEntity) return;
    
    setSavingMapping(true);
    try {
      const projectFields = PROJECT_FIELDS[selectedEntity] || [];
      
      for (const field of projectFields) {
        const inputEl = mappingRefs.current[field.key];
        const externalField = inputEl?.value?.trim() || '';
        
        if (externalField) {
          await upsertFieldMapping.mutateAsync({
            instance_id: instance.id,
            entity_type: selectedEntity,
            project_field: field.key,
            external_field: externalField,
            field_type: field.type,
            is_required: field.required || false,
            is_key_field: field.key === 'email',
          });
        }
      }
      
      toast.success("Маппинг сохранён");
      refetchMappings();
    } catch (error) {
      toast.error("Ошибка сохранения маппинга");
    } finally {
      setSavingMapping(false);
    }
  };

  const handleResetMapping = () => {
    const projectFields = PROJECT_FIELDS[selectedEntity || ''] || [];
    for (const field of projectFields) {
      const inputEl = mappingRefs.current[field.key];
      if (inputEl) {
        inputEl.value = '';
      }
    }
    toast.info("Маппинг сброшен");
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
      
      toast.success("Синхронизация завершена");
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

  const renderGetCourseFilters = (entityType: string) => {
    const setting = getSettingForEntity(entityType);
    const filters = (setting?.filters || {}) as Record<string, unknown>;

    return (
      <div className="mt-4 p-4 rounded-xl bg-muted/30 backdrop-blur-sm border border-border/50 space-y-4">
        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Filter className="h-4 w-4" />
          Фильтры синхронизации
        </div>
        
        {/* Period filter - for all entities */}
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Дата от</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="w-full justify-start text-left font-normal bg-background/50 backdrop-blur-sm">
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {filters.created_from ? format(new Date(filters.created_from as string), "dd.MM.yyyy") : "Выбрать"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0 pointer-events-auto" align="start">
                <Calendar
                  mode="single"
                  selected={filters.created_from ? new Date(filters.created_from as string) : undefined}
                  onSelect={(date) => handleFilterChange(entityType, { created_from: date?.toISOString() })}
                  locale={ru}
                  className="pointer-events-auto"
                />
              </PopoverContent>
            </Popover>
          </div>
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Дата до</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="w-full justify-start text-left font-normal bg-background/50 backdrop-blur-sm">
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {filters.created_to ? format(new Date(filters.created_to as string), "dd.MM.yyyy") : "Выбрать"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0 pointer-events-auto" align="start">
                <Calendar
                  mode="single"
                  selected={filters.created_to ? new Date(filters.created_to as string) : undefined}
                  onSelect={(date) => handleFilterChange(entityType, { created_to: date?.toISOString() })}
                  locale={ru}
                  className="pointer-events-auto"
                />
              </PopoverContent>
            </Popover>
          </div>
        </div>

        {/* Order status filter */}
        {entityType === 'orders' && (
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Статус заказа</Label>
            <Select
              value={(filters.status as string) || ''}
              onValueChange={(val) => handleFilterChange(entityType, { status: val || undefined })}
            >
              <SelectTrigger className="bg-background/50 backdrop-blur-sm">
                <SelectValue placeholder="Все статусы" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Все статусы</SelectItem>
                {ORDER_STATUSES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Payment type filter */}
        {entityType === 'payments' && (
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Тип платежа</Label>
            <Select
              value={(filters.payment_type as string) || ''}
              onValueChange={(val) => handleFilterChange(entityType, { payment_type: val || undefined })}
            >
              <SelectTrigger className="bg-background/50 backdrop-blur-sm">
                <SelectValue placeholder="Все типы" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Все типы</SelectItem>
                {PAYMENT_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Groups filter - could add group selector when groups are fetched */}
        {entityType === 'groups' && (
          <div className="text-xs text-muted-foreground">
            Все группы будут синхронизированы
          </div>
        )}
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] bg-background/95 backdrop-blur-xl border-border/50 shadow-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-xl bg-primary/10 flex items-center justify-center">
              <Settings2 className="h-4 w-4 text-primary" />
            </div>
            Настройки синхронизации
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {instance.alias} • Настройте сущности, маппинг полей и фильтры
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-3 bg-muted/50 backdrop-blur-sm p-1 rounded-xl">
            <TabsTrigger value="entities" className="rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-sm">
              Сущности
            </TabsTrigger>
            <TabsTrigger value="mapping" disabled={!selectedEntity} className="rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-sm">
              Маппинг полей
            </TabsTrigger>
            <TabsTrigger value="logs" className="rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-sm">
              Журнал
            </TabsTrigger>
          </TabsList>

          <TabsContent value="entities" className="mt-4">
            <ScrollArea className="h-[400px] pr-4">
              <div className="space-y-3">
                {entities.map((entity) => {
                  const Icon = ENTITY_ICONS[entity.id] || Users;
                  const setting = getSettingForEntity(entity.id);
                  const isEnabled = setting?.is_enabled ?? false;
                  const direction = setting?.direction ?? "import";
                  const conflictStrategy = setting?.conflict_strategy ?? "project_wins";

                  return (
                    <div
                      key={entity.id}
                      className={cn(
                        "rounded-2xl p-5 space-y-4 transition-all duration-300",
                        "bg-card/50 backdrop-blur-sm border shadow-sm",
                        isEnabled 
                          ? "border-primary/30 bg-primary/5 shadow-primary/5" 
                          : "border-border/50 hover:border-border"
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className={cn(
                            "h-10 w-10 rounded-xl flex items-center justify-center transition-colors",
                            isEnabled ? "bg-primary/10" : "bg-muted"
                          )}>
                            <Icon className={cn(
                              "h-5 w-5 transition-colors",
                              isEnabled ? "text-primary" : "text-muted-foreground"
                            )} />
                          </div>
                          <div>
                            <span className="font-medium">{entity.label}</span>
                            {isEnabled && (
                              <Badge variant="secondary" className="ml-2 text-xs bg-primary/10 text-primary border-0">
                                {DIRECTION_OPTIONS.find((d) => d.value === direction)?.label}
                              </Badge>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-muted-foreground hover:text-foreground"
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
                        <>
                          <div className="grid gap-4 md:grid-cols-2 pl-13">
                            <div className="space-y-3">
                              <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                                Направление
                              </Label>
                              <RadioGroup
                                value={direction}
                                onValueChange={(val) => handleDirectionChange(entity.id, val)}
                                className="flex flex-col gap-2"
                              >
                                {DIRECTION_OPTIONS.map((opt) => (
                                  <div key={opt.value} className="flex items-center gap-2">
                                    <RadioGroupItem 
                                      value={opt.value} 
                                      id={`${entity.id}-${opt.value}`}
                                      className="border-muted-foreground/30"
                                    />
                                    <Label
                                      htmlFor={`${entity.id}-${opt.value}`}
                                      className="flex items-center gap-2 cursor-pointer text-sm"
                                    >
                                      <opt.icon className="h-4 w-4 text-muted-foreground" />
                                      <span>{opt.label}</span>
                                    </Label>
                                  </div>
                                ))}
                              </RadioGroup>
                            </div>

                            <div className="space-y-3">
                              <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                                Стратегия конфликтов
                              </Label>
                              <Select
                                value={conflictStrategy}
                                onValueChange={(val) => handleConflictStrategyChange(entity.id, val)}
                              >
                                <SelectTrigger className="bg-background/50 backdrop-blur-sm">
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

                          {/* GetCourse filters */}
                          {isGetCourse && renderGetCourseFilters(entity.id)}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </ScrollArea>

            <div className="flex justify-between mt-4 pt-4 border-t border-border/50">
              <Button 
                variant="outline" 
                onClick={handleSyncNow} 
                disabled={syncing}
                className="bg-background/50 backdrop-blur-sm hover:bg-primary/10 hover:text-primary hover:border-primary/30"
              >
                <RefreshCw className={cn("h-4 w-4 mr-2", syncing && "animate-spin")} />
                {syncing ? "Синхронизация..." : "Синхронизировать сейчас"}
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="mapping" className="mt-4">
            {selectedEntity && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-8 w-8 rounded-xl bg-primary/10 flex items-center justify-center">
                      {(() => {
                        const Icon = ENTITY_ICONS[selectedEntity] || Users;
                        return <Icon className="h-4 w-4 text-primary" />;
                      })()}
                    </div>
                    <h4 className="font-medium">
                      Маппинг полей: {entities.find((e) => e.id === selectedEntity)?.label}
                    </h4>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setSelectedEntity(null);
                      setActiveTab("entities");
                    }}
                  >
                    ← Назад
                  </Button>
                </div>

                <ScrollArea className="h-[320px]">
                  <div className="rounded-xl border border-border/50 bg-card/30 backdrop-blur-sm overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/30 hover:bg-muted/30">
                          <TableHead className="font-medium">Поле проекта</TableHead>
                          <TableHead className="font-medium">Тип</TableHead>
                          <TableHead className="font-medium">Поле внешней системы</TableHead>
                          <TableHead className="w-[80px] font-medium">Ключ</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(PROJECT_FIELDS[selectedEntity] || []).map((field) => {
                          const mapping = fieldMappings.find((m) => m.project_field === field.key);
                          return (
                            <TableRow key={field.key} className="hover:bg-muted/20">
                              <TableCell className="font-medium">
                                {field.label}
                                {field.required && <span className="text-destructive ml-1">*</span>}
                              </TableCell>
                              <TableCell>
                                <Badge variant="outline" className="text-xs bg-background/50">
                                  {field.type}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                <Input
                                  ref={(el) => { mappingRefs.current[field.key] = el; }}
                                  type="text"
                                  className="h-8 text-sm bg-background/50 backdrop-blur-sm border-border/50"
                                  placeholder="Название поля в системе"
                                  defaultValue={mapping?.external_field || ""}
                                />
                              </TableCell>
                              <TableCell>
                                {field.key === "email" && (
                                  <Badge className="bg-amber-500/10 text-amber-600 border-amber-500/20 border">
                                    Ключ
                                  </Badge>
                                )}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                </ScrollArea>

                <div className="flex justify-end gap-2 pt-4 border-t border-border/50">
                  <Button 
                    variant="outline" 
                    onClick={handleResetMapping}
                    className="bg-background/50 backdrop-blur-sm"
                  >
                    Сбросить
                  </Button>
                  <Button 
                    onClick={handleSaveMapping}
                    disabled={savingMapping}
                    className="bg-primary hover:bg-primary/90"
                  >
                    <Save className="h-4 w-4 mr-2" />
                    {savingMapping ? "Сохранение..." : "Сохранить маппинг"}
                  </Button>
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="logs" className="mt-4">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="font-medium">Журнал синхронизации</h4>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={handleClearLogs}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Очистить
                </Button>
              </div>

              <ScrollArea className="h-[350px]">
                {syncLogs.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <RefreshCw className="h-12 w-12 mx-auto mb-3 opacity-20" />
                    <p>Нет записей в журнале</p>
                    <p className="text-sm mt-1">Запустите синхронизацию для создания записей</p>
                  </div>
                ) : (
                  <div className="rounded-xl border border-border/50 bg-card/30 backdrop-blur-sm overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/30 hover:bg-muted/30">
                          <TableHead className="font-medium">Дата</TableHead>
                          <TableHead className="font-medium">Сущность</TableHead>
                          <TableHead className="font-medium">Направление</TableHead>
                          <TableHead className="font-medium">Результат</TableHead>
                          <TableHead className="font-medium">Детали</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {syncLogs.map((log) => (
                          <TableRow key={log.id} className="hover:bg-muted/20">
                            <TableCell className="text-sm text-muted-foreground">
                              {format(new Date(log.created_at), "dd.MM.yy HH:mm", { locale: ru })}
                            </TableCell>
                            <TableCell className="capitalize">{log.entity_type}</TableCell>
                            <TableCell>
                              <div className={cn(
                                "h-6 w-6 rounded-lg flex items-center justify-center",
                                log.direction === "import" ? "bg-blue-500/10" : "bg-green-500/10"
                              )}>
                                {log.direction === "import" ? (
                                  <ArrowDownToLine className="h-3 w-3 text-blue-500" />
                                ) : (
                                  <ArrowUpFromLine className="h-3 w-3 text-green-500" />
                                )}
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant={log.result === "success" ? "default" : "destructive"}
                                className={cn(
                                  "border",
                                  log.result === "success" 
                                    ? "bg-green-500/10 text-green-600 border-green-500/20" 
                                    : log.result === "skipped"
                                    ? "bg-amber-500/10 text-amber-600 border-amber-500/20"
                                    : ""
                                )}
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
                  </div>
                )}
              </ScrollArea>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
