/**
 * OrganizationDetailsForm — unified form for both ЮЛ and ИП.
 *
 * Key behaviors:
 * - isEntrepreneur derived from org_form === 'Индивидуальный предприниматель'
 * - Director fields hidden for ИП
 * - Save path: entrepreneur → ent_* fields, legal_entity → leg_* fields
 * - Load path: reads from ent_* or leg_* based on initialData.client_type
 * - GRP lookup classifies entity_kind and sets form accordingly
 * - Address applied from emptyAddress() + parsed GRP, never mixed with old state
 */

import { useForm } from "react-hook-form";
import { useLegalDetailsFields } from "@/hooks/useLegalDetailsFields";
import { FieldLabelWithId } from "./FieldLabelWithId";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useState, useCallback, useEffect, useMemo } from "react";
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
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { StructuredAddressBlock } from "@/components/shared/StructuredAddressBlock";
import type { StructuredAddress } from "@/lib/address/types";
import { LegalEntityAddressAdapter } from "@/lib/address/adapters/LegalEntityAddressAdapter";
import { EntrepreneurAddressAdapter } from "@/lib/address/adapters/EntrepreneurAddressAdapter";
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

const OTHER_VALUE = '__OTHER__';
const IP_FORM = 'Индивидуальный предприниматель';

/** Normalize legacy short values to full canonical on read */
function normalizeOrgForm(val: string | null | undefined): string {
  if (!val) return "";
  if (ORG_FORM_FULL_TO_SHORT[val]) return val; // already full
  if (ORG_FORM_SHORT_TO_FULL[val]) return ORG_FORM_SHORT_TO_FULL[val];
  return val;
}

// Schema: director fields optional to support ИП mode
const schema = z.object({
  unp: z.string().length(9, "УНП должен содержать 9 цифр"),
  org_form: z.string().min(1, "Выберите организационную форму"),
  name: z.string().min(3, "Введите название"),
  director_position: z.string().optional(),
  director_name: z.string().optional(),
  acts_on_basis: z.string().optional(),
  bank_account: z.string().min(28, "IBAN формат BY...").max(28).or(z.literal("")),
  bank_name: z.string().min(3, "Укажите банк").or(z.literal("")),
  bank_code: z.string().min(6, "Укажите БИК").or(z.literal("")),
  phone: z.string().optional(),
  email: z.string().email("Некорректный email").optional().or(z.literal("")),
});

type FormData = z.infer<typeof schema>;

interface OrganizationDetailsFormProps {
  initialData?: ClientLegalDetails | null;
  onSubmit: (data: Partial<ClientLegalDetails>) => Promise<void>;
  isSubmitting: boolean;
  showDemoOnEmpty?: boolean;
}

export function OrganizationDetailsForm({
  initialData,
  onSubmit,
  isSubmitting,
  showDemoOnEmpty = true,
}: OrganizationDetailsFormProps) {
  // Determine if editing existing entrepreneur or legal_entity
  const isEditingEntrepreneur = initialData?.client_type === 'entrepreneur';
  const { fieldsMap } = useLegalDetailsFields();

  // Build address field IDs for StructuredAddressBlock CopyableIdChip
  const addressFieldIds = useMemo(() => {
    const prefix = isEditingEntrepreneur ? "ent_address_" : "leg_address_";
    const addressKeyMap: Record<string, string> = {
      street: `${prefix}street`,
      house: `${prefix}house`,
      building: `${prefix}building`,
      apartment: `${prefix}apartment`,
      city: `${prefix}city`,
      region: `${prefix}region`,
      postal_code: `${prefix}postal_code`,
      country_name: `${prefix}country`,
    };
    const map = new Map<string, import("@/hooks/useLegalDetailsFields").LegalDetailsFieldEntry>();
    for (const [addrKey, colKey] of Object.entries(addressKeyMap)) {
      const entry = fieldsMap.get(colKey);
      if (entry) map.set(addrKey, entry);
    }
    return map;
  }, [fieldsMap, isEditingEntrepreneur]);
  const hasRealData = isEditingEntrepreneur
    ? !!initialData?.ent_name
    : !!initialData?.leg_name;
  const showDemoPlaceholders = !hasRealData && showDemoOnEmpty;

  // Address state (outside react-hook-form)
  const [address, setAddress] = useState<StructuredAddress>(() => {
    if (isEditingEntrepreneur) {
      return EntrepreneurAddressAdapter.toStructuredAddress({
        ent_address: initialData?.ent_address,
        ent_address_structured: initialData?.ent_address_structured as any,
      });
    }
    return LegalEntityAddressAdapter.toStructuredAddress({
      leg_address: initialData?.leg_address,
      leg_address_structured: initialData?.leg_address_structured as any,
    });
  });
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
  const [autofilledFields, setAutofilledFields] = useState<Set<string>>(new Set());
  const [grpMeta, setGrpMeta] = useState<Record<string, string | null>>({});

  // Build default values from initialData, reading from correct namespace
  const getDefaultValues = (): FormData => {
    if (hasRealData) {
      if (isEditingEntrepreneur) {
        return {
          unp: initialData?.ent_unp || "",
          org_form: IP_FORM,
          name: initialData?.ent_name || "",
          director_position: "",
          director_name: "",
          acts_on_basis: initialData?.ent_acts_on_basis || "свидетельства о государственной регистрации",
          bank_account: initialData?.bank_account || "",
          bank_name: initialData?.bank_name || "",
          bank_code: initialData?.bank_code || "",
          phone: initialData?.phone || "",
          email: initialData?.email || "",
        };
      }
      return {
        unp: initialData?.leg_unp || "",
        org_form: normalizeOrgForm(initialData?.leg_org_form),
        name: initialData?.leg_name || "",
        director_position: initialData?.leg_director_position || "Директор",
        director_name: initialData?.leg_director_name || "",
        acts_on_basis: initialData?.leg_acts_on_basis || "Устава",
        bank_account: initialData?.bank_account || "",
        bank_name: initialData?.bank_name || "",
        bank_code: initialData?.bank_code || "",
        phone: initialData?.phone || "",
        email: initialData?.email || "",
      };
    }

    return {
      unp: "",
      org_form: "",
      name: "",
      director_position: "Директор",
      director_name: "",
      acts_on_basis: "Устава",
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

  // Watch org_form to determine ИП mode
  const orgFormValue = form.watch("org_form");
  const isEntrepreneur = orgFormValue === IP_FORM;

  // When org_form changes to ИП, update acts_on_basis default
  useEffect(() => {
    const currentBasis = form.getValues("acts_on_basis");
    if (isEntrepreneur && (!currentBasis || currentBasis === "Устава")) {
      form.setValue("acts_on_basis", "свидетельства о государственной регистрации");
    } else if (!isEntrepreneur && (!currentBasis || currentBasis === "свидетельства о государственной регистрации")) {
      form.setValue("acts_on_basis", "Устава");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEntrepreneur]);

  // Watch UNP for auto-lookup
  const unpValue = form.watch("unp");
  const initialUnp = isEditingEntrepreneur ? initialData?.ent_unp : initialData?.leg_unp;

  useEffect(() => {
    if (isValidUnp(unpValue) && unpValue !== initialUnp) {
      grpLookup.mutate(unpValue, {
        onSuccess: (result) => {
          if (result.found && result.data) {
            const autofill = grpDataToAutofillFields(result.data);
            const currentValues: Partial<Record<keyof GrpAutofillFields, string>> = {
              clean_name: form.getValues("name"),
              org_form_full: form.getValues("org_form"),
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

    const filled = new Set<string>();

    // Set org form based on entity_kind
    if (grpResult.entity_kind === 'entrepreneur') {
      form.setValue("org_form", IP_FORM);
      filled.add("org_form");
      // For ИП: use clean_name (without prefix)
      if (grpResult.clean_name) {
        form.setValue("name", grpResult.clean_name);
        filled.add("name");
      }
      // Auto-set acts_on_basis for ИП
      form.setValue("acts_on_basis", "свидетельства о государственной регистрации");
    } else {
      // Legal entity: set org form and clean name
      if (grpResult.org_form_full) {
        form.setValue("org_form", grpResult.org_form_full);
        filled.add("org_form");
      }
      if (grpResult.clean_name) {
        form.setValue("name", grpResult.clean_name);
        filled.add("name");
      }
    }

    // Apply parsed structured address from CLEAN state
    if (grpResult.parsed_address) {
      const freshAddress: StructuredAddress = {
        ...emptyAddress(),
        ...grpResult.parsed_address,
      };
      setAddress(freshAddress);
      setAddressSource('grp');
      filled.add("address");

      // Async enrichment via Google (validated match)
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

  const handleAddressChange = useCallback((val: StructuredAddress) => {
    setAddress(val);
    if (val.google_place_id) {
      setAddressSource('google');
    } else {
      setAddressSource('manual');
    }
  }, []);

  const handleSubmit = async (data: FormData) => {
    const orgForm = data.org_form === OTHER_VALUE ? customFullForm : data.org_form;
    const currentIsEntrepreneur = orgForm === IP_FORM;

    if (currentIsEntrepreneur) {
      // Save as entrepreneur using ent_* fields
      const addressFields = EntrepreneurAddressAdapter.toLegacyFields(address, addressSource);
      await onSubmit({
        client_type: "entrepreneur",
        ent_unp: data.unp,
        ent_name: data.name,
        ent_acts_on_basis: data.acts_on_basis || null,
        ...addressFields,
        // Common fields
        bank_account: data.bank_account || null,
        bank_name: data.bank_name || null,
        bank_code: data.bank_code || null,
        phone: data.phone || null,
        email: data.email || null,
        // Clear leg_* fields to avoid stale data on reopen
        leg_org_form: null,
        leg_name: null,
        leg_unp: null,
        leg_director_position: null,
        leg_director_name: null,
        leg_acts_on_basis: null,
        leg_address: null,
        leg_address_structured: null,
      });
    } else {
      // Save as legal_entity using leg_* fields
      const addressFields = LegalEntityAddressAdapter.toLegacyFields(address, addressSource);
      await onSubmit({
        client_type: "legal_entity",
        leg_org_form: orgForm,
        leg_name: data.name,
        leg_unp: data.unp,
        leg_director_position: data.director_position || null,
        leg_director_name: data.director_name || null,
        leg_acts_on_basis: data.acts_on_basis || null,
        ...addressFields,
        // Common fields
        bank_account: data.bank_account || null,
        bank_name: data.bank_name || null,
        bank_code: data.bank_code || null,
        phone: data.phone || null,
        email: data.email || null,
        // Clear ent_* fields to avoid stale data on reopen
        ent_unp: null,
        ent_name: null,
        ent_acts_on_basis: null,
        ent_address: null,
        ent_address_structured: null,
      });
    }
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
          <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
            {isEntrepreneur ? 'Данные ИП' : 'Данные организации'}
          </h3>
          
          {/* УНП FIRST */}
          <FormField
            control={form.control}
            name="unp"
            render={({ field }) => (
              <FormItem>
                <FormLabel
                  className={cn(
                    "flex items-center gap-2",
                    fieldsMap.get(isEntrepreneur ? "ent_unp" : "leg_unp")?.publicId && "cursor-pointer hover:text-primary transition-colors"
                  )}
                  onClick={fieldsMap.get(isEntrepreneur ? "ent_unp" : "leg_unp")?.publicId
                    ? (e: React.MouseEvent) => {
                        e.preventDefault();
                        navigator.clipboard.writeText(fieldsMap.get(isEntrepreneur ? "ent_unp" : "leg_unp")!.publicId);
                        toast.success("ID скопирован");
                      }
                    : undefined
                  }
                  title={fieldsMap.get(isEntrepreneur ? "ent_unp" : "leg_unp")?.publicId
                    ? `${fieldsMap.get(isEntrepreneur ? "ent_unp" : "leg_unp")!.publicId} — клик для копирования`
                    : undefined
                  }
                >
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
              name="org_form"
              render={({ field }) => (
                <FormItem>
                  <FieldLabelWithId
                    label="Форма"
                    fieldEntry={fieldsMap.get(isEntrepreneur ? "ent_name" : "leg_org_form")}
                  >
                    {autofilledFields.has("org_form") && (
                      <Badge variant="outline" className="text-[10px] font-normal">авто</Badge>
                    )}
                  </FieldLabelWithId>
                  <FormControl>
                    <OrgFormCombobox
                      value={field.value}
                      onChange={(val) => {
                        field.onChange(val);
                        setAutofilledFields(prev => { const n = new Set(prev); n.delete("org_form"); return n; });
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
              name="name"
              render={({ field }) => (
                <FormItem className="col-span-2">
                  <FieldLabelWithId
                    label={isEntrepreneur ? 'ФИО' : 'Название'}
                    fieldEntry={fieldsMap.get(isEntrepreneur ? "ent_name" : "leg_name")}
                  >
                    {autofilledFields.has("name") && (
                      <Badge variant="outline" className="text-[10px] font-normal">авто</Badge>
                    )}
                  </FieldLabelWithId>
                  <FormControl>
                    <Input 
                      placeholder={isEntrepreneur ? "Горбова Екатерина Сергеевна" : getPlaceholder("leg_name", 'АЖУР инкам')} 
                      {...field} 
                      onChange={(e) => {
                        field.onChange(e);
                        setAutofilledFields(prev => { const n = new Set(prev); n.delete("name"); return n; });
                      }}
                    />
                  </FormControl>
                  <FormDescription>
                    {isEntrepreneur ? 'Полное ФИО без префикса «ИП»' : 'Без формы и без кавычек'}
                  </FormDescription>
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
              fieldIds={addressFieldIds}
            />
          </div>
        </div>

        <Separator />

        {/* Director Info — hidden for ИП */}
        {!isEntrepreneur && (
          <>
            <div className="space-y-4">
              <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Руководитель</h3>
              
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="director_position"
                  render={({ field }) => (
                    <FormItem>
                      <FieldLabelWithId label="Должность" fieldEntry={fieldsMap.get("leg_director_position")} />
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
                  name="director_name"
                  render={({ field }) => (
                    <FormItem>
                      <FieldLabelWithId label="ФИО" fieldEntry={fieldsMap.get("leg_director_name")} />
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
            </div>

            <Separator />
          </>
        )}

        {/* Acts on basis */}
        <div className="space-y-4">
          <FormField
            control={form.control}
            name="acts_on_basis"
            render={({ field }) => (
              <FormItem>
                <FieldLabelWithId label="Действует на основании" fieldEntry={fieldsMap.get(isEntrepreneur ? "ent_acts_on_basis" : "leg_acts_on_basis")} />
                <FormControl>
                  <Input 
                    placeholder={isEntrepreneur 
                      ? "свидетельства о государственной регистрации" 
                      : getPlaceholder("leg_acts_on_basis", "Устава")
                    } 
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
                <FieldLabelWithId label="Расчётный счёт (IBAN)" fieldEntry={fieldsMap.get("bank_account")} />
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
                  <FieldLabelWithId label="Банк" fieldEntry={fieldsMap.get("bank_name")} />
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
                  <FieldLabelWithId label="БИК/Код" fieldEntry={fieldsMap.get("bank_code")} />
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
                  <FieldLabelWithId label="Телефон" fieldEntry={fieldsMap.get("phone")} />
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
                  <FieldLabelWithId label="Email" fieldEntry={fieldsMap.get("email")} />
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
    </Form>
  );
}
