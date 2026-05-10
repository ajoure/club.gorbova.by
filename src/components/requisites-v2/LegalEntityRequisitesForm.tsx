/**
 * LegalEntityRequisitesForm — unified form for V2 requisites of legal_entity / entrepreneur.
 *
 * One component, behavior driven by props:
 *  - scope: 'system_customer' | 'user_requisites'
 *  - subject_type: 'legal_entity' | 'entrepreneur'
 *  - tenant_id (resolved by parent / hook)
 *
 * Stores all fields under `data` jsonb. No 'AI' wording anywhere.
 * Default is a record-level property; never a label group.
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
  LegalEntityRequisitesRow,
  RequisitesScope,
} from "@/hooks/useRequisitesV2";

const schema = z.object({
  org_form: z.string().optional().or(z.literal("")),
  full_name: z.string().min(2, "Введите наименование"),
  unp: z
    .string()
    .min(9, "УНП — 9 цифр")
    .max(9, "УНП — 9 цифр")
    .regex(/^\d{9}$/, "Только цифры"),
  legal_address: z.string().optional().or(z.literal("")),
  director_position: z.string().optional().or(z.literal("")),
  director_name: z.string().optional().or(z.literal("")),
  acts_on_basis: z.string().optional().or(z.literal("")),
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

export interface LegalEntityRequisitesFormProps {
  scope: RequisitesScope;
  subjectType: "legal_entity" | "entrepreneur";
  initialData?: LegalEntityRequisitesRow | null;
  isSubmitting?: boolean;
  onSubmit: (values: {
    data: Record<string, unknown>;
    is_default: boolean;
  }) => Promise<void> | void;
  onCancel?: () => void;
}

export function LegalEntityRequisitesForm({
  scope,
  subjectType,
  initialData,
  isSubmitting,
  onSubmit,
  onCancel,
}: LegalEntityRequisitesFormProps) {
  const data = (initialData?.data ?? {}) as Record<string, string | undefined>;
  const subjectLabel = subjectType === "legal_entity" ? "ЮЛ" : "ИП";
  const prefix = `[${SCOPE_LABEL[scope]}] [${subjectLabel}]`;

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      org_form: data.org_form ?? "",
      full_name: data.full_name ?? "",
      unp: data.unp ?? "",
      legal_address: data.legal_address ?? "",
      director_position: data.director_position ?? "",
      director_name: data.director_name ?? "",
      acts_on_basis: data.acts_on_basis ?? "",
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
        {subjectType === "legal_entity" && (
          <FormField
            control={form.control}
            name="org_form"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{prefix} Организационно-правовая форма</FormLabel>
                <FormControl>
                  <Input placeholder="ООО / ОДО / ЗАО / УП…" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        <FormField
          control={form.control}
          name="full_name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                {prefix}{" "}
                {subjectType === "legal_entity"
                  ? "Полное наименование"
                  : "Наименование ИП"}{" "}
                *
              </FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="unp"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{prefix} УНП *</FormLabel>
              <FormControl>
                <Input maxLength={9} placeholder="9 цифр" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="legal_address"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{prefix} Юридический адрес</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {subjectType === "legal_entity" && (
          <div className="grid gap-4 md:grid-cols-2">
            <FormField
              control={form.control}
              name="director_position"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{prefix} Должность руководителя</FormLabel>
                  <FormControl>
                    <Input placeholder="Директор" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="director_name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{prefix} ФИО руководителя</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        )}

        <FormField
          control={form.control}
          name="acts_on_basis"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{prefix} Действует на основании</FormLabel>
              <FormControl>
                <Input placeholder="Устава / Свидетельства…" {...field} />
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
                  Свойство записи. Только одна запись может быть отмечена как
                  default в пределах tenant + scope + subject_type.
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
