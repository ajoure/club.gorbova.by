import { useForm } from "react-hook-form";
import { useLegalDetailsFields } from "@/hooks/useLegalDetailsFields";
import { FieldLabelWithId } from "./FieldLabelWithId";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useState, useCallback, useMemo } from "react";
import { DatePicker } from "@/components/ui/date-picker";
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
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ClientLegalDetails } from "@/hooks/useLegalDetails";
import { DEMO_INDIVIDUAL } from "@/constants/demoLegalDetails";
import { Loader2, Save, Info } from "lucide-react";
import { StructuredAddressBlock } from "@/components/shared/StructuredAddressBlock";
import type { StructuredAddress } from "@/lib/address/types";
import { IndividualAddressAdapter } from "@/lib/address/adapters/IndividualAddressAdapter";

const schema = z.object({
  // Required fields
  ind_full_name: z.string().min(5, "Введите ФИО полностью"),
  ind_birth_date: z.string().min(1, "Укажите дату рождения"),
  ind_personal_number: z.string().min(14, "14 символов").max(14, "14 символов"),
  email: z.string().min(1, "Email обязателен").email("Некорректный email"),
  phone: z.string().min(1, "Телефон обязателен"),
  // Optional fields
  ind_passport_series: z.string().optional(),
  ind_passport_number: z.string().optional(),
  ind_passport_issued_by: z.string().optional(),
  ind_passport_issued_date: z.string().optional(),
  ind_passport_valid_until: z.string().optional(),
  bank_account: z.string().optional(),
  bank_name: z.string().optional(),
  bank_code: z.string().optional(),
});

type FormData = z.infer<typeof schema>;

interface IndividualDetailsFormProps {
  initialData?: ClientLegalDetails | null;
  onSubmit: (data: Partial<ClientLegalDetails>) => Promise<void>;
  isSubmitting: boolean;
  showDemoOnEmpty?: boolean;
}

export function IndividualDetailsForm({ 
  initialData, 
  onSubmit, 
  isSubmitting,
  showDemoOnEmpty = true 
}: IndividualDetailsFormProps) {
  const hasRealData = !!initialData?.ind_full_name;
  const { fieldsMap } = useLegalDetailsFields();

  // Build address field IDs for StructuredAddressBlock CopyableIdChip
  const addressFieldIds = useMemo(() => {
    const addressKeyMap: Record<string, string> = {
      street: "ind_address_street",
      house: "ind_address_house",
      apartment: "ind_address_apartment",
      postal_code: "ind_address_index",
      region: "ind_address_region",
      city: "ind_address_city",
    };
    const map = new Map<string, import("@/hooks/useLegalDetailsFields").LegalDetailsFieldEntry>();
    for (const [addrKey, colKey] of Object.entries(addressKeyMap)) {
      const entry = fieldsMap.get(colKey);
      if (entry) map.set(addrKey, entry);
    }
    return map;
  }, [fieldsMap]);
  const showDemoPlaceholders = !hasRealData && showDemoOnEmpty;

  const [address, setAddress] = useState<StructuredAddress>(() =>
    IndividualAddressAdapter.toStructuredAddress({
      ind_address_index: initialData?.ind_address_index,
      ind_address_region: initialData?.ind_address_region,
      ind_address_district: initialData?.ind_address_district,
      ind_address_city: initialData?.ind_address_city,
      ind_address_street: initialData?.ind_address_street,
      ind_address_house: initialData?.ind_address_house,
      ind_address_apartment: initialData?.ind_address_apartment,
      ind_address_structured: initialData?.ind_address_structured as any,
    })
  );
  const [addressSource, setAddressSource] = useState<'manual' | 'google'>('manual');
  
  const getDefaultValues = (): FormData => {
    if (hasRealData) {
      return {
        ind_full_name: initialData?.ind_full_name || "",
        ind_birth_date: initialData?.ind_birth_date || "",
        ind_passport_series: initialData?.ind_passport_series || "",
        ind_passport_number: initialData?.ind_passport_number || "",
        ind_passport_issued_by: initialData?.ind_passport_issued_by || "",
        ind_passport_issued_date: initialData?.ind_passport_issued_date || "",
        ind_passport_valid_until: initialData?.ind_passport_valid_until || "",
        ind_personal_number: initialData?.ind_personal_number || "",
        bank_account: initialData?.bank_account || "",
        bank_name: initialData?.bank_name || "",
        bank_code: initialData?.bank_code || "",
        phone: initialData?.phone || "",
        email: initialData?.email || "",
      };
    }
    
    return {
      ind_full_name: "",
      ind_birth_date: "",
      ind_passport_series: "",
      ind_passport_number: "",
      ind_passport_issued_by: "",
      ind_passport_issued_date: "",
      ind_passport_valid_until: "",
      ind_personal_number: "",
      bank_account: "",
      bank_name: "",
      bank_code: "",
      phone: "",
      email: "",
    };
  };

  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: getDefaultValues(),
  });

  const handleAddressChange = useCallback((val: StructuredAddress) => {
    setAddress(val);
    setAddressSource(val.google_place_id ? 'google' : 'manual');
  }, []);

  const handleSubmit = async (data: FormData) => {
    const addressFields = IndividualAddressAdapter.toLegacyFields(address, addressSource);
    await onSubmit({
      ...data,
      ...addressFields,
      client_type: "individual",
    });
  };

  const getPlaceholder = (field: keyof typeof DEMO_INDIVIDUAL, fallback: string) => {
    return showDemoPlaceholders ? (DEMO_INDIVIDUAL[field] || fallback) : fallback;
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6" autoComplete="off">
        {showDemoPlaceholders && (
          <Alert className="border-primary/50 bg-primary/5">
            <Info className="h-4 w-4" />
            <AlertDescription>
              Поля содержат <strong>примеры заполнения</strong> (показаны серым). 
              Просто начните вводить свои данные — примеры исчезнут автоматически.
            </AlertDescription>
          </Alert>
        )}

        {/* Personal Info - Required */}
        <div className="rounded-xl border bg-card p-5 sm:p-6 shadow-sm space-y-5">
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-primary" />
            <h3 className="text-base font-semibold">
              Основные данные
            </h3>
          </div>
          
          <FormField
            control={form.control}
            name="ind_full_name"
            render={({ field }) => (
              <FormItem>
                <FieldLabelWithId label="ФИО полностью" fieldEntry={fieldsMap.get("ind_full_name")} required />
                <FormControl>
                  <Input 
                    placeholder={getPlaceholder("ind_full_name", "Иванов Иван Иванович")} 
                    autoComplete="off"
                    {...field} 
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="ind_birth_date"
              render={({ field }) => (
                <FormItem>
                  <FieldLabelWithId label="Дата рождения" fieldEntry={fieldsMap.get("ind_birth_date")} required />
                  <FormControl>
                    <DatePicker
                      value={field.value}
                      onChange={field.onChange}
                      placeholder={getPlaceholder("ind_birth_date", "")}
                      fromYear={1920}
                      toYear={new Date().getFullYear()}
                      maxDate={new Date().toISOString().slice(0, 10)}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="ind_personal_number"
              render={({ field }) => (
                <FormItem>
                  <FieldLabelWithId label="Личный номер" fieldEntry={fieldsMap.get("ind_personal_number")} required />
                  <FormControl>
                    <Input 
                      placeholder={getPlaceholder("ind_personal_number", "3140583A009PB1")} 
                      maxLength={14}
                      autoComplete="off"
                      {...field}
                      onChange={e => field.onChange(e.target.value.toUpperCase())}
                    />
                  </FormControl>
                  <FormDescription>14 символов из паспорта</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FieldLabelWithId label="Email" fieldEntry={fieldsMap.get("email")} required />
                  <FormControl>
                    <Input 
                      type="email" 
                      placeholder={getPlaceholder("email", "email@example.com")} 
                      autoComplete="off"
                      {...field} 
                    />
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
                  <FieldLabelWithId label="Телефон" fieldEntry={fieldsMap.get("phone")} required />
                  <FormControl>
                    <Input 
                      placeholder={getPlaceholder("phone", "+375 44 7500084")} 
                      autoComplete="off"
                      {...field} 
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </div>

        {/* Passport - Optional */}
        <div className="rounded-xl border bg-muted/30 p-5 sm:p-6 space-y-5">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="h-2 w-2 rounded-full bg-muted-foreground/40" />
            <h3 className="text-base font-medium text-muted-foreground">
              Паспортные данные
            </h3>
            <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">опционально</span>
          </div>
          
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <FormField
              control={form.control}
              name="ind_passport_series"
              render={({ field }) => (
                <FormItem>
                  <FieldLabelWithId label="Серия" fieldEntry={fieldsMap.get("ind_passport_series")} />
                  <FormControl>
                    <Input 
                      placeholder={getPlaceholder("ind_passport_series", "MP")} 
                      maxLength={2}
                      autoComplete="off"
                      {...field} 
                      onChange={e => field.onChange(e.target.value.toUpperCase())}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="ind_passport_number"
              render={({ field }) => (
                <FormItem>
                  <FieldLabelWithId label="Номер" fieldEntry={fieldsMap.get("ind_passport_number")} />
                  <FormControl>
                    <Input 
                      placeholder={getPlaceholder("ind_passport_number", "1234567")} 
                      maxLength={7} 
                      autoComplete="off" 
                      {...field} 
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="ind_passport_issued_date"
              render={({ field }) => (
                <FormItem>
                  <FieldLabelWithId label="Дата выдачи" fieldEntry={fieldsMap.get("ind_passport_issued_date")} />
                  <FormControl>
                    <DatePicker
                      value={field.value || ""}
                      onChange={field.onChange}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="ind_passport_valid_until"
              render={({ field }) => (
                <FormItem>
                  <FieldLabelWithId label="Действ. до" fieldEntry={fieldsMap.get("ind_passport_valid_until")} />
                  <FormControl>
                    <DatePicker
                      value={field.value || ""}
                      onChange={field.onChange}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <FormField
            control={form.control}
            name="ind_passport_issued_by"
            render={({ field }) => (
              <FormItem>
                <FieldLabelWithId label="Кем выдан" fieldEntry={fieldsMap.get("ind_passport_issued_by")} />
                <FormControl>
                  <Input 
                    placeholder={getPlaceholder("ind_passport_issued_by", "Фрунзенским РУВД г. Минска")} 
                    autoComplete="off" 
                    {...field} 
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {/* Address - StructuredAddressBlock */}
        <div className="rounded-xl border bg-muted/30 p-5 sm:p-6 space-y-5">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="h-2 w-2 rounded-full bg-muted-foreground/40" />
            <h3 className="text-base font-medium text-muted-foreground">
              Адрес регистрации
            </h3>
            <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">опционально</span>
          </div>
          
          <StructuredAddressBlock
            value={address}
            onChange={handleAddressChange}
            disabled={isSubmitting}
            compact
            countries={['by']}
            fieldIds={addressFieldIds}
          />
        </div>

        {/* Bank - Optional */}
        <div className="rounded-xl border bg-muted/30 p-5 sm:p-6 space-y-5">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="h-2 w-2 rounded-full bg-muted-foreground/40" />
            <h3 className="text-base font-medium text-muted-foreground">
              Банковские реквизиты
            </h3>
            <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">опционально</span>
          </div>

          <FormField
            control={form.control}
            name="bank_account"
            render={({ field }) => (
              <FormItem>
                <FieldLabelWithId label="Расчётный счёт (IBAN)" fieldEntry={fieldsMap.get("bank_account")} />
                <FormControl>
                  <Input 
                    placeholder="BY00XXXX00000000000000000000"
                    maxLength={28}
                    autoComplete="off"
                    {...field}
                    onChange={e => field.onChange(e.target.value.toUpperCase())}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="bank_name"
              render={({ field }) => (
                <FormItem>
                  <FieldLabelWithId label="Банк" fieldEntry={fieldsMap.get("bank_name")} />
                  <FormControl>
                    <Input placeholder='ЗАО "Альфа-Банк"' autoComplete="off" {...field} />
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
                  <FieldLabelWithId label="БИК" fieldEntry={fieldsMap.get("bank_code")} />
                  <FormControl>
                    <Input 
                      placeholder="ALFABY2X" 
                      autoComplete="off"
                      {...field}
                      onChange={e => field.onChange(e.target.value.toUpperCase())}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </div>

        <Button type="submit" disabled={isSubmitting} className="w-full gap-2">
          {isSubmitting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          Сохранить реквизиты
        </Button>
      </form>
    </Form>
  );
}
