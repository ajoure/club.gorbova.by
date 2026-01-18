import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ArrowLeftRight,
  Copy,
  Database,
  Link2,
  Loader2,
  RefreshCw,
  Save,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { IntegrationInstance } from "@/hooks/useIntegrations";
import { useFields, ENTITY_TYPE_LABELS, type FieldEntityType } from "@/hooks/useFields";
import { cn } from "@/lib/utils";

interface ExternalField {
  id: string | number;
  name: string;
  type?: string;
  code?: string;
  entity_type?: string;
}

interface FieldMappingDialogProps {
  instance: IntegrationInstance | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Map our entity types to CRM entity types
const ENTITY_MAPPING: Record<string, Record<string, string>> = {
  amocrm: {
    client: "contacts",
    order: "deals",
    company: "companies",
  },
  getcourse: {
    client: "users",
    order: "orders",
    payment: "payments",
  },
};

export function FieldMappingDialog({ instance, open, onOpenChange }: FieldMappingDialogProps) {
  const [activeEntity, setActiveEntity] = useState<FieldEntityType>("client");
  const [externalFields, setExternalFields] = useState<ExternalField[]>([]);
  const [loadingExternal, setLoadingExternal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [mappings, setMappings] = useState<Record<string, string>>({});

  const { data: fields = [], isLoading: fieldsLoading } = useFields(activeEntity);

  // Load external fields from CRM
  const loadExternalFields = async () => {
    if (!instance) return;
    
    setLoadingExternal(true);
    try {
      if (instance.provider === "amocrm") {
        const { data, error } = await supabase.functions.invoke("amocrm-sync", {
          body: {
            action: "get-fields",
            instance_id: instance.id,
            config: instance.config,
          },
        });
        
        if (error) throw error;
        
        // Parse amoCRM fields response
        const entityType = ENTITY_MAPPING.amocrm[activeEntity] || "contacts";
        const crmFields = data?.data?.[entityType] || data?.data?.contacts || [];
        
        const parsed: ExternalField[] = crmFields.map((f: any) => ({
          id: f.id,
          name: f.name,
          type: f.type,
          code: f.code,
          entity_type: entityType,
        }));
        
        setExternalFields(parsed);
      } else if (instance.provider === "getcourse") {
        // GetCourse doesn't have dynamic field API, use predefined
        const gcFields: ExternalField[] = [
          { id: "email", name: "Email", type: "email" },
          { id: "phone", name: "Телефон", type: "phone" },
          { id: "first_name", name: "Имя", type: "string" },
          { id: "last_name", name: "Фамилия", type: "string" },
          { id: "created_at", name: "Дата регистрации", type: "datetime" },
          { id: "group_name", name: "Группа", type: "string" },
        ];
        setExternalFields(gcFields);
      }
    } catch (err) {
      console.error("Error loading external fields:", err);
      toast.error("Ошибка загрузки полей CRM");
    } finally {
      setLoadingExternal(false);
    }
  };

  // Load existing mappings
  const loadMappings = async () => {
    if (!instance) return;
    
    try {
      const { data, error } = await supabase
        .from("integration_field_mappings")
        .select("*")
        .eq("instance_id", instance.id)
        .eq("entity_type", activeEntity);
      
      if (error) throw error;
      
      const newMappings: Record<string, string> = {};
      data?.forEach((m) => {
        newMappings[m.project_field] = m.external_field;
      });
      setMappings(newMappings);
    } catch (err) {
      console.error("Error loading mappings:", err);
    }
  };

  useEffect(() => {
    if (open && instance) {
      loadExternalFields();
      loadMappings();
    }
  }, [open, instance, activeEntity]);

  const handleMappingChange = (fieldId: string, externalField: string) => {
    setMappings((prev) => ({
      ...prev,
      [fieldId]: externalField,
    }));
  };

  const handleSave = async () => {
    if (!instance) return;
    
    setSaving(true);
    try {
      // Save each mapping
      for (const [fieldId, externalField] of Object.entries(mappings)) {
        if (!externalField) continue;
        
        const field = fields.find((f) => f.id === fieldId);
        if (!field) continue;

        await supabase
          .from("integration_field_mappings")
          .upsert({
            instance_id: instance.id,
            entity_type: activeEntity,
            project_field: fieldId,
            external_field: externalField,
            field_type: field.data_type,
            is_required: field.is_required,
            is_key_field: field.key === "email",
          }, {
            onConflict: "instance_id,entity_type,project_field",
          });
      }

      // Also update field external_id based on provider
      for (const [fieldId, externalField] of Object.entries(mappings)) {
        if (!externalField) continue;
        
        const updateField: Record<string, string | null> = {};
        if (instance.provider === "amocrm") {
          updateField.external_id_amo = externalField;
        } else if (instance.provider === "getcourse") {
          updateField.external_id_gc = externalField;
        }
        
        if (Object.keys(updateField).length > 0) {
          await supabase
            .from("fields")
            .update(updateField)
            .eq("id", fieldId);
        }
      }

      toast.success("Маппинг сохранён");
      onOpenChange(false);
    } catch (err) {
      console.error("Error saving mappings:", err);
      toast.error("Ошибка сохранения");
    } finally {
      setSaving(false);
    }
  };

  const copyFieldId = (fieldId: string) => {
    navigator.clipboard.writeText(`{{fieldId:${fieldId}}}`);
    toast.success("ID поля скопирован");
  };

  const filteredFields = fields.filter((f) =>
    f.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
    f.key.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredExternalFields = externalFields.filter((f) =>
    f.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    String(f.id).includes(searchQuery)
  );

  if (!instance) return null;

  const providerName = instance.provider === "amocrm" ? "amoCRM" : 
                       instance.provider === "getcourse" ? "GetCourse" : 
                       instance.provider;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <ArrowLeftRight className="h-5 w-5 text-primary" />
            </div>
            <div>
              <span>Маппинг полей по ID</span>
              <p className="text-sm font-normal text-muted-foreground">
                {instance.alias} → {providerName}
              </p>
            </div>
          </DialogTitle>
          <DialogDescription>
            Сопоставьте поля проекта (Field Registry) с полями {providerName}. 
            Все данные связываются по UUID, а не по названию.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeEntity} onValueChange={(v) => setActiveEntity(v as FieldEntityType)}>
          <TabsList className="grid grid-cols-4">
            <TabsTrigger value="client">Клиент</TabsTrigger>
            <TabsTrigger value="order">Заказ</TabsTrigger>
            <TabsTrigger value="payment">Платёж</TabsTrigger>
            <TabsTrigger value="subscription">Подписка</TabsTrigger>
          </TabsList>

          <div className="mt-4 space-y-4">
            {/* Search and refresh */}
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Поиск полей..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                />
              </div>
              <Button
                variant="outline"
                size="icon"
                onClick={loadExternalFields}
                disabled={loadingExternal}
              >
                <RefreshCw className={cn("h-4 w-4", loadingExternal && "animate-spin")} />
              </Button>
            </div>

            {/* Mapping table */}
            <ScrollArea className="h-[400px]">
              {fieldsLoading ? (
                <div className="flex items-center justify-center h-32">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[200px]">
                        <div className="flex items-center gap-2">
                          <Database className="h-4 w-4" />
                          Поле проекта
                        </div>
                      </TableHead>
                      <TableHead className="w-[100px]">ID</TableHead>
                      <TableHead className="w-[100px]">Тип</TableHead>
                      <TableHead>
                        <div className="flex items-center gap-2">
                          <Link2 className="h-4 w-4" />
                          Поле {providerName}
                        </div>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredFields.map((field) => (
                      <TableRow key={field.id}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{field.label}</span>
                            {field.is_required && (
                              <span className="text-destructive">*</span>
                            )}
                            {field.is_system && (
                              <Badge variant="outline" className="text-xs">
                                Системное
                              </Badge>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {field.key}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs font-mono"
                            onClick={() => copyFieldId(field.id)}
                          >
                            <Copy className="h-3 w-3 mr-1" />
                            {field.id.slice(0, 8)}...
                          </Button>
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary" className="text-xs">
                            {field.data_type}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {loadingExternal ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Select
                              value={mappings[field.id] || "__none__"}
                              onValueChange={(v) => handleMappingChange(field.id, v === "__none__" ? "" : v)}
                            >
                              <SelectTrigger className="h-8">
                                <SelectValue placeholder="Выберите поле..." />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__none__">— Не сопоставлено —</SelectItem>
                                {filteredExternalFields.map((ef) => (
                                  <SelectItem key={ef.id} value={String(ef.id)}>
                                    <div className="flex items-center gap-2">
                                      <span>{ef.name}</span>
                                      <span className="text-xs text-muted-foreground">
                                        ({ef.id})
                                      </span>
                                    </div>
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </ScrollArea>
          </div>
        </Tabs>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Save className="h-4 w-4 mr-2" />
            )}
            Сохранить маппинг
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
