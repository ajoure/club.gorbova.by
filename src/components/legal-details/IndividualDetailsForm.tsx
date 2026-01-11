import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useEffect, useState } from "react";
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
import { DEMO_INDIVIDUAL, isDemoData } from "@/constants/demoLegalDetails";
import { Loader2, Save, Info } from "lucide-react";
import { toast } from "sonner";

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
  ind_address_index: z.string().optional(),
  ind_address_region: z.string().optional(),
  ind_address_district: z.string().optional(),
  ind_address_city: z.string().optional(),
  ind_address_street: z.string().optional(),
  ind_address_house: z.string().optional(),
  ind_address_apartment: z.string().optional(),
  bank_account: z.string().optional(),
  bank_name: z.string().optional(),
  bank_code: z.string().optional(),
});

type FormData = z.infer<typeof schema>;

interface IndividualDetailsFormProps {
  initialData?: ClientLegalDetails | null;
  onSubmit: (data: Partial<ClientLegalDetails>) => Promise<void>;
  isSubmitting: boolean;
  showDemoOnEmpty?: boolean; // Показывать демо-данные, если нет сохранённых
}

export function IndividualDetailsForm({ 
  initialData, 
  onSubmit, 
  isSubmitting,
  showDemoOnEmpty = true 
}: IndividualDetailsFormProps) {
  // Определяем, нужно ли показывать демо-данные
  const hasRealData = !!initialData?.ind_full_name;
  const [isDemo, setIsDemo] = useState(!hasRealData && showDemoOnEmpty);
  const [hasUserEdited, setHasUserEdited] = useState(false);
  
  // Выбираем источник данных: реальные или демо
  const getDefaultValues = (): FormData => {
    if (hasRealData) {
      // Реальные данные пользователя
      return {
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
      };
    }
    
    if (showDemoOnEmpty) {
      // Демо-данные для пустой формы
      return {
        ...DEMO_INDIVIDUAL,
      };
    }
    
    // Пустая форма
    return {
      ind_full_name: "",
      ind_birth_date: "",
      ind_passport_series: "",
      ind_passport_number: "",
      ind_passport_issued_by: "",
      ind_passport_issued_date: "",
      ind_passport_valid_until: "",
      ind_personal_number: "",
      ind_address_index: "",
      ind_address_region: "",
      ind_address_district: "",
      ind_address_city: "",
      ind_address_street: "",
      ind_address_house: "",
      ind_address_apartment: "",
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

  // Отслеживаем изменения формы
  useEffect(() => {
    const subscription = form.watch(() => {
      if (isDemo && !hasUserEdited) {
        setHasUserEdited(true);
      }
    });
    return () => subscription.unsubscribe();
  }, [form, isDemo, hasUserEdited]);

  const handleSubmit = async (data: FormData) => {
    // ЗАЩИТА: Не сохраняем демо-данные в БД
    if (isDemoData(data)) {
      toast.error("Пожалуйста, замените демонстрационные данные на ваши реальные данные");
      return;
    }
    
    // Проверяем, что пользователь изменил хотя бы обязательные поля
    if (isDemo && !hasUserEdited) {
      toast.error("Введите ваши реальные данные для сохранения");
      return;
    }

    await onSubmit({
      ...data,
      client_type: "individual",
    });
    
    // После успешного сохранения убираем флаг демо
    setIsDemo(false);
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6" autoComplete="off">
        {/* Предупреждение о демо-данных */}
        {isDemo && (
          <Alert className="border-primary/50 bg-primary/5">
            <Info className="h-4 w-4" />
            <AlertDescription>
              Это <strong>демонстрационные данные</strong> для примера заполнения. 
              Замените их на ваши реальные данные перед сохранением.
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
                <FormLabel>ФИО полностью *</FormLabel>
                <FormControl>
                  <Input 
                    placeholder="Иванов Иван Иванович" 
                    autoComplete="off"
                    className={isDemo ? "border-primary/30" : ""}
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
                  <FormLabel>Дата рождения *</FormLabel>
                  <FormControl>
                    <Input 
                      type="date" 
                      autoComplete="off" 
                      className={isDemo ? "border-primary/30" : ""}
                      {...field} 
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
                  <FormLabel>Личный номер *</FormLabel>
                  <FormControl>
                    <Input 
                      placeholder="3140583A009PB1" 
                      maxLength={14}
                      autoComplete="off"
                      className={isDemo ? "border-primary/30" : ""}
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
                  <FormLabel>Email *</FormLabel>
                  <FormControl>
                    <Input 
                      type="email" 
                      placeholder="email@example.com" 
                      autoComplete="off"
                      className={isDemo ? "border-primary/30" : ""}
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
                  <FormLabel>Телефон *</FormLabel>
                  <FormControl>
                    <Input 
                      placeholder="+375 44 7500084" 
                      autoComplete="off"
                      className={isDemo ? "border-primary/30" : ""}
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
                  <FormLabel>Серия</FormLabel>
                  <FormControl>
                    <Input 
                      placeholder="MP" 
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
                  <FormLabel>Номер</FormLabel>
                  <FormControl>
                    <Input placeholder="1234567" maxLength={7} autoComplete="off" {...field} />
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
                  <FormLabel>Дата выдачи</FormLabel>
                  <FormControl>
                    <Input type="date" autoComplete="off" {...field} />
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
                  <FormLabel>Действ. до</FormLabel>
                  <FormControl>
                    <Input type="date" autoComplete="off" {...field} />
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
                  <Input placeholder="Фрунзенским РУВД г. Минска" autoComplete="off" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {/* Address - Optional */}
        <div className="rounded-xl border bg-muted/30 p-5 sm:p-6 space-y-5">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="h-2 w-2 rounded-full bg-muted-foreground/40" />
            <h3 className="text-base font-medium text-muted-foreground">
              Адрес регистрации
            </h3>
            <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">опционально</span>
          </div>
          
          <div className="grid grid-cols-3 gap-4">
            <FormField
              control={form.control}
              name="ind_address_index"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Индекс</FormLabel>
                  <FormControl>
                    <Input placeholder="222840" autoComplete="off" {...field} />
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
                    <Input placeholder="Минская область" autoComplete="off" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="ind_address_district"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Район (если есть)</FormLabel>
                  <FormControl>
                    <Input placeholder="Пуховичский район" autoComplete="off" {...field} />
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
                    <Input placeholder="г. Минск / аг. Дукора" autoComplete="off" {...field} />
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
                    <Input placeholder="ул. Блашко" autoComplete="off" {...field} />
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
                      <Input placeholder="25" autoComplete="off" {...field} />
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
                      <Input placeholder="12" autoComplete="off" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </div>
        </div>

        {/* Bank Details (optional) */}
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
                <FormLabel>Расчётный счёт (IBAN)</FormLabel>
                <FormControl>
                  <Input 
                    placeholder="BY58ALFA30143083440050270000" 
                    maxLength={28}
                    autoComplete="off"
                    {...field}
                    onChange={e => field.onChange(e.target.value.toUpperCase())}
                  />
                </FormControl>
                <FormDescription>28 символов, начинается с BY</FormDescription>
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
                  <FormLabel>Банк</FormLabel>
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
                  <FormLabel>БИК/Код</FormLabel>
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

        <Button type="submit" disabled={isSubmitting} className="w-full gap-2" size="lg">
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
