import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useState, useEffect } from "react";
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
import { DEMO_ENTREPRENEUR, isDemoData } from "@/constants/demoLegalDetails";
import { Loader2, Save, Info } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";

const schema = z.object({
  ent_name: z.string().min(5, "Введите полное наименование ИП"),
  ent_unp: z.string().length(9, "УНП должен содержать 9 цифр"),
  ent_address: z.string().min(10, "Введите полный адрес"),
  ent_acts_on_basis: z.string().optional(),
  bank_account: z.string().min(28, "IBAN формат BY...").max(28).or(z.literal("")),
  bank_name: z.string().min(3, "Укажите банк").or(z.literal("")),
  bank_code: z.string().min(6, "Укажите БИК").or(z.literal("")),
  phone: z.string().optional(),
  email: z.string().email("Некорректный email").optional().or(z.literal("")),
});

type FormData = z.infer<typeof schema>;

interface EntrepreneurDetailsFormProps {
  initialData?: ClientLegalDetails | null;
  onSubmit: (data: Partial<ClientLegalDetails>) => Promise<void>;
  isSubmitting: boolean;
  showDemoOnEmpty?: boolean;
}

export function EntrepreneurDetailsForm({ 
  initialData, 
  onSubmit, 
  isSubmitting,
  showDemoOnEmpty = true 
}: EntrepreneurDetailsFormProps) {
  const hasRealData = !!initialData?.ent_name;
  const [isDemo, setIsDemo] = useState(!hasRealData && showDemoOnEmpty);
  const [hasUserEdited, setHasUserEdited] = useState(false);

  const getDefaultValues = (): FormData => {
    if (hasRealData) {
      return {
        ent_name: initialData?.ent_name || "",
        ent_unp: initialData?.ent_unp || "",
        ent_address: initialData?.ent_address || "",
        ent_acts_on_basis: initialData?.ent_acts_on_basis || "свидетельства о государственной регистрации",
        bank_account: initialData?.bank_account || "",
        bank_name: initialData?.bank_name || "",
        bank_code: initialData?.bank_code || "",
        phone: initialData?.phone || "",
        email: initialData?.email || "",
      };
    }
    
    if (showDemoOnEmpty) {
      return { ...DEMO_ENTREPRENEUR };
    }
    
    return {
      ent_name: "",
      ent_unp: "",
      ent_address: "",
      ent_acts_on_basis: "свидетельства о государственной регистрации",
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

  useEffect(() => {
    const subscription = form.watch(() => {
      if (isDemo && !hasUserEdited) {
        setHasUserEdited(true);
      }
    });
    return () => subscription.unsubscribe();
  }, [form, isDemo, hasUserEdited]);

  const handleSubmit = async (data: FormData) => {
    if (isDemoData(data)) {
      toast.error("Пожалуйста, замените демонстрационные данные на ваши реальные данные");
      return;
    }
    
    if (isDemo && !hasUserEdited) {
      toast.error("Введите ваши реальные данные для сохранения");
      return;
    }

    await onSubmit({
      ...data,
      client_type: "entrepreneur",
    });
    
    setIsDemo(false);
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6">
        {isDemo && (
          <Alert className="border-primary/50 bg-primary/5">
            <Info className="h-4 w-4" />
            <AlertDescription>
              Это <strong>демонстрационные данные</strong> для примера заполнения. 
              Замените их на ваши реальные данные перед сохранением.
            </AlertDescription>
          </Alert>
        )}

        {/* ИП Info */}
        <div className="space-y-4">
          <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Данные ИП</h3>
          
          <FormField
            control={form.control}
            name="ent_name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Наименование ИП</FormLabel>
                <FormControl>
                  <Input 
                    placeholder="ИП Федорчук Сергей Валерьевич" 
                    className={isDemo ? "border-primary/30" : ""}
                    {...field} 
                  />
                </FormControl>
                <FormDescription>Полное наименование как в свидетельстве</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="ent_unp"
            render={({ field }) => (
              <FormItem>
                <FormLabel>УНП</FormLabel>
                <FormControl>
                  <Input 
                    placeholder="123456789" 
                    maxLength={9} 
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
            name="ent_address"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Юридический адрес</FormLabel>
                <FormControl>
                  <Input 
                    placeholder="220035, г. Минск, ул. Примерная, д. 1, оф. 10" 
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
            name="ent_acts_on_basis"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Действует на основании</FormLabel>
                <FormControl>
                  <Input placeholder="свидетельства о государственной регистрации" {...field} />
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
                    placeholder="BY58ALFA30143083440050270000" 
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
