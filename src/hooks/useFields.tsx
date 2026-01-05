import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export type FieldEntityType = 
  | 'client' 
  | 'order' 
  | 'subscription' 
  | 'product' 
  | 'tariff' 
  | 'payment' 
  | 'company'
  | 'telegram_member'
  | 'custom';

export type FieldDataType = 
  | 'string'
  | 'number' 
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'money'
  | 'enum'
  | 'json'
  | 'email'
  | 'phone';

export interface Field {
  id: string;
  entity_type: FieldEntityType;
  key: string;
  label: string;
  data_type: FieldDataType;
  is_system: boolean;
  is_required: boolean;
  default_value: string | null;
  enum_options: any;
  validation_rules: any;
  external_id_amo: string | null;
  external_id_gc: string | null;
  external_id_b24: string | null;
  description: string | null;
  display_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface FieldValue {
  id: string;
  field_id: string;
  entity_type: FieldEntityType;
  entity_id: string;
  value_text: string | null;
  value_number: number | null;
  value_boolean: boolean | null;
  value_date: string | null;
  value_datetime: string | null;
  value_json: any;
  created_at: string;
  updated_at: string;
}

// Fetch all fields
export function useFields(entityType?: FieldEntityType) {
  return useQuery({
    queryKey: ['fields', entityType],
    queryFn: async () => {
      let query = supabase
        .from('fields')
        .select('*')
        .order('entity_type')
        .order('display_order');
      
      if (entityType) {
        query = query.eq('entity_type', entityType);
      }
      
      const { data, error } = await query;
      if (error) throw error;
      return data as Field[];
    },
  });
}

// Fetch field by ID
export function useField(fieldId: string | null) {
  return useQuery({
    queryKey: ['field', fieldId],
    queryFn: async () => {
      if (!fieldId) return null;
      
      const { data, error } = await supabase
        .from('fields')
        .select('*')
        .eq('id', fieldId)
        .maybeSingle();
      
      if (error) throw error;
      return data as Field | null;
    },
    enabled: !!fieldId,
  });
}

// Fetch field values for an entity
export function useFieldValues(entityType: FieldEntityType, entityId: string | null) {
  return useQuery({
    queryKey: ['field-values', entityType, entityId],
    queryFn: async () => {
      if (!entityId) return [];
      
      const { data, error } = await supabase
        .from('field_values')
        .select('*, fields(*)')
        .eq('entity_type', entityType)
        .eq('entity_id', entityId);
      
      if (error) throw error;
      return data as (FieldValue & { fields: Field })[];
    },
    enabled: !!entityId,
  });
}

// Create field mutation
export function useCreateField() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (field: Omit<Field, 'id' | 'created_at' | 'updated_at'>) => {
      const { data, error } = await supabase
        .from('fields')
        .insert(field)
        .select()
        .single();
      
      if (error) throw error;
      return data as Field;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fields'] });
      toast.success('Поле создано');
    },
    onError: (error: Error) => {
      toast.error(`Ошибка: ${error.message}`);
    },
  });
}

// Update field mutation
export function useUpdateField() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<Field> & { id: string }) => {
      const { data, error } = await supabase
        .from('fields')
        .update(updates)
        .eq('id', id)
        .select()
        .single();
      
      if (error) throw error;
      return data as Field;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fields'] });
      toast.success('Поле обновлено');
    },
    onError: (error: Error) => {
      toast.error(`Ошибка: ${error.message}`);
    },
  });
}

// Delete field mutation (only non-system)
export function useDeleteField() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (fieldId: string) => {
      const { error } = await supabase
        .from('fields')
        .delete()
        .eq('id', fieldId)
        .eq('is_system', false);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fields'] });
      toast.success('Поле удалено');
    },
    onError: (error: Error) => {
      toast.error(`Ошибка: ${error.message}`);
    },
  });
}

// Set field value
export function useSetFieldValue() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({
      fieldId,
      entityType,
      entityId,
      value,
    }: {
      fieldId: string;
      entityType: FieldEntityType;
      entityId: string;
      value: any;
    }) => {
      // Get field to determine value column
      const { data: field } = await supabase
        .from('fields')
        .select('data_type')
        .eq('id', fieldId)
        .single();
      
      if (!field) throw new Error('Field not found');
      
      // Determine value column based on data type
      const valueData: Record<string, any> = {
        field_id: fieldId,
        entity_type: entityType,
        entity_id: entityId,
        value_text: null,
        value_number: null,
        value_boolean: null,
        value_date: null,
        value_datetime: null,
        value_json: null,
      };
      
      switch (field.data_type) {
        case 'number':
        case 'money':
          valueData.value_number = value;
          break;
        case 'boolean':
          valueData.value_boolean = value;
          break;
        case 'date':
          valueData.value_date = value;
          break;
        case 'datetime':
          valueData.value_datetime = value;
          break;
        case 'json':
        case 'enum':
          valueData.value_json = value;
          break;
        default:
          valueData.value_text = value;
      }
      
      const { data, error } = await supabase
        .from('field_values')
        .upsert(valueData as any, { onConflict: 'field_id,entity_type,entity_id' })
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ 
        queryKey: ['field-values', variables.entityType, variables.entityId] 
      });
    },
  });
}

// Helper to get placeholder format
export function getFieldPlaceholder(field: Field): { byId: string; byKey: string } {
  return {
    byId: `{{fieldId:${field.id}}}`,
    byKey: `{{field:${field.entity_type}.${field.key}}}`,
  };
}

// Entity type labels
export const ENTITY_TYPE_LABELS: Record<FieldEntityType, string> = {
  client: 'Клиент',
  order: 'Заказ',
  subscription: 'Подписка',
  product: 'Продукт',
  tariff: 'Тариф',
  payment: 'Платёж',
  company: 'Компания',
  telegram_member: 'Telegram участник',
  custom: 'Пользовательская',
};

// Data type labels
export const DATA_TYPE_LABELS: Record<FieldDataType, string> = {
  string: 'Строка',
  number: 'Число',
  boolean: 'Да/Нет',
  date: 'Дата',
  datetime: 'Дата и время',
  money: 'Деньги',
  enum: 'Список',
  json: 'JSON',
  email: 'Email',
  phone: 'Телефон',
};
