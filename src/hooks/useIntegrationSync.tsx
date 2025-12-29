import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { Json } from "@/integrations/supabase/types";

export interface SyncSetting {
  id: string;
  instance_id: string;
  entity_type: string;
  direction: "import" | "export" | "bidirectional";
  is_enabled: boolean;
  filters: Record<string, unknown>;
  conflict_strategy: "project_wins" | "external_wins" | "by_updated_at";
  last_sync_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface FieldMapping {
  id: string;
  instance_id: string;
  entity_type: string;
  project_field: string;
  external_field: string;
  field_type: string;
  is_required: boolean;
  is_key_field: boolean;
  transform_rules: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface SyncLog {
  id: string;
  instance_id: string;
  entity_type: string;
  direction: string;
  object_id: string | null;
  object_type: string | null;
  result: "success" | "error" | "skipped";
  error_message: string | null;
  payload_meta: Record<string, unknown>;
  created_at: string;
}

// Entity configurations for each provider
export const PROVIDER_ENTITIES: Record<string, { id: string; label: string; icon: string }[]> = {
  getcourse: [
    { id: "users", label: "Пользователи", icon: "Users" },
    { id: "orders", label: "Заказы", icon: "ShoppingCart" },
    { id: "payments", label: "Платежи", icon: "CreditCard" },
    { id: "groups", label: "Группы", icon: "FolderOpen" },
  ],
  amocrm: [
    { id: "contacts", label: "Контакты", icon: "Users" },
    { id: "companies", label: "Компании", icon: "Building2" },
    { id: "deals", label: "Сделки", icon: "Handshake" },
  ],
};

// Project fields for mapping
export const PROJECT_FIELDS: Record<string, { key: string; label: string; type: string; required?: boolean }[]> = {
  users: [
    { key: "email", label: "Email", type: "email", required: true },
    { key: "full_name", label: "Полное имя", type: "text" },
    { key: "phone", label: "Телефон", type: "text" },
    { key: "created_at", label: "Дата регистрации", type: "date" },
  ],
  orders: [
    { key: "amount", label: "Сумма", type: "number", required: true },
    { key: "currency", label: "Валюта", type: "text" },
    { key: "status", label: "Статус", type: "select" },
    { key: "product_id", label: "ID продукта", type: "text" },
    { key: "created_at", label: "Дата заказа", type: "date" },
  ],
  payments: [
    { key: "amount", label: "Сумма", type: "number", required: true },
    { key: "status", label: "Статус", type: "select" },
    { key: "payment_method", label: "Способ оплаты", type: "text" },
    { key: "created_at", label: "Дата платежа", type: "date" },
  ],
  contacts: [
    { key: "email", label: "Email", type: "email", required: true },
    { key: "full_name", label: "Полное имя", type: "text" },
    { key: "phone", label: "Телефон", type: "text" },
  ],
  deals: [
    { key: "name", label: "Название", type: "text", required: true },
    { key: "amount", label: "Сумма", type: "number" },
    { key: "status", label: "Статус", type: "select" },
  ],
  groups: [
    { key: "name", label: "Название", type: "text", required: true },
  ],
  companies: [
    { key: "name", label: "Название", type: "text", required: true },
  ],
};

export function useSyncSettings(instanceId: string | null) {
  return useQuery({
    queryKey: ["sync-settings", instanceId],
    queryFn: async () => {
      if (!instanceId) return [];
      const { data, error } = await supabase
        .from("integration_sync_settings")
        .select("*")
        .eq("instance_id", instanceId);
      if (error) throw error;
      return data as SyncSetting[];
    },
    enabled: !!instanceId,
  });
}

export function useFieldMappings(instanceId: string | null, entityType?: string) {
  return useQuery({
    queryKey: ["field-mappings", instanceId, entityType],
    queryFn: async () => {
      if (!instanceId) return [];
      let query = supabase
        .from("integration_field_mappings")
        .select("*")
        .eq("instance_id", instanceId);
      
      if (entityType) {
        query = query.eq("entity_type", entityType);
      }
      
      const { data, error } = await query;
      if (error) throw error;
      return data as FieldMapping[];
    },
    enabled: !!instanceId,
  });
}

export function useSyncLogs(instanceId: string | null, limit = 50) {
  return useQuery({
    queryKey: ["sync-logs", instanceId],
    queryFn: async () => {
      if (!instanceId) return [];
      const { data, error } = await supabase
        .from("integration_sync_logs")
        .select("*")
        .eq("instance_id", instanceId)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return data as SyncLog[];
    },
    enabled: !!instanceId,
  });
}

export function useSyncMutations() {
  const queryClient = useQueryClient();

  const upsertSyncSetting = useMutation({
    mutationFn: async (data: {
      instance_id: string;
      entity_type: string;
      direction?: string;
      is_enabled?: boolean;
      filters?: Record<string, unknown>;
      conflict_strategy?: string;
    }) => {
      const { data: result, error } = await supabase
        .from("integration_sync_settings")
        .upsert({
          instance_id: data.instance_id,
          entity_type: data.entity_type,
          direction: data.direction || "import",
          is_enabled: data.is_enabled ?? false,
          filters: (data.filters || {}) as Json,
          conflict_strategy: data.conflict_strategy || "project_wins",
        }, {
          onConflict: "instance_id,entity_type",
        })
        .select()
        .single();
      if (error) throw error;
      return result;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["sync-settings", variables.instance_id] });
    },
    onError: (error) => {
      toast.error("Ошибка сохранения настроек: " + error.message);
    },
  });

  const upsertFieldMapping = useMutation({
    mutationFn: async (data: {
      instance_id: string;
      entity_type: string;
      project_field: string;
      external_field: string;
      field_type?: string;
      is_required?: boolean;
      is_key_field?: boolean;
    }) => {
      const { data: result, error } = await supabase
        .from("integration_field_mappings")
        .upsert({
          instance_id: data.instance_id,
          entity_type: data.entity_type,
          project_field: data.project_field,
          external_field: data.external_field,
          field_type: data.field_type || "text",
          is_required: data.is_required || false,
          is_key_field: data.is_key_field || false,
        }, {
          onConflict: "instance_id,entity_type,project_field",
        })
        .select()
        .single();
      if (error) throw error;
      return result;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["field-mappings", variables.instance_id] });
    },
  });

  const deleteFieldMapping = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("integration_field_mappings")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["field-mappings"] });
    },
  });

  const clearSyncLogs = useMutation({
    mutationFn: async (instanceId: string) => {
      const { error } = await supabase
        .from("integration_sync_logs")
        .delete()
        .eq("instance_id", instanceId);
      if (error) throw error;
    },
    onSuccess: (_, instanceId) => {
      queryClient.invalidateQueries({ queryKey: ["sync-logs", instanceId] });
      toast.success("Логи очищены");
    },
  });

  return { upsertSyncSetting, upsertFieldMapping, deleteFieldMapping, clearSyncLogs };
}
