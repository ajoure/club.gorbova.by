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
import { DEMO_LEGAL_ENTITY } from "@/constants/demoLegalDetails";
import { Loader2, Save, Info } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { StructuredAddressBlock } from "@/components/shared/StructuredAddressBlock";
import type { StructuredAddress } from "@/lib/address/types";
import { LegalEntityAddressAdapter } from "@/lib/address/adapters/LegalEntityAddressAdapter";
import { emptyAddress, formatFullAddress } from "@/lib/address/utils";
import { useGrpLookup } from "@/hooks/useGrpLookup";
import { isValidUnp } from "@/lib/legal-entities/normalizeUnp";
import {
  grpDataToAutofillFields,
  buildGrpDiff,
  ORG_FORM_SHORT_TO_FULL,
  ORG_FORM_FULL_TO_SHORT,
} from "@/lib/legal-entities/GrpAutofillService";
import type { GrpDiffEntry, GrpAutofillFields } from "@/lib/legal-entities/GrpAutofillService";
import { GrpConfirmDialog } from "./GrpConfirmDialog";
import { OrgFormCombobox } from "./OrgFormCombobox";
import { Badge } from "@/components/ui/badge";
import { enrichAddressViaGoogle } from "@/lib/address/GrpAddressEnricher";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const OTHER_VALUE = '__OTHER__';

/** Normalize legacy short values to full canonical on read */
function normalizeOrgForm(val: string | null | undefined): string {
  if (!val) return "";
  if (ORG_FORM_FULL_TO_SHORT[val]) return val;
  if (ORG_FORM_SHORT_TO_FULL[val]) return ORG_FORM_SHORT_TO_FULL[val];
  return val;
}

const schema = z.object({
  leg_org_form: z.string().min(1, "Выберите организационную форму"),
  leg_name: z.string().min(3, "Введите название организации"),
  leg_unp: z.string().length(9, "УНП должен содержать 9 цифр"),
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
  onRequestSwitchToEntrepreneur?: (payload: GrpAutofillFields) => void;
}

export function LegalEntityDetailsForm({ 
  initialData, 
  onSubmit, 
  isSubmitting,
  showDemoOnEmpty = true,
  onRequestSwitchToEntrepreneur,
}: LegalEntityDetailsFormProps) {
  const hasRealData = !!initialData?.leg_name;
  const showDemoPlaceholders = !hasRealData && showDemoOnEmpty;

  // Address state (outside react-hook-form)
  const [address, setAddress] = useState<StructuredAddress>(() =>
    LegalEntityAddressAdapter.toStructuredAddress({
      leg_address: initialData?.leg_address,
      leg_address_structured: initialData?.leg_address_structured as any,
    })
  );
  const [addressSource, setAddressSource] = useState<'manual' | 'google' | 'grp'>('manual');
  const [isEnrichingAddress, setIsEnrichingAddress] = useState(false);

  // Custom org form fields (for "Другое")
  const [customFullForm, setCustomFullForm] = useState('');
  const [customShortForm, setCustomShortForm] = useState('');

  // GRP lookup
  const grpLookup = useGrpLookup();
  const [grpDiff, setGrpDiff] = useState<GrpDiffEntry[]>([]);
  const [grpDialogOpen, setGrpDialogOpen] = useState(false);
  const [grpResult, setGrpResult] = useState<GrpAutofillFields | null>(null);
  const [ipSwitchDialogOpen, setIpSwitchDialogOpen] = useState(false);
  const [pendingIpPayload, setPendingIpPayload] = useState<GrpAutofillFields | null>(null);
  const [autofilledFields, setAutofilledFields] = useState<Set<string>>(new Set());

  const getDefaultValues = (): FormData => {
    if (hasRealData) {
      return {
        leg_org_form: normalizeOrgForm(initialData?.leg_org_form),
        leg_name: initialData?.leg_name || "",
        leg_unp: initialData?.leg_unp || "",
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
    
    return {
      leg_org_form: "",
      leg_name: "",
      leg_unp: "",
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

  // Watch UNP for auto-lookup
  const unpValue = form.watch("leg_unp");

  useEffect(() => {
    if (isValidUnp(unpValue) && unpValue !== initialData?.leg_unp) {
      grpLookup.mutate(unpValue, {
        onSuccess: (result) => {
          if (result.found && result.data) {
            const autofill = grpDataToAutofillFields(result.data);
            const currentValues: Partial<Record<keyof GrpAutofillFields, string>> = {
              clean_name: form.getValues("leg_name"),
              org_form_full: form.getValues("leg_org_form"),
              short_name: "",
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

  const handleGrpConfirm = useCallback(async () => {
    if (!grpResult) return;

    // If lookup returned an entrepreneur, don't apply as legal entity
    if (grpResult.entity_kind === 'entrepreneur') {
      setGrpDialogOpen(false);
      setPendingIpPayload(grpResult);
      setIpSwitchDialogOpen(true);
      return;
    }

    const filled = new Set<string>();

    // Apply org form (full canonical)
    if (grpResult.org_form_full) {
      form.setValue("leg_org_form", grpResult.org_form_full);
      filled.add("leg_org_form");
    }

    // Apply clean name (without form, without quotes)
    if (grpResult.clean_name) {
      form.setValue("leg_name", grpResult.clean_name);
      filled.add("leg_name");
    }

    // Apply parsed structured address from clean state (emptyAddress + parsed)
    if (grpResult.parsed_address) {
      const freshAddress: StructuredAddress = {
        ...emptyAddress(),
        ...grpResult.parsed_address,
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
    setGrpDialogOpen(false);
  }, [grpResult, form]);

  const handleIpSwitchConfirm = useCallback(() => {
    if (!pendingIpPayload || !onRequestSwitchToEntrepreneur) return;
    // Clear LE form state
    form.setValue("leg_org_form", "");
    form.setValue("leg_name", "");
    setAddress(emptyAddress());
    setAutofilledFields(new Set());
    // Hand off to page-level orchestration
    onRequestSwitchToEntrepreneur(pendingIpPayload);
    setIpSwitchDialogOpen(false);
    setPendingIpPayload(null);
  }, [pendingIpPayload, onRequestSwitchToEntrepreneur, form]);

  const handleIpSwitchCancel = useCallback(() => {
    setIpSwitchDialogOpen(false);
    setPendingIpPayload(null);
  }, []);

  const handleAddressChange = useCallback((val: StructuredAddress) => {
    setAddress(val);
    if (val.google_place_id) {
      setAddressSource('google');
    } else {
      setAddressSource('manual');
    }
  }, []);

  const handleSubmit = async (data: FormData) => {
    const orgForm = data.leg_org_form === OTHER_VALUE ? customFullForm : data.leg_org_form;
    const addressFields = LegalEntityAddressAdapter.toLegacyFields(address, addressSource);
    const sanitized: Record<string, unknown> = { ...data };
    for (const key of Object.keys(sanitized)) {
      if (/(_date|_until)$/.test(key) && sanitized[key] === "") sanitized[key] = null;
    }
    await onSubmit({
      ...(sanitized as Partial<FormData>),
      leg_org_form: orgForm,
      ...addressFields,
      client_type: "legal_entity",
    });
  };

  const getPlaceholder = (field: keyof typeof DEMO_LEGAL_ENTITY, fallback: string) => {
    return showDemoPlaceholders ? (DEMO_LEGAL_ENTITY[field] || fallback) : fallback;
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

        {/* Organization Info */}
        <div className="space-y-4">
          <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Данные организации</h3>
          
          {/* УНП FIRST */}
          <FormField
            control={form.control}
            name="leg_unp"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="flex items-center gap-2">
                  УНП
                  {isLookingUp && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
                </FormLabel>
                <FormControl>
                  <Input 
                    placeholder={getPlaceholder("leg_unp", "193405000")} 
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

          <div className="grid grid-cols-3 gap-4">
            <FormField
              control={form.control}
              name="leg_org_form"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="flex items-center gap-2">
                    Форма
                    {autofilledFields.has("leg_org_form") && (
                      <Badge variant="outline" className="text-[10px] font-normal">авто</Badge>
                    )}
                  </FormLabel>
                  <FormControl>
                    <OrgFormCombobox
                      value={field.value}
                      onChange={(val) => {
                        field.onChange(val);
                        setAutofilledFields(prev => { const n = new Set(prev); n.delete("leg_org_form"); return n; });
                      }}
                      customFullForm={customFullForm}
                      customShortForm={customShortForm}
                      onCustomFullFormChange={setCustomFullForm}
                      onCustomShortFormChange={setCustomShortForm}
                      disabled={isSubmitting}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="leg_name"
              render={({ field }) => (
                <FormItem className="col-span-2">
                  <FormLabel className="flex items-center gap-2">
                    Название
                    {autofilledFields.has("leg_name") && (
                      <Badge variant="outline" className="text-[10px] font-normal">авто</Badge>
                    )}
                  </FormLabel>
                  <FormControl>
                    <Input 
                      placeholder={getPlaceholder("leg_name", 'АЖУР инкам')} 
                      {...field} 
                      onChange={(e) => {
                        field.onChange(e);
                        setAutofilledFields(prev => { const n = new Set(prev); n.delete("leg_name"); return n; });
                      }}
                    />
                  </FormControl>
                  <FormDescription>Без формы и без кавычек</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

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

      <GrpConfirmDialog
        open={grpDialogOpen}
        onOpenChange={setGrpDialogOpen}
        diff={grpDiff}
        statusName={grpLookup.data?.data?.status_name}
        liquidationDate={grpLookup.data?.data?.liquidation_date}
        onConfirm={handleGrpConfirm}
      />

      {/* IP Switch Confirmation Dialog */}
      <AlertDialog open={ipSwitchDialogOpen} onOpenChange={setIpSwitchDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Найден индивидуальный предприниматель</AlertDialogTitle>
            <AlertDialogDescription>
              По введённому УНП в реестре найден ИП
              {pendingIpPayload?.clean_name ? ` «${pendingIpPayload.clean_name}»` : ''}.
              Переключить форму на ИП и применить данные?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleIpSwitchCancel}>Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={handleIpSwitchConfirm}>
              Переключить на ИП
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Form>
  );
}
