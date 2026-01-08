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
import { ClientLegalDetails } from "@/hooks/useLegalDetails";
import { Loader2, Save } from "lucide-react";
import { Separator } from "@/components/ui/separator";

const schema = z.object({
  ind_full_name: z.string().min(5, "Введите ФИО полностью"),
  ind_birth_date: z.string().min(1, "Укажите дату рождения"),
  ind_passport_series: z.string().length(2, "2 буквы").toUpperCase(),
  ind_passport_number: z.string().length(7, "7 цифр"),
  ind_passport_issued_by: z.string().min(5, "Укажите кем выдан паспорт"),
  ind_passport_issued_date: z.string().min(1, "Укажите дату выдачи"),
  ind_passport_valid_until: z.string().min(1, "Укажите срок действия"),
  ind_personal_number: z.string().min(14, "14 символов").max(14, "14 символов"),
  ind_address_index: z.string().min(1, "Индекс"),
  ind_address_region: z.string().min(1, "Область"),
  ind_address_district: z.string().optional(),
  ind_address_city: z.string().min(1, "Населённый пункт"),
  ind_address_street: z.string().min(1, "Улица"),
  ind_address_house: z.string().min(1, "Дом"),
  ind_address_apartment: z.string().optional(),
  bank_account: z.string().min(28, "IBAN формат BY...").max(28, "IBAN формат BY...").optional().or(z.literal("")),
  bank_name: z.string().optional(),
  bank_code: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email("Некорректный email").optional().or(z.literal("")),
});

type FormData = z.infer<typeof schema>;

interface IndividualDetailsFormProps {
  initialData?: ClientLegalDetails | null;
  onSubmit: (data: Partial<ClientLegalDetails>) => Promise<void>;
  isSubmitting: boolean;
}

export function IndividualDetailsForm({ initialData, onSubmit, isSubmitting }: IndividualDetailsFormProps) {
  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      ind_full_name: initialData?.ind_full_name || "",
      ind_birth_date: initialData?.ind_birth_date || "",
      ind_passport_series: initialData?.ind_passport_series || "",
      ind_passport_number: initialData?.ind_passport_number || "",
      ind_passport_issued_by: initialData?.ind_passport_issued_by || "",
      ind_passport_issued_date: initialData?.ind_passport_issued_date || "",
      ind_passport_valid_until: initialData?.ind_passport_valid_until || "",
      ind_personal_number: initialData?.ind_personal_number || "",
      ind_address_index: initialData?.ind_address_index || "",
      ind_address_region: initialData?.ind_address_region || "",
      ind_address_district: initialData?.ind_address_district || "",
      ind_address_city: initialData?.ind_address_city || "",
      ind_address_street: initialData?.ind_address_street || "",
      ind_address_house: initialData?.ind_address_house || "",
      ind_address_apartment: initialData?.ind_address_apartment || "",
      bank_account: initialData?.bank_account || "",
      bank_name: initialData?.bank_name || "",
      bank_code: initialData?.bank_code || "",
      phone: initialData?.phone || "",
      email: initialData?.email || "",
    },
  });

  const handleSubmit = async (data: FormData) => {
    await onSubmit({
      ...data,
      client_type: "individual",
    });
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6">
        {/* Personal Info */}
        <div className="space-y-4">
          <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Личные данные</h3>
          
          <FormField
            control={form.control}
            name="ind_full_name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>ФИО полностью</FormLabel>
                <FormControl>
                  <Input placeholder="Иванов Иван Иванович" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="ind_birth_date"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Дата рождения</FormLabel>
                <FormControl>
                  <Input type="date" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <Separator />

        {/* Passport */}
        <div className="space-y-4">
          <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Паспортные данные</h3>
          
          <div className="grid grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="ind_passport_series"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Серия</FormLabel>
                  <FormControl>
                    <Input 
                      placeholder="MP" 
                      maxLength={2} 
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
                  <FormLabel>Номер</FormLabel>
                  <FormControl>
                    <Input placeholder="1234567" maxLength={7} {...field} />
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
                <FormLabel>Кем выдан</FormLabel>
                <FormControl>
                  <Input placeholder="Фрунзенским РУВД г. Минска" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="grid grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="ind_passport_issued_date"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Дата выдачи</FormLabel>
                  <FormControl>
                    <Input type="date" {...field} />
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
                  <FormLabel>Действителен до</FormLabel>
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
            name="ind_personal_number"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Личный номер (идентификационный)</FormLabel>
                <FormControl>
                  <Input 
                    placeholder="3140583A009PB1" 
                    maxLength={14} 
                    {...field}
                    onChange={e => field.onChange(e.target.value.toUpperCase())}
                  />
                </FormControl>
                <FormDescription>14 символов, как указано в паспорте</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <Separator />

        {/* Address */}
        <div className="space-y-4">
          <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Адрес регистрации</h3>
          
          <div className="grid grid-cols-3 gap-4">
            <FormField
              control={form.control}
              name="ind_address_index"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Индекс</FormLabel>
                  <FormControl>
                    <Input placeholder="222840" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="ind_address_region"
              render={({ field }) => (
                <FormItem className="col-span-2">
                  <FormLabel>Область</FormLabel>
                  <FormControl>
                    <Input placeholder="Минская область" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="ind_address_district"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Район (если есть)</FormLabel>
                  <FormControl>
                    <Input placeholder="Пуховичский район" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="ind_address_city"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Населённый пункт</FormLabel>
                  <FormControl>
                    <Input placeholder="г. Минск / аг. Дукора" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <FormField
              control={form.control}
              name="ind_address_street"
              render={({ field }) => (
                <FormItem className="col-span-2">
                  <FormLabel>Улица</FormLabel>
                  <FormControl>
                    <Input placeholder="ул. Блашко" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid grid-cols-2 gap-2">
              <FormField
                control={form.control}
                name="ind_address_house"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Дом</FormLabel>
                    <FormControl>
                      <Input placeholder="25" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="ind_address_apartment"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Кв.</FormLabel>
                    <FormControl>
                      <Input placeholder="12" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </div>
        </div>

        <Separator />

        {/* Bank Details (optional) */}
        <div className="space-y-4">
          <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
            Банковские реквизиты <span className="font-normal">(опционально)</span>
          </h3>
          
          <FormField
            control={form.control}
            name="bank_account"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Расчётный счёт (IBAN)</FormLabel>
                <FormControl>
                  <Input 
                    placeholder="BY58ALFA30143083440050270000" 
                    maxLength={28}
                    {...field}
                    onChange={e => field.onChange(e.target.value.toUpperCase())}
                  />
                </FormControl>
                <FormDescription>28 символов, начинается с BY</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="grid grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="bank_name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Банк</FormLabel>
                  <FormControl>
                    <Input placeholder='ЗАО "Альфа-Банк"' {...field} />
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
                  <FormLabel>БИК/Код</FormLabel>
                  <FormControl>
                    <Input 
                      placeholder="ALFABY2X" 
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

        <Separator />

        {/* Contacts */}
        <div className="space-y-4">
          <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Контакты</h3>
          
          <div className="grid grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="phone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Телефон</FormLabel>
                  <FormControl>
                    <Input placeholder="+375 44 7500084" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input type="email" placeholder="email@example.com" {...field} />
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
