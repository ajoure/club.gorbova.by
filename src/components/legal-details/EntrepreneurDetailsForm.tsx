import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useState, useCallback, useEffect } from "react";
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
import { DEMO_ENTREPRENEUR } from "@/constants/demoLegalDetails";
import { Loader2, Save, Info } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { StructuredAddressBlock } from "@/components/shared/StructuredAddressBlock";
import type { StructuredAddress } from "@/lib/address/types";
import { EntrepreneurAddressAdapter } from "@/lib/address/adapters/EntrepreneurAddressAdapter";
import { formatFullAddress } from "@/lib/address/utils";
import { useGrpLookup } from "@/hooks/useGrpLookup";
import { isValidUnp } from "@/lib/legal-entities/normalizeUnp";
import { grpDataToAutofillFields, buildGrpDiff } from "@/lib/legal-entities/GrpAutofillService";
import type { GrpDiffEntry, GrpAutofillFields } from "@/lib/legal-entities/GrpAutofillService";
import { GrpConfirmDialog } from "./GrpConfirmDialog";
import { Badge } from "@/components/ui/badge";
import { enrichAddressViaGoogle } from "@/lib/address/GrpAddressEnricher";
import { emptyAddress } from "@/lib/address/utils";



const schema = z.object({
  ent_name: z.string().min(5, "Введите полное наименование ИП"),
  ent_unp: z.string().length(9, "УНП должен содержать 9 цифр"),
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
  pendingGrpPayload?: GrpAutofillFields | null;
  onPendingGrpPayloadConsumed?: () => void;
}

export function EntrepreneurDetailsForm({ 
  initialData, 
  onSubmit, 
  isSubmitting,
  showDemoOnEmpty = true,
  pendingGrpPayload,
  onPendingGrpPayloadConsumed,
}: EntrepreneurDetailsFormProps) {
  const hasRealData = !!initialData?.ent_name;
  const showDemoPlaceholders = !hasRealData && showDemoOnEmpty;

  const [address, setAddress] = useState<StructuredAddress>(() =>
    EntrepreneurAddressAdapter.toStructuredAddress({
      ent_address: initialData?.ent_address,
      ent_address_structured: initialData?.ent_address_structured as any,
    })
  );
  const [addressSource, setAddressSource] = useState<'manual' | 'google' | 'grp'>('manual');
  const [isEnrichingAddress, setIsEnrichingAddress] = useState(false);
  const grpLookup = useGrpLookup();
  const [grpDiff, setGrpDiff] = useState<GrpDiffEntry[]>([]);
  const [grpDialogOpen, setGrpDialogOpen] = useState(false);
  const [grpResult, setGrpResult] = useState<GrpAutofillFields | null>(null);
  const [autofilledFields, setAutofilledFields] = useState<Set<string>>(new Set());

  const getDefaultValues = (): FormData => {
    if (hasRealData) {
      return {
        ent_name: initialData?.ent_name || "",
        ent_unp: initialData?.ent_unp || "",
        ent_acts_on_basis: initialData?.ent_acts_on_basis || "свидетельства о государственной регистрации",
        bank_account: initialData?.bank_account || "",
        bank_name: initialData?.bank_name || "",
        bank_code: initialData?.bank_code || "",
        phone: initialData?.phone || "",
        email: initialData?.email || "",
      };
    }
    
    return {
      ent_name: "",
      ent_unp: "",
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

  const unpValue = form.watch("ent_unp");

  useEffect(() => {
    if (isValidUnp(unpValue) && unpValue !== initialData?.ent_unp) {
      grpLookup.mutate(unpValue, {
        onSuccess: (result) => {
          if (result.found && result.data) {
            const autofill = grpDataToAutofillFields(result.data);
            const currentValues: Partial<Record<keyof GrpAutofillFields, string>> = {
              name: form.getValues("ent_name"),
              address: formatFullAddress(address),
            };
            const diff = buildGrpDiff(currentValues, autofill);
            if (diff.length > 0) {
              setGrpResult(autofill);
              setGrpDiff(diff);
              setGrpDialogOpen(true);
            }
          }
        },
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unpValue]);

  // Apply GRP payload (either from local lookup or from ЮЛ→ИП switch handoff)
  const applyGrpPayload = useCallback(async (payload: GrpAutofillFields) => {
    const filled = new Set<string>();

    // For ИП: use clean_name (without "Индивидуальный предприниматель" prefix)
    const ipName = payload.clean_name || payload.name;
    if (ipName) {
      form.setValue("ent_name", ipName);
      filled.add("ent_name");
    }

    // Apply parsed structured address from clean state
    if (payload.parsed_address) {
      const freshAddress: StructuredAddress = {
        ...emptyAddress(),
        ...payload.parsed_address,
      };
      setAddress(freshAddress);
      setAddressSource('grp');
      filled.add("address");

      // Async enrichment via Google
      setIsEnrichingAddress(true);
      try {
        const result = await enrichAddressViaGoogle(freshAddress);
        if (result.enriched) {
          setAddress(result.address);
        }
      } finally {
        setIsEnrichingAddress(false);
      }
    }

    setAutofilledFields(filled);
  }, [form]);

  const handleGrpConfirm = useCallback(async () => {
    if (!grpResult) return;
    await applyGrpPayload(grpResult);
    setGrpDialogOpen(false);
  }, [grpResult, applyGrpPayload]);

  // Handle pending payload from ЮЛ→ИП switch
  useEffect(() => {
    if (pendingGrpPayload) {
      applyGrpPayload(pendingGrpPayload);
      onPendingGrpPayloadConsumed?.();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingGrpPayload]);

  const handleAddressChange = useCallback((val: StructuredAddress) => {
    setAddress(val);
    setAddressSource(val.google_place_id ? 'google' : 'manual');
  }, []);

  const handleSubmit = async (data: FormData) => {
    const addressFields = EntrepreneurAddressAdapter.toLegacyFields(address, addressSource);
    const sanitized: Record<string, unknown> = { ...data };
    for (const key of Object.keys(sanitized)) {
      if (/(_date|_until)$/.test(key) && sanitized[key] === "") sanitized[key] = null;
    }
    await onSubmit({
      ...(sanitized as Partial<FormData>),
      ...addressFields,
      client_type: "entrepreneur",
    });
  };

  const getPlaceholder = (field: keyof typeof DEMO_ENTREPRENEUR, fallback: string) => {
    return showDemoPlaceholders ? (DEMO_ENTREPRENEUR[field] || fallback) : fallback;
  };

  const isLookingUp = grpLookup.isPending;

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

        {/* ИП Info */}
        <div className="space-y-4">
          <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Данные ИП</h3>
          
          {/* УНП FIRST */}
          <FormField
            control={form.control}
            name="ent_unp"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="flex items-center gap-2">
                  УНП
                  {isLookingUp && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
                </FormLabel>
                <FormControl>
                  <Input 
                    placeholder={getPlaceholder("ent_unp", "123456789")} 
                    maxLength={9} 
                    {...field} 
                  />
                </FormControl>
                <FormDescription>
                  Введите УНП — остальные данные заполнятся автоматически
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="ent_name"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="flex items-center gap-2">
                  Наименование ИП
                  {autofilledFields.has("ent_name") && (
                    <Badge variant="outline" className="text-[10px] font-normal">авто</Badge>
                  )}
                </FormLabel>
                <FormControl>
                  <Input 
                    placeholder={getPlaceholder("ent_name", "ИП Федорчук Сергей Валерьевич")} 
                    {...field} 
                    onChange={(e) => {
                      field.onChange(e);
                      setAutofilledFields(prev => { const n = new Set(prev); n.delete("ent_name"); return n; });
                    }}
                  />
                </FormControl>
                <FormDescription>Полное наименование как в свидетельстве</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          {/* Structured Address */}
          <div>
            <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
              Юридический адрес
              {autofilledFields.has("address") && (
                <Badge variant="outline" className="text-[10px] font-normal">авто</Badge>
              )}
              {isEnrichingAddress && (
                <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
              )}
            </h4>
            <StructuredAddressBlock
              value={address}
              onChange={handleAddressChange}
              disabled={isSubmitting}
              compact
              countries={['by']}
            />
          </div>

          <FormField
            control={form.control}
            name="ent_acts_on_basis"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Действует на основании</FormLabel>
                <FormControl>
                  <Input 
                    placeholder={getPlaceholder("ent_acts_on_basis", "свидетельства о государственной регистрации")} 
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
                      placeholder={getPlaceholder("phone", "+375 44 7500084")} 
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
                      placeholder={getPlaceholder("email", "email@example.com")} 
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

      <GrpConfirmDialog
        open={grpDialogOpen}
        onOpenChange={setGrpDialogOpen}
        diff={grpDiff}
        statusName={grpLookup.data?.data?.status_name}
        liquidationDate={grpLookup.data?.data?.liquidation_date}
        onConfirm={handleGrpConfirm}
      />
    </Form>
  );
}
