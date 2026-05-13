/**
 * LegalEntityRequisitesForm — unified form for v2 requisites of
 * legal_entity / entrepreneur. Behavior driven by props.
 *
 * Stores all fields under `data` jsonb under canonical keys. Legacy keys
 * (leg_*, ent_*) coming from the B+C migration are normalized on read via
 * `normalizeLegacyData`. On save we strip any legacy/service keys and
 * preserve GRP fields (read-only) plus any unknown keys.
 *
 * Default is a record-level property. The actual default switch is done
 * via the transactional RPC `set_default_legal_entity_requisites`.
 *
 * No artificial-intelligence wording allowed in this module.
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
import { Loader2, Save, ShieldCheck } from "lucide-react";
import type {
  LegalEntityRequisitesRow,
  RequisitesScope,
} from "@/hooks/useRequisitesV2";
import {
  normalizeLegacyData,
  sanitizeForWrite,
  pickGrpSummary,
  GRP_LABELS,
} from "@/lib/requisites-v2/fieldMap";

const schema = z.object({
  org_form: z.string().optional().or(z.literal("")),
  name: z.string().min(2, "Введите наименование"),
  short_name: z.string().optional().or(z.literal("")),
  unp: z
    .string()
    .min(9, "УНП — 9 цифр")
    .max(9, "УНП — 9 цифр")
    .regex(/^\d{9}$/, "Только цифры"),
  address: z.string().optional().or(z.literal("")),
  director_position: z.string().optional().or(z.literal("")),
  director_full_name: z.string().optional().or(z.literal("")),
  director_short_name: z.string().optional().or(z.literal("")),
  acts_on_basis: z.string().optional().or(z.literal("")),
  bank_account: z.string().optional().or(z.literal("")),
  bank_name: z.string().optional().or(z.literal("")),
  bank_code: z.string().optional().or(z.literal("")),
  phone: z.string().optional().or(z.literal("")),
  email: z.string().email("Некорректный email").optional().or(z.literal("")),
  is_default: z.boolean().optional(),
  // ИП Руководитель/Подписант override (только для subjectType=entrepreneur).
  ent_director_position: z.string().optional().or(z.literal("")),
  ent_director_full_name: z.string().optional().or(z.literal("")),
  ent_director_short_name: z.string().optional().or(z.literal("")),
  ent_acts_on_basis_override: z.string().optional().or(z.literal("")),
});

/** Helper: «Иванов Иван Иванович» → «И. И. Иванов» */
function toInitials(full: string): string {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];
  const [last, ...rest] = parts;
  return `${rest.map((p) => p.charAt(0).toUpperCase() + ".").join(" ")} ${last}`;
}

/** Helper: «ИП "Горбова Е.А."» → «Горбова Е.А.» (для дефолта ФИО руководителя ИП). */
function stripIpPrefix(name: string): string {
  return name.replace(/^ИП\s*/i, "").replace(/[«»"']/g, "").trim();
}

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
  const rawData = (initialData?.data ?? {}) as Record<string, unknown>;
  // Read-side normalization: legacy leg_*/ent_* → canonical keys.
  const data = normalizeLegacyData(subjectType, rawData) as Record<
    string,
    string | undefined
  >;
  const grpRows = pickGrpSummary(rawData);

  const subjectLabel = subjectType === "legal_entity" ? "ЮЛ" : "ИП";
  const prefix = `[${SCOPE_LABEL[scope]}] [${subjectLabel}]`;

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      org_form: data.org_form ?? "",
      name: data.name ?? "",
      short_name: data.short_name ?? "",
      unp: data.unp ?? "",
      address: data.address ?? "",
      director_position: data.director_position ?? "",
      director_full_name: data.director_full_name ?? "",
      director_short_name: data.director_short_name ?? "",
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
    // Sanitize: keep only canonical + GRP + unknown keys; drop legacy/service.
    const cleaned = sanitizeForWrite(subjectType, rest as Record<string, unknown>, rawData);
    await onSubmit({ data: cleaned, is_default: !!is_default });
  };

  const showDirectorBlock = subjectType === "legal_entity";

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(submit)} className="space-y-5">
        {showDirectorBlock && (
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

        <div className="grid gap-4 md:grid-cols-2">
          <FormField
            control={form.control}
            name="name"
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
            name="short_name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{prefix} Краткое наименование</FormLabel>
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
          name="address"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{prefix} Юридический адрес</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormDescription>
                Структурированный адрес (address_structured) сохраняется без
                изменений из исходной записи.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        {showDirectorBlock && (
          <div className="grid gap-4 md:grid-cols-3">
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
              name="director_full_name"
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
            <FormField
              control={form.control}
              name="director_short_name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{prefix} ФИО (кратко)</FormLabel>
                  <FormControl>
                    <Input placeholder="И. И. Иванов" {...field} />
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

        {grpRows.length > 0 && (
          <div className="rounded-md border bg-muted/30 p-4 space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <ShieldCheck className="h-4 w-4 text-primary" />
              {prefix} GRP — обогащение из ЕГР (read-only)
            </div>
            <div className="grid gap-1 md:grid-cols-2 text-xs">
              {grpRows.map(({ key, value }) => (
                <div key={key} className="flex justify-between gap-2">
                  <span className="text-muted-foreground">
                    {GRP_LABELS[key as keyof typeof GRP_LABELS] ?? key}
                  </span>
                  <span className="truncate">{String(value)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

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
                  tenant + scope + subject_type. Переключение default —
                  через транзакционную RPC.
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
