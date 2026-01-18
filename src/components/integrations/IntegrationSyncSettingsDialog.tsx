import { useState, useRef, useEffect } from "react";
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
import { Checkbox } from "@/components/ui/checkbox";
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
  Loader2,
  Activity,
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
import { AmoCRMFieldMappingInfo } from "./AmoCRMFieldMappingInfo";
import { WebhookMonitoringPanel } from "./WebhookMonitoringPanel";

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

interface GetCourseGroup {
  id: number;
  name: string;
}

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
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [availableGroups, setAvailableGroups] = useState<GetCourseGroup[]>([]);
  const mappingRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const { data: syncSettings = [], refetch: refetchSettings } = useSyncSettings(instance?.id ?? null);
  const { data: fieldMappings = [], refetch: refetchMappings } = useFieldMappings(instance?.id ?? null, selectedEntity ?? undefined);
  const { data: syncLogs = [], refetch: refetchLogs } = useSyncLogs(instance?.id ?? null);
  const { upsertSyncSetting, upsertFieldMapping, clearSyncLogs } = useSyncMutations();

  // Fetch GetCourse groups when dialog opens
  useEffect(() => {
    if (open && instance?.provider === 'getcourse') {
      fetchGetCourseGroups();
    }
  }, [open, instance]);

  const fetchGetCourseGroups = async () => {
    if (!instance) return;
    
    setLoadingGroups(true);
    try {
      const config = instance.config as Record<string, unknown>;
      const accountName = config?.account_name as string;
      const secretKey = config?.secret_key as string;
      
      if (!accountName || !secretKey) return;

      // Call healthcheck to get groups
      const { data, error } = await supabase.functions.invoke('integration-healthcheck', {
        body: {
          instance_id: instance.id,
          provider: 'getcourse',
          config: instance.config,
        },
      });

      if (!error && data?.success && data?.data?.groups) {
        setAvailableGroups(data.data.groups);
      }
    } catch (err) {
      console.error('Error fetching groups:', err);
    } finally {
      setLoadingGroups(false);
    }
  };

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

  const handleGroupToggle = async (entityType: string, groupId: number, checked: boolean) => {
    const currentSetting = getSettingForEntity(entityType);
    const currentFilters = (currentSetting?.filters || {}) as Record<string, unknown>;
    const currentGroups = (currentFilters.group_ids || []) as number[];
    
    let newGroups: number[];
    if (checked) {
      newGroups = [...currentGroups, groupId];
    } else {
      newGroups = currentGroups.filter(id => id !== groupId);
    }
    
    await handleFilterChange(entityType, { group_ids: newGroups });
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
    const selectedGroupIds = (filters.group_ids || []) as number[];

    return (
      <div className="mt-4 p-4 rounded-2xl bg-gradient-to-br from-primary/5 to-accent/5 border border-primary/10 space-y-4">
        <div className="flex items-center gap-2 text-sm font-medium text-primary">
          <Filter className="h-4 w-4" />
          Фильтры синхронизации
        </div>
        
        {/* Period filter - for all entities */}
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Дата от</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="w-full justify-start text-left font-normal bg-background/80 backdrop-blur-sm border-border/50 hover:bg-background hover:border-primary/30"
                >
                  <CalendarIcon className="mr-2 h-4 w-4 text-primary/60" />
                  {filters.created_from ? format(new Date(filters.created_from as string), "dd.MM.yyyy") : "Выбрать"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0 pointer-events-auto bg-background/95 backdrop-blur-xl border-border/50" align="start">
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
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="w-full justify-start text-left font-normal bg-background/80 backdrop-blur-sm border-border/50 hover:bg-background hover:border-primary/30"
                >
                  <CalendarIcon className="mr-2 h-4 w-4 text-primary/60" />
                  {filters.created_to ? format(new Date(filters.created_to as string), "dd.MM.yyyy") : "Выбрать"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0 pointer-events-auto bg-background/95 backdrop-blur-xl border-border/50" align="start">
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

        {/* Groups filter for users */}
        {entityType === 'users' && (
          <div className="space-y-3">
            <Label className="text-xs text-muted-foreground">Группы GetCourse</Label>
            {loadingGroups ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Загрузка групп...
              </div>
            ) : availableGroups.length > 0 ? (
              <div className="grid grid-cols-2 gap-2 max-h-[150px] overflow-y-auto p-2 rounded-xl bg-background/50 border border-border/30">
                {availableGroups.map((group) => (
                  <label
                    key={group.id}
                    className="flex items-center gap-2 p-2 rounded-lg hover:bg-primary/5 cursor-pointer transition-colors"
                  >
                    <Checkbox
                      checked={selectedGroupIds.includes(group.id)}
                      onCheckedChange={(checked) => handleGroupToggle(entityType, group.id, !!checked)}
                    />
                    <span className="text-sm truncate">{group.name}</span>
                  </label>
                ))}
              </div>
            ) : (
              <div className="text-xs text-muted-foreground py-2">
                Нет доступных групп или не удалось загрузить
              </div>
            )}
            {selectedGroupIds.length > 0 && (
              <div className="text-xs text-primary">
                Выбрано групп: {selectedGroupIds.length}
              </div>
            )}
          </div>
        )}

        {/* Order status filter */}
        {entityType === 'orders' && (
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Статус заказа</Label>
            <Select
              value={(filters.status as string) || '__all__'}
              onValueChange={(val) => handleFilterChange(entityType, { status: val === '__all__' ? undefined : val })}
            >
              <SelectTrigger className="bg-background/80 backdrop-blur-sm border-border/50">
                <SelectValue placeholder="Все статусы" />
              </SelectTrigger>
              <SelectContent className="bg-background/95 backdrop-blur-xl border-border/50">
                <SelectItem value="__all__">Все статусы</SelectItem>
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
              value={(filters.payment_type as string) || '__all__'}
              onValueChange={(val) => handleFilterChange(entityType, { payment_type: val === '__all__' ? undefined : val })}
            >
              <SelectTrigger className="bg-background/80 backdrop-blur-sm border-border/50">
                <SelectValue placeholder="Все типы" />
              </SelectTrigger>
              <SelectContent className="bg-background/95 backdrop-blur-xl border-border/50">
                <SelectItem value="__all__">Все типы</SelectItem>
                {PAYMENT_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Groups filter - info text */}
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
      <DialogContent className="max-w-3xl max-h-[85vh] bg-gradient-to-br from-background via-background to-primary/5 backdrop-blur-xl border-primary/20 shadow-2xl shadow-primary/10">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center shadow-lg shadow-primary/20">
              <Settings2 className="h-5 w-5 text-primary" />
            </div>
            <div>
              <span className="text-lg">Настройки синхронизации</span>
              <p className="text-sm font-normal text-muted-foreground">{instance.alias}</p>
            </div>
          </DialogTitle>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-4 bg-muted/50 p-1 rounded-xl">
            <TabsTrigger value="entities" className="rounded-lg text-xs">
              Сущности
            </TabsTrigger>
            <TabsTrigger value="mapping" disabled={!selectedEntity} className="rounded-lg text-xs">
              Маппинг
            </TabsTrigger>
            <TabsTrigger value="webhooks" className="rounded-lg text-xs">
              <Activity className="h-3 w-3 mr-1" />
              Вебхуки
            </TabsTrigger>
            <TabsTrigger value="logs" className="rounded-lg text-xs">
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
                        "border shadow-lg",
                        isEnabled 
                          ? "bg-gradient-to-br from-primary/10 via-background to-accent/5 border-primary/30 shadow-primary/10" 
                          : "bg-gradient-to-br from-card/80 to-card/50 border-border/50 hover:border-border shadow-sm"
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className={cn(
                            "h-12 w-12 rounded-2xl flex items-center justify-center transition-all shadow-lg",
                            isEnabled 
                              ? "bg-gradient-to-br from-primary/20 to-primary/10 shadow-primary/20" 
                              : "bg-gradient-to-br from-muted to-muted/50 shadow-sm"
                          )}>
                            <Icon className={cn(
                              "h-6 w-6 transition-colors",
                              isEnabled ? "text-primary" : "text-muted-foreground"
                            )} />
                          </div>
                          <div>
                            <span className="font-semibold">{entity.label}</span>
                            {isEnabled && (
                              <span className="ml-2 px-2 py-0.5 text-xs rounded-full bg-primary/10 text-primary border border-primary/20">
                                {DIRECTION_OPTIONS.find((d) => d.value === direction)?.label}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-muted-foreground hover:text-primary hover:bg-primary/10"
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
                          <div className="grid gap-4 md:grid-cols-2 pl-15">
                            <div className="space-y-3">
                              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                                Направление
                              </Label>
                              <RadioGroup
                                value={direction}
                                onValueChange={(val) => handleDirectionChange(entity.id, val)}
                                className="flex flex-col gap-2"
                              >
                                {DIRECTION_OPTIONS.map((opt) => (
                                  <div key={opt.value} className="flex items-center gap-2 p-2 rounded-xl hover:bg-primary/5 transition-colors">
                                    <RadioGroupItem 
                                      value={opt.value} 
                                      id={`${entity.id}-${opt.value}`}
                                      className="border-primary/30"
                                    />
                                    <Label
                                      htmlFor={`${entity.id}-${opt.value}`}
                                      className="flex items-center gap-2 cursor-pointer text-sm"
                                    >
                                      <opt.icon className="h-4 w-4 text-primary/60" />
                                      <span>{opt.label}</span>
                                    </Label>
                                  </div>
                                ))}
                              </RadioGroup>
                            </div>

                            <div className="space-y-3">
                              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                                Стратегия конфликтов
                              </Label>
                              <Select
                                value={conflictStrategy}
                                onValueChange={(val) => handleConflictStrategyChange(entity.id, val)}
                              >
                                <SelectTrigger className="bg-background/80 backdrop-blur-sm border-border/50 hover:border-primary/30">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="bg-background/95 backdrop-blur-xl border-border/50">
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

            <div className="flex justify-between mt-4 pt-4 border-t border-border/30">
              <Button 
                variant="outline" 
                onClick={handleSyncNow} 
                disabled={syncing}
                className="bg-gradient-to-r from-primary/10 to-accent/10 border-primary/20 hover:border-primary/40 hover:from-primary/20 hover:to-accent/20 text-primary shadow-lg shadow-primary/10"
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
                    <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
                      {(() => {
                        const Icon = ENTITY_ICONS[selectedEntity] || Users;
                        return <Icon className="h-5 w-5 text-primary" />;
                      })()}
                    </div>
                    <h4 className="font-semibold">
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

                {/* amoCRM field hints */}
                {instance.provider === 'amocrm' && (
                  <AmoCRMFieldMappingInfo entityType={selectedEntity} />
                )}

                <ScrollArea className="h-[280px]">
                  <div className="rounded-xl border bg-card overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/50">
                          <TableHead className="font-medium">Поле проекта</TableHead>
                          <TableHead className="font-medium">Тип</TableHead>
                          <TableHead className="font-medium">Поле {instance.provider === 'amocrm' ? 'amoCRM' : 'внешней системы'}</TableHead>
                          <TableHead className="w-[60px]">Ключ</TableHead>
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
                                <Badge variant="secondary" className="text-xs">
                                  {field.type}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                <Input
                                  ref={(el) => { mappingRefs.current[field.key] = el; }}
                                  type="text"
                                  className="h-8 text-sm"
                                  placeholder={instance.provider === 'amocrm' ? 'name, cf_XXXXXX...' : 'Название поля'}
                                  defaultValue={mapping?.external_field || ""}
                                />
                              </TableCell>
                              <TableCell>
                                {field.key === "email" && (
                                  <Badge variant="outline" className="text-xs bg-amber-50 text-amber-700 border-amber-200">
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

                <div className="flex justify-end gap-2 pt-4 border-t">
                  <Button variant="outline" onClick={handleResetMapping}>
                    Сбросить
                  </Button>
                  <Button onClick={handleSaveMapping} disabled={savingMapping}>
                    <Save className="h-4 w-4 mr-2" />
                    {savingMapping ? "Сохранение..." : "Сохранить маппинг"}
                  </Button>
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="webhooks" className="mt-4">
            <WebhookMonitoringPanel instanceId={instance.id} />
          </TabsContent>

          <TabsContent value="logs" className="mt-4">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="font-semibold">Журнал синхронизации</h4>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={handleClearLogs}
                  className="text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Очистить
                </Button>
              </div>

              <ScrollArea className="h-[350px]">
                {syncLogs.length === 0 ? (
                  <div className="text-center py-16">
                    <div className="h-16 w-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-muted to-muted/50 flex items-center justify-center">
                      <RefreshCw className="h-8 w-8 text-muted-foreground/30" />
                    </div>
                    <p className="text-muted-foreground font-medium">Нет записей в журнале</p>
                    <p className="text-sm text-muted-foreground/60 mt-1">Запустите синхронизацию для создания записей</p>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-primary/20 bg-gradient-to-br from-card/80 to-card/50 overflow-hidden shadow-lg">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-gradient-to-r from-muted/50 to-muted/30 hover:from-muted/50 border-b border-primary/10">
                          <TableHead className="font-semibold">Дата</TableHead>
                          <TableHead className="font-semibold">Сущность</TableHead>
                          <TableHead className="font-semibold">Направление</TableHead>
                          <TableHead className="font-semibold">Результат</TableHead>
                          <TableHead className="font-semibold">Детали</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {syncLogs.map((log) => (
                          <TableRow key={log.id} className="hover:bg-primary/5 border-b border-border/30">
                            <TableCell className="text-sm text-muted-foreground">
                              {format(new Date(log.created_at), "dd.MM.yy HH:mm", { locale: ru })}
                            </TableCell>
                            <TableCell className="capitalize">{log.entity_type}</TableCell>
                            <TableCell>
                              <div className={cn(
                                "h-7 w-7 rounded-xl flex items-center justify-center",
                                log.direction === "import" 
                                  ? "bg-gradient-to-br from-blue-500/20 to-blue-500/10" 
                                  : "bg-gradient-to-br from-green-500/20 to-green-500/10"
                              )}>
                                {log.direction === "import" ? (
                                  <ArrowDownToLine className="h-4 w-4 text-blue-500" />
                                ) : (
                                  <ArrowUpFromLine className="h-4 w-4 text-green-500" />
                                )}
                              </div>
                            </TableCell>
                            <TableCell>
                              <span
                                className={cn(
                                  "px-2 py-0.5 text-xs rounded-full border",
                                  log.result === "success" 
                                    ? "bg-green-500/10 text-green-600 border-green-500/20" 
                                    : log.result === "skipped"
                                    ? "bg-amber-500/10 text-amber-600 border-amber-500/20"
                                    : "bg-destructive/10 text-destructive border-destructive/20"
                                )}
                              >
                                {log.result === "success" ? "OK" : log.result === "skipped" ? "Пропущено" : "Ошибка"}
                              </span>
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
