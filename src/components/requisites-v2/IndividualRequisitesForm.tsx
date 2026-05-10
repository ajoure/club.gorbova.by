/**
 * IndividualRequisitesForm — unified form for V2 individual requisites.
 *
 * scope: 'system_customer' | 'user_requisites'
 * subject_type is implicit: 'individual'.
 *
 * Stores all fields under `data` jsonb.
 */

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Save } from "lucide-react";
import type {
  IndividualRequisitesRow,
  RequisitesScope,
} from "@/hooks/useRequisitesV2";

const schema = z.object({
  full_name: z.string().min(5, "Введите ФИО полностью"),
  birth_date: z.string().optional().or(z.literal("")),
  personal_number: z.string().optional().or(z.literal("")),
  passport_series: z.string().optional().or(z.literal("")),
  passport_number: z.string().optional().or(z.literal("")),
  passport_issued_by: z.string().optional().or(z.literal("")),
  passport_issued_date: z.string().optional().or(z.literal("")),
  address: z.string().optional().or(z.literal("")),
  bank_account: z.string().optional().or(z.literal("")),
  bank_name: z.string().optional().or(z.literal("")),
  bank_code: z.string().optional().or(z.literal("")),
  phone: z.string().optional().or(z.literal("")),
  email: z.string().email("Некорректный email").optional().or(z.literal("")),
  is_default: z.boolean().optional(),
});

type FormValues = z.infer<typeof schema>;

const SCOPE_LABEL: Record<RequisitesScope, string> = {
  system_customer: "Сист. заказчик",
  user_requisites: "Пользовательские",
};

export interface IndividualRequisitesFormProps {
  scope: RequisitesScope;
  initialData?: IndividualRequisitesRow | null;
  isSubmitting?: boolean;
  onSubmit: (values: {
    data: Record<string, unknown>;
    is_default: boolean;
  }) => Promise<void> | void;
  onCancel?: () => void;
}

export function IndividualRequisitesForm({
  scope,
  initialData,
  isSubmitting,
  onSubmit,
  onCancel,
}: IndividualRequisitesFormProps) {
  const data = (initialData?.data ?? {}) as Record<string, string | undefined>;
  const prefix = `[${SCOPE_LABEL[scope]}] [ФЛ]`;

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      full_name: data.full_name ?? "",
      birth_date: data.birth_date ?? "",
      personal_number: data.personal_number ?? "",
      passport_series: data.passport_series ?? "",
      passport_number: data.passport_number ?? "",
      passport_issued_by: data.passport_issued_by ?? "",
      passport_issued_date: data.passport_issued_date ?? "",
      address: data.address ?? "",
      bank_account: data.bank_account ?? "",
      bank_name: data.bank_name ?? "",
      bank_code: data.bank_code ?? "",
      phone: data.phone ?? "",
      email: data.email ?? "",
      is_default: !!initialData?.is_default,
    },
  });

  const submit = async (v: FormValues) => {
    const { is_default, ...rest } = v;
    const cleaned: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(rest)) {
      if (val !== undefined && val !== "") cleaned[k] = val;
    }
    await onSubmit({ data: cleaned, is_default: !!is_default });
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(submit)} className="space-y-5">
        <FormField
          control={form.control}
          name="full_name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{prefix} ФИО полностью *</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid gap-4 md:grid-cols-2">
          <FormField
            control={form.control}
            name="birth_date"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{prefix} Дата рождения</FormLabel>
                <FormControl>
                  <Input type="date" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="personal_number"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{prefix} Личный номер</FormLabel>
                <FormControl>
                  <Input maxLength={14} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="passport_series"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{prefix} Паспорт серия</FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="passport_number"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{prefix} Паспорт номер</FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="passport_issued_by"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{prefix} Кем выдан</FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="passport_issued_date"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{prefix} Дата выдачи</FormLabel>
                <FormControl>
                  <Input type="date" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="address"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{prefix} Адрес регистрации</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid gap-4 md:grid-cols-2">
          <FormField
            control={form.control}
            name="bank_account"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{prefix} Расчётный счёт</FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="bank_name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{prefix} Банк</FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="bank_code"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{prefix} Код банка (BIC)</FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="phone"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{prefix} Телефон</FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{prefix} Email</FormLabel>
              <FormControl>
                <Input type="email" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="is_default"
          render={({ field }) => (
            <FormItem className="flex items-start gap-3 rounded-md border p-3">
              <FormControl>
                <Checkbox
                  checked={!!field.value}
                  onCheckedChange={(v) => field.onChange(!!v)}
                />
              </FormControl>
              <div className="space-y-1">
                <FormLabel className="cursor-pointer">
                  Использовать по умолчанию
                </FormLabel>
                <FormDescription>
                  Свойство записи. Уникальность default — в пределах
                  tenant + scope.
                </FormDescription>
              </div>
            </FormItem>
          )}
        />

        <div className="flex justify-end gap-2">
          {onCancel && (
            <Button type="button" variant="ghost" onClick={onCancel}>
              Отмена
            </Button>
          )}
          <Button type="submit" disabled={!!isSubmitting}>
            {isSubmitting ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Save className="h-4 w-4 mr-2" />
            )}
            Сохранить
          </Button>
        </div>
      </form>
    </Form>
  );
}
