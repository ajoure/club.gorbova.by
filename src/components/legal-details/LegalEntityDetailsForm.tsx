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
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ClientLegalDetails } from "@/hooks/useLegalDetails";
import { DEMO_LEGAL_ENTITY } from "@/constants/demoLegalDetails";
import { Loader2, Save, Info } from "lucide-react";
import { Separator } from "@/components/ui/separator";

const orgForms = ["ООО", "ЗАО", "ОАО", "ОДО", "УП", "КУП", "ЧУП", "Другое"];

const schema = z.object({
  leg_org_form: z.string().min(1, "Выберите организационную форму"),
  leg_name: z.string().min(3, "Введите название организации"),
  leg_unp: z.string().length(9, "УНП должен содержать 9 цифр"),
  leg_address: z.string().min(10, "Введите полный адрес"),
  leg_director_position: z.string().min(1, "Укажите должность"),
  leg_director_name: z.string().min(5, "Введите ФИО руководителя"),
  leg_acts_on_basis: z.string().optional(),
  bank_account: z.string().min(28, "IBAN формат BY...").max(28).or(z.literal("")),
  bank_name: z.string().min(3, "Укажите банк").or(z.literal("")),
  bank_code: z.string().min(6, "Укажите БИК").or(z.literal("")),
  phone: z.string().optional(),
  email: z.string().email("Некорректный email").optional().or(z.literal("")),
});

type FormData = z.infer<typeof schema>;

interface LegalEntityDetailsFormProps {
  initialData?: ClientLegalDetails | null;
  onSubmit: (data: Partial<ClientLegalDetails>) => Promise<void>;
  isSubmitting: boolean;
  showDemoOnEmpty?: boolean;
}

export function LegalEntityDetailsForm({ 
  initialData, 
  onSubmit, 
  isSubmitting,
  showDemoOnEmpty = true 
}: LegalEntityDetailsFormProps) {
  const hasRealData = !!initialData?.leg_name;
  const showDemoPlaceholders = !hasRealData && showDemoOnEmpty;

  const getDefaultValues = (): FormData => {
    if (hasRealData) {
      return {
        leg_org_form: initialData?.leg_org_form || "",
        leg_name: initialData?.leg_name || "",
        leg_unp: initialData?.leg_unp || "",
        leg_address: initialData?.leg_address || "",
        leg_director_position: initialData?.leg_director_position || "Директор",
        leg_director_name: initialData?.leg_director_name || "",
        leg_acts_on_basis: initialData?.leg_acts_on_basis || "Устава",
        bank_account: initialData?.bank_account || "",
        bank_name: initialData?.bank_name || "",
        bank_code: initialData?.bank_code || "",
        phone: initialData?.phone || "",
        email: initialData?.email || "",
      };
    }
    
    // Пустая форма - демо-данные показываются как placeholder
    return {
      leg_org_form: "",
      leg_name: "",
      leg_unp: "",
      leg_address: "",
      leg_director_position: "Директор",
      leg_director_name: "",
      leg_acts_on_basis: "Устава",
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

  const handleSubmit = async (data: FormData) => {
    await onSubmit({
      ...data,
      client_type: "legal_entity",
    });
  };

  // Функция для получения placeholder - показываем демо если нет данных
  const getPlaceholder = (field: keyof typeof DEMO_LEGAL_ENTITY, fallback: string) => {
    return showDemoPlaceholders ? (DEMO_LEGAL_ENTITY[field] || fallback) : fallback;
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6">
        {showDemoPlaceholders && (
          <Alert className="border-primary/50 bg-primary/5">
            <Info className="h-4 w-4" />
            <AlertDescription>
              Поля содержат <strong>примеры заполнения</strong> (показаны серым). 
              Просто начните вводить свои данные — примеры исчезнут автоматически.
            </AlertDescription>
          </Alert>
        )}

        {/* Organization Info */}
        <div className="space-y-4">
          <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Данные организации</h3>
          
          <div className="grid grid-cols-3 gap-4">
            <FormField
              control={form.control}
              name="leg_org_form"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Форма</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder={getPlaceholder("leg_org_form", "ООО")} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {orgForms.map((orgForm) => (
                        <SelectItem key={orgForm} value={orgForm}>{orgForm}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="leg_name"
              render={({ field }) => (
                <FormItem className="col-span-2">
                  <FormLabel>Название</FormLabel>
                  <FormControl>
                    <Input 
                      placeholder={getPlaceholder("leg_name", '"АЖУР инкам"')} 
                      {...field} 
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <FormField
            control={form.control}
            name="leg_unp"
            render={({ field }) => (
              <FormItem>
                <FormLabel>УНП</FormLabel>
                <FormControl>
                  <Input 
                    placeholder={getPlaceholder("leg_unp", "193405000")} 
                    maxLength={9} 
                    {...field} 
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="leg_address"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Юридический адрес</FormLabel>
                <FormControl>
                  <Input 
                    placeholder={getPlaceholder("leg_address", "220035, г. Минск, ул. Панфилова, 2, офис 49Л")} 
                    {...field} 
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <Separator />

        {/* Director Info */}
        <div className="space-y-4">
          <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Руководитель</h3>
          
          <div className="grid grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="leg_director_position"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Должность</FormLabel>
                  <FormControl>
                    <Input 
                      placeholder={getPlaceholder("leg_director_position", "Директор")} 
                      {...field} 
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="leg_director_name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>ФИО</FormLabel>
                  <FormControl>
                    <Input 
                      placeholder={getPlaceholder("leg_director_name", "Иванов Иван Иванович")} 
                      {...field} 
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <FormField
            control={form.control}
            name="leg_acts_on_basis"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Действует на основании</FormLabel>
                <FormControl>
                  <Input 
                    placeholder={getPlaceholder("leg_acts_on_basis", "Устава")} 
                    {...field} 
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <Separator />

        {/* Bank Details */}
        <div className="space-y-4">
          <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Банковские реквизиты</h3>
          
          <FormField
            control={form.control}
            name="bank_account"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Расчётный счёт (IBAN)</FormLabel>
                <FormControl>
                  <Input 
                    placeholder="BY00XXXX00000000000000000000" 
                    maxLength={28}
                    {...field}
                    onChange={e => field.onChange(e.target.value.toUpperCase())}
                  />
                </FormControl>
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
                    <Input 
                      placeholder={getPlaceholder("phone", "+375 17 3456789")} 
                      {...field} 
                    />
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
                    <Input 
                      type="email" 
                      placeholder={getPlaceholder("email", "info@company.by")} 
                      {...field} 
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
