/**
 * PlaceholdersCatalogTab — Sprint 11 C5-E.
 *
 * Каталог FLD-плейсхолдеров для копирования в Microsoft Word.
 * Inline-настройки формата/падежа прямо в строке таблицы.
 *
 * SOT: fields_registry.public_id (FLD-XXXXXX).
 * Формат placeholder строго whitelisted:
 *   {{field:FLD-XXXXXX}}
 *   {{field:FLD-XXXXXX|format=words}}
 *   {{field:FLD-XXXXXX|format=text}}
 *   {{field:FLD-XXXXXX|case=<падеж>}}
 *   {{field:FLD-XXXXXX|format=words|case=<падеж>}}
 */
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { Loader2, Copy, Search, Info, RotateCcw, HelpCircle } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  buildFieldPlaceholder,
  type FieldCase,
  type FieldFormat,
} from "./extensions/FieldChipNode";
import { classifyDataType } from "./FieldFormatPicker";
import { copyToClipboard } from "@/utils/clipboardUtils";
import {
  formatPersonName,
  DEMO_PERSON_NAME,
  type PersonNameFormat,
  type PersonNameCase,
} from "@/utils/personNameFormat";
import {
  PACKAGE_GROUP_META,
  PACKAGE_PLACEHOLDER_CATALOG,
  buildPackageRoleItems,
  buildPackagePlaceholderToken,
  classifyPackageItem,
  supportsLongFormat as packageSupportsLongFormat,
  type PackageGroupId,
  type PackagePlaceholderItem,
  type PackagePlaceholderStatus,
  type PackageRoleCatalogRow,
} from "@/utils/packagePlaceholderCatalog";

interface CatalogRow {
  id: string;
  token_key: string;            // legacy, только для поиска
  ui_label: string;
  description: string | null;
  category: string;
  source_type: string | null;
  field_id: string | null;
  resolver_key: string | null;
  data_type: string | null;
  is_required: boolean | null;
  display_order: number | null;
  example_value: string | null;
  field_public_id: string | null;
  field_label: string | null;
  field_data_type: string | null;
}

interface RowSettings {
  format: FieldFormat | null;
  caseModifier: FieldCase | null;
  includePosition?: boolean;
  /** Sprint 3N: разделитель между ФИО при множестве участников у роли (только ln-токены). */
  joinMode?: 'semicolon' | 'comma' | 'newline' | null;
}

/**
 * Маппинг category → пользовательский ярлык группы (короткий — для бейджа в строке).
 */
const GROUP_LABELS: Record<string, string> = {
  contact: "Контакт",
  customer: "Заказчик (универс.)",
  "customer.individual": "Заказчик ФЛ",
  "customer.legal": "Заказчик ЮЛ",
  "customer.entrepreneur": "Заказчик ИП",
  "customer.signer": "Подписант (override)",
  executor: "Исполнитель (универс.)",
  "executor.individual": "Исполнитель ФЛ",
  "executor.legal": "Исполнитель ЮЛ",
  "executor.entrepreneur": "Исполнитель ИП",
  "executor.signer": "Подписант (override)",
  deal: "Сделка",
  product: "Продукт",
  tariff: "Тариф",
  offer: "Кнопка оплаты",
  document: "Документ",
  payment: "Оплата",
  system: "Системные",
  legal_details: "Custom-поля",
};

/**
 * B-97 postponed-токены: 51 шт. без SOT в модели исполнителя.
 * Они НЕ должны выглядеть как рабочие FLD-плейсхолдеры:
 *   - копирование запрещено;
 *   - выносятся в отдельную секцию «Нет источника данных»;
 *   - получают пояснение, почему сейчас не работают.
 */
const POSTPONED_NO_SOT_SECTION_ID = "postponed_no_sot";
function isPostponedNoSot(category: string | null | undefined, tokenKey: string): boolean {
  if (tokenKey === "executor.leg.org_form") return true;
  if (category === "executor.individual") return true;
  if (category === "executor.entrepreneur") return true;
  return false;
}

/**
 * Секции каталога (B-97 — после backfill FLD-ID для 97 typed-токенов).
 * Постponed-токены (executor.ind/ent.* + executor.leg.org_form) вынесены
 * в отдельную нижнюю секцию «Нет источника данных» и не предлагаются как
 * рабочие плейсхолдеры. Порядок здесь = порядок отображения в UI.
 */
const SECTION_DEFINITIONS: Array<{ id: string; label: string; categories: string[] }> = [
  { id: "customer_ind", label: "1. Заказчик ФЛ", categories: ["customer.individual"] },
  { id: "customer_leg", label: "2. Заказчик ЮЛ", categories: ["customer.legal"] },
  { id: "customer_ent", label: "3. Заказчик ИП", categories: ["customer.entrepreneur"] },
  { id: "executor_leg", label: "4. Исполнитель ЮЛ", categories: ["executor.legal"] },
  { id: "dynamic", label: "5. Универсальные поля (по типу плательщика)", categories: ["customer", "executor"] },
  { id: "document", label: "6. Документ", categories: ["document"] },
  { id: "deal", label: "7. Сделка", categories: ["deal"] },
  { id: "payment", label: "8. Оплата", categories: ["payment"] },
  { id: "system", label: "9. Системные поля", categories: ["system"] },
  {
    id: "technical",
    label: "10. Технические / override",
    categories: ["customer.signer", "executor.signer", "contact", "product", "tariff", "offer", "legal_details"],
  },
  {
    id: POSTPONED_NO_SOT_SECTION_ID,
    label: "11. Нет источника данных (postponed)",
    // categories здесь не используются — постponed-набор определяется isPostponedNoSot().
    categories: ["__postponed__"],
  },
];

const CATEGORY_TO_SECTION: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  for (const s of SECTION_DEFINITIONS) {
    if (s.id === POSTPONED_NO_SOT_SECTION_ID) continue;
    for (const c of s.categories) m[c] = s.id;
  }
  return m;
})();

const SECTION_LABEL: Record<string, string> = Object.fromEntries(
  SECTION_DEFINITIONS.map((s) => [s.id, s.label]),
);

/**
 * UX-копирайт секций каталога: подзаголовок (hint) и развёрнутая
 * подсказка (helpTitle + helpBullets) для иконки «?». Разделён со
 * структурой SECTION_DEFINITIONS, чтобы тексты можно было править,
 * не трогая логику группировки.
 */
const SECTION_COPY: Record<
  string,
  { hint: string; helpTitle?: string; helpBullets?: string[] }
> = {
  customer_ind: {
    hint: "Реквизиты клиента-физлица. Строго типизированная группа — подставляется только если плательщик ФЛ.",
    helpTitle: "Заказчик — физическое лицо",
    helpBullets: [
      "Источник данных: Кабинет клиента → Настройки → Реквизиты, вкладка «Физлицо».",
      "Используйте эти поля только в шаблонах, рассчитанных строго на ФЛ.",
      "Для универсальных шаблонов, работающих с любым типом плательщика, берите поля из секции 7.",
    ],
  },
  customer_leg: {
    hint: "Реквизиты клиента-юрлица. Строго типизированная группа — подставляется только если плательщик ЮЛ.",
    helpTitle: "Заказчик — юридическое лицо",
    helpBullets: [
      "Источник данных: Кабинет клиента → Настройки → Реквизиты, вкладка «Юрлицо».",
      "Используйте эти поля только в шаблонах, рассчитанных строго на ЮЛ.",
      "Для универсальных шаблонов берите поля из секции 7.",
    ],
  },
  customer_ent: {
    hint: "Реквизиты клиента-ИП. Строго типизированная группа — подставляется только если плательщик ИП.",
    helpTitle: "Заказчик — индивидуальный предприниматель",
    helpBullets: [
      "Источник данных: Кабинет клиента → Настройки → Реквизиты, вкладка «ИП».",
      "Используйте эти поля только в шаблонах, рассчитанных строго на ИП.",
      "Для универсальных шаблонов берите поля из секции 7.",
    ],
  },
  executor_leg: {
    hint: "Реквизиты вашей организации (ЮЛ). Только для шаблонов, где исполнитель строго юрлицо.",
    helpTitle: "Исполнитель — юридическое лицо",
    helpBullets: [
      "Источник данных: Админка → Реквизиты исполнителя, профиль ЮЛ.",
      "Не используйте в универсальных шаблонах — для них есть секция «Универсальные поля».",
    ],
  },
  dynamic: {
    hint: "Полиморфные поля: один токен в шаблоне сам подставляет данные ФЛ / ЮЛ / ИП по типу плательщика сделки.",
    helpTitle: "Универсальные поля (по типу плательщика)",
    helpBullets: [
      "Один и тот же токен в DOCX автоматически подставляет данные нужного типа субъекта — ФЛ, ЮЛ или ИП — в зависимости от участников сделки. Не нужно делать три отдельных шаблона.",
      "Где заполняются данные: для заказчика — Кабинет клиента → Настройки → Реквизиты (активная вкладка ФЛ / ЮЛ / ИП); для исполнителя — Админка → Реквизиты.",
      "Когда использовать: универсальные поля — для шаблонов, работающих с любым типом плательщика (рекомендуемый путь). Типизированные поля из секций «Заказчик …» / «Исполнитель …» — только если шаблон строго под один тип субъекта.",
      "Тип плательщика определяется по данным сделки и выбранному сценарию документа.",
    ],
  },
  document: {
    hint: "Атрибуты самого документа: номер, дата, тип, ссылка.",
  },
  deal: {
    hint: "Данные сделки: продукт, тариф, суммы, статус, даты.",
  },
  payment: {
    hint: "Платёж по сделке: канал, сумма, статус, дата зачисления.",
  },
  system: {
    hint: "Дата, время и другие значения, которые заполняются автоматически.",
  },
  technical: {
    hint: "Дополнительные поля для редких шаблонов. В типовых документах используйте основные группы выше.",
    helpTitle: "Дополнительные поля",
    helpBullets: [
      "Эти поля не имеют стандартного места для заполнения в интерфейсе и проставляются вручную в карточке сделки или приходят из legacy-источников.",
      "Никогда не используйте их в типовых шаблонах вместо типизированных или универсальных секций — это приведёт к пустым значениям в документе.",
      "Если для какого-то поля нужен регулярный UI-источник — заведите задачу, а не используйте override постоянно.",
    ],
  },
  [POSTPONED_NO_SOT_SECTION_ID]: {
    hint: "Поля без источника данных в модели исполнителя — пока не являются рабочими FLD-плейсхолдерами и не должны использоваться в шаблонах.",
    helpTitle: "Нет источника данных (postponed)",
    helpBullets: [
      "Сюда попали типизированные токены исполнителя ФЛ / ИП и `executor.leg.org_form` — для них в модели данных `executors` пока нет соответствующих колонок.",
      "Эти поля не получили FLD-ID в рамках B-97 намеренно — каждый FLD в реестре обязан резолвиться. Создание «мёртвых» FLD запрещено.",
      "Будут активированы в отдельном спринте «Расширение модели исполнителя» (ALTER `executors` + UI заполнения).",
      "Сейчас не используйте их в DOCX-шаблонах: подстановка вернёт пустую строку.",
    ],
  },
};

const DATA_TYPE_LABEL: Record<string, string> = {
  text: "Текст", string: "Текст", number: "Число", currency: "Сумма",
  money: "Сумма", date: "Дата", datetime: "Дата/время", boolean: "Да/Нет",
  uuid: "UUID", email: "Email", phone: "Телефон", enum: "Список", json: "JSON",
};

const CASE_OPTIONS: { value: "none" | FieldCase; label: string }[] = [
  { value: "none", label: "— без падежа" },
  { value: "nominative", label: "И — кто? что?" },
  { value: "genitive", label: "Р — кого? чего?" },
  { value: "dative", label: "Д — кому? чему?" },
  { value: "accusative", label: "В — кого? что?" },
  { value: "instrumental", label: "Т — кем? чем?" },
  { value: "prepositional", label: "П — о ком? о чём?" },
];

function isDefault(s: RowSettings | undefined): boolean {
  if (!s) return true;
  const joinDefault = !s.joinMode || s.joinMode === "semicolon";
  return s.format === null && s.caseModifier === null && !s.includePosition && joinDefault;
}

const DEMO_ROLE_POSITION = "юрисконсульт";

function formatDemoRolePosition(caseModifier: FieldCase | null): string {
  if (caseModifier === "genitive" || caseModifier === "accusative") return "юрисконсульта";
  if (caseModifier === "dative") return "юрисконсульту";
  if (caseModifier === "instrumental") return "юрисконсультом";
  if (caseModifier === "prepositional") return "юрисконсульте";
  return DEMO_ROLE_POSITION;
}

export function PlaceholdersCatalogTab() {
  const [rows, setRows] = useState<CatalogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [groupFilter, setGroupFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [onlyRequired, setOnlyRequired] = useState(false);
  const [rowSettings, setRowSettings] = useState<Map<string, RowSettings>>(new Map());
  // Sprint 3J-UI: те же modifier-controls, что у billing-плейсхолдеров. Ключ — tech_key item'а.
  const [pkgRowSettings, setPkgRowSettings] = useState<Map<string, RowSettings>>(new Map());
  const [packageRoleRows, setPackageRoleRows] = useState<PackageRoleCatalogRow[]>([]);

  // Sprint 3F §D: загрузка ролей пакетов (с учётом custom) из document_package_role_catalog
  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data, error } = await supabase
        .from("document_package_role_catalog")
        .select(`
          public_id, role_key, label, description, is_system, is_active,
          package_template_id, output_template, sort_order,
          package:document_package_templates!document_package_role_catalog_package_template_id_fkey(name)
        `)
        .eq("is_active", true)
        .order("sort_order", { ascending: true });
      if (!mounted) return;
      if (error) {
        console.warn("[catalog] failed to load package roles", error);
        return;
      }
      const mapped: PackageRoleCatalogRow[] = (data ?? []).map((r: any) => ({
        public_id: r.public_id,
        role_key: r.role_key,
        label: r.label,
        description: r.description,
        is_system: !!r.is_system,
        is_active: !!r.is_active,
        package_template_id: r.package_template_id,
        package_template_name: r.package?.name ?? "—",
        output_template: r.output_template ?? null,
        sort_order: r.sort_order ?? 0,
      }));
      setPackageRoleRows(mapped);
    })();
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("document_token_registry")
        .select(`
          id, token_key, ui_label, description, category, source_type,
          field_id, resolver_key, data_type, is_required, display_order, example_value,
          field:fields_registry!document_token_registry_field_id_fkey(
            public_id, label, data_type
          )
        `)
        .is("archived_at", null)
        .order("display_order", { ascending: true });
      if (!mounted) return;
      if (error) {
        toast.error("Не удалось загрузить каталог плейсхолдеров");
        setLoading(false);
        return;
      }
      const all = (data ?? []) as any[];
      const mapped: CatalogRow[] = [];
      for (const r of all) {
        const publicId = r.field?.public_id ?? null;
        mapped.push({
          ...r,
          field_public_id: publicId,
          field_label: r.field?.label ?? null,
          field_data_type: r.field?.data_type ?? null,
        });
      }
      setRows(mapped);
      setLoading(false);
    })();
    return () => { mounted = false; };
  }, []);

  // Группа = одна из 9 секций + 3 пакетные. «Все группы» = все секции по порядку.
  const groupOptions = [
    ...SECTION_DEFINITIONS.map((s) => ({ id: s.id, label: s.label })),
    ...PACKAGE_GROUP_META.map((g) => ({ id: g.id, label: g.label_ru })),
  ];

  const typeOptions = useMemo(() => {
    const set = new Set(rows.map(r => r.data_type).filter(Boolean) as string[]);
    return Array.from(set);
  }, [rows]);

  // Postponed B-97 имеет приоритет над category — постponed-токены всегда
  // попадают в нижнюю секцию «Нет источника данных», даже если их category
  // совпадает с обычной (executor.individual / executor.entrepreneur / executor.legal).
  const sectionIdForRow = (r: CatalogRow): string => {
    if (isPostponedNoSot(r.category, r.token_key)) return POSTPONED_NO_SOT_SECTION_ID;
    return CATEGORY_TO_SECTION[r.category ?? "system"] ?? "system";
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(r => {
      const sectionId = sectionIdForRow(r);
      if (groupFilter !== "all" && sectionId !== groupFilter) return false;
      if (typeFilter !== "all" && r.data_type !== typeFilter) return false;
      if (onlyRequired && !r.is_required) return false;
      if (q && !(
        (r.field_public_id ?? "").toLowerCase().includes(q) ||
        r.token_key.toLowerCase().includes(q) ||
        (r.ui_label ?? "").toLowerCase().includes(q) ||
        (r.description ?? "").toLowerCase().includes(q) ||
        (r.field_label ?? "").toLowerCase().includes(q) ||
        (r.example_value ?? "").toLowerCase().includes(q) ||
        (SECTION_LABEL[sectionId] ?? "").toLowerCase().includes(q) ||
        (r.category ?? "").toLowerCase().includes(q)
      )) return false;
      return true;
    });
  }, [rows, search, groupFilter, typeFilter, onlyRequired]);

  // Группировка отфильтрованных строк по секциям с сохранением порядка.
  const grouped = useMemo(() => {
    const map = new Map<string, CatalogRow[]>();
    for (const s of SECTION_DEFINITIONS) map.set(s.id, []);
    for (const r of filtered) {
      const sid = sectionIdForRow(r);
      map.get(sid)!.push(r);
    }
    return SECTION_DEFINITIONS
      .map((s) => ({ id: s.id, label: s.label, rows: map.get(s.id) ?? [] }))
      .filter((s) => s.rows.length > 0);
  }, [filtered]);

  // Sprint 3D — пакетные группы (UL/IP/FL), статический каталог.
  // Фильтруются тем же search/groupFilter; не зависят от typeFilter/onlyRequired.
  const packageSections = useMemo(() => {
    const q = search.trim().toLowerCase();
    const groups: Array<{
      id: PackageGroupId;
      label: string;
      hint: string;
      source_summary: string;
      items: PackagePlaceholderItem[];
    }> = [];
    for (const meta of PACKAGE_GROUP_META) {
      if (groupFilter !== "all" && groupFilter !== meta.id) continue;
      // Sprint 3F: «Пакет: Роли» строится из БД (включая custom-роли).
      const baseItems: PackagePlaceholderItem[] =
        meta.id === "package_roles"
          ? buildPackageRoleItems(packageRoleRows)
          : PACKAGE_PLACEHOLDER_CATALOG.filter((i) => i.groupId === meta.id);
      const items = baseItems.filter((i) => {
        if (!q) return true;
        return (
          i.label_ru.toLowerCase().includes(q) ||
          i.tech_key.toLowerCase().includes(q) ||
          (i.reused_fld ?? "").toLowerCase().includes(q) ||
          (i.billing_fld_analog ?? "").toLowerCase().includes(q) ||
          (i.package_token ?? "").toLowerCase().includes(q) ||
          meta.label_ru.toLowerCase().includes(q)
        );
      });
      if (items.length === 0) continue;
      groups.push({
        id: meta.id,
        label: meta.label_ru,
        hint: meta.hint,
        source_summary: meta.source_summary,
        items,
      });
    }
    return groups;
  }, [search, groupFilter, packageRoleRows]);

  const packageItemsCount = packageSections.reduce((a, s) => a + s.items.length, 0);

  const updateRowSettings = (id: string, patch: Partial<RowSettings>) => {
    setRowSettings(prev => {
      const next = new Map(prev);
      const current = next.get(id) ?? { format: null, caseModifier: null };
      const merged: RowSettings = { ...current, ...patch };
      if (isDefault(merged)) {
        next.delete(id);
      } else {
        next.set(id, merged);
      }
      return next;
    });
  };

  const resetRow = (id: string) => {
    setRowSettings(prev => {
      if (!prev.has(id)) return prev;
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  };

  const updatePkgSettings = (techKey: string, patch: Partial<RowSettings>) => {
    setPkgRowSettings(prev => {
      const next = new Map(prev);
      const current = next.get(techKey) ?? { format: null, caseModifier: null };
      const merged: RowSettings = { ...current, ...patch };
      if (isDefault(merged)) next.delete(techKey);
      else next.set(techKey, merged);
      return next;
    });
  };
  const resetPkgRow = (techKey: string) => {
    setPkgRowSettings(prev => {
      if (!prev.has(techKey)) return prev;
      const next = new Map(prev);
      next.delete(techKey);
      return next;
    });
  };

  const copyPlaceholder = async (text: string) => {
    await copyToClipboard(text, "Плейсхолдер скопирован");
  };

  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-4">
        {/* Инструктивный баннер */}
        <div className="flex gap-3 rounded-lg border border-blue-200 bg-blue-50/60 dark:bg-blue-950/30 dark:border-blue-900 p-3">
          <Info className="h-4 w-4 text-blue-600 mt-0.5 flex-shrink-0" />
          <div className="text-xs text-blue-900 dark:text-blue-100 leading-relaxed">
            Каждая секция соответствует отдельному источнику данных. Универсальные поля
            автоматически выбирают реквизиты по типу плательщика сделки (ФЛ/ЮЛ/ИП), поэтому
            один шаблон может работать для разных типов клиентов.
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
          <div>
            <h2 className="text-lg font-semibold">Плейсхолдеры для Word</h2>
            <p className="text-sm text-muted-foreground">
              Формат:&nbsp;
              <code className="text-foreground">{`{{field:FLD-XXXXXX}}`}</code>.
              Всего: <span className="font-medium text-foreground">{rows.length}</span>,
              показано: <span className="font-medium text-foreground">{filtered.length}</span>.
              {packageItemsCount > 0 && (
                <span className="ml-2 inline-flex items-center gap-1 text-muted-foreground">
                  <Info className="h-3.5 w-3.5" /> пакетные (UL/IP/FL): {packageItemsCount}
                </span>
              )}
            </p>
          </div>
          <div />
        </div>

        <div className="grid gap-2 sm:grid-cols-12 min-w-0 max-w-full">
          <div className="relative sm:col-span-5">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск по названию, FLD-ID, категории…"
              className="pl-9"
            />
          </div>
          <div className="sm:col-span-3">
            <Select value={groupFilter} onValueChange={setGroupFilter}>
              <SelectTrigger><SelectValue placeholder="Группа" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все группы</SelectItem>
                {groupOptions.map(g => (
                  <SelectItem key={g.id} value={g.id}>{g.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="sm:col-span-3">
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger><SelectValue placeholder="Тип" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все типы</SelectItem>
                {typeOptions.map(t => (
                  <SelectItem key={t} value={t}>{DATA_TYPE_LABEL[t] ?? t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="sm:col-span-1 flex items-center justify-end gap-2">
            <Switch id="req-toggle" checked={onlyRequired} onCheckedChange={setOnlyRequired} />
            <Label htmlFor="req-toggle" className="text-xs text-muted-foreground whitespace-nowrap">обяз.</Label>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="border rounded-lg overflow-hidden max-w-full">
            <div className="max-h-[70vh] overflow-auto">
              <Table className="min-w-[1100px]">
                <TableHeader className="sticky top-0 bg-background z-10 shadow-[0_1px_0_0_hsl(var(--border))]">
                  <TableRow>
                    <TableHead className="w-[120px]">Группа</TableHead>
                    <TableHead className="min-w-[180px]">Название</TableHead>
                    <TableHead className="w-[110px]">FLD-ID</TableHead>
                    <TableHead className="w-[90px]">Тип</TableHead>
                    <TableHead className="w-[260px]">Настройки</TableHead>
                    <TableHead className="min-w-[180px]">Пример</TableHead>
                    <TableHead className="min-w-[240px]">Плейсхолдер</TableHead>
                    <TableHead className="w-[90px] text-right">Действия</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.length === 0 && packageItemsCount === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-8">
                        Ничего не найдено
                      </TableCell>
                    </TableRow>
                  ) : (
                    grouped.flatMap((section) => [
                      (() => {
                        const copy = SECTION_COPY[section.id];
                        return (
                          <TableRow key={`section-${section.id}`} className="bg-muted/60 hover:bg-muted/60 sticky">
                            <TableCell colSpan={8} className="py-2">
                              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                <span>{section.label}</span>
                                <span className="text-[10px] font-normal lowercase text-muted-foreground/70">
                                  ({section.rows.length})
                                </span>
                                {copy?.helpBullets && copy.helpBullets.length > 0 && (
                                  <Popover>
                                    <PopoverTrigger asChild>
                                      <Button
                                        size="icon"
                                        variant="ghost"
                                        className="h-5 w-5 text-muted-foreground hover:text-foreground"
                                        aria-label="Подробнее о секции"
                                      >
                                        <HelpCircle className="h-3.5 w-3.5" />
                                      </Button>
                                    </PopoverTrigger>
                                    <PopoverContent side="bottom" align="start" className="max-w-md text-xs leading-relaxed">
                                      {copy.helpTitle && (
                                        <div className="font-semibold text-sm text-foreground mb-1.5 normal-case">
                                          {copy.helpTitle}
                                        </div>
                                      )}
                                      <ul className="space-y-1.5 list-disc pl-4 text-foreground/90 normal-case font-normal tracking-normal">
                                        {copy.helpBullets.map((b, i) => (
                                          <li key={i}>{b}</li>
                                        ))}
                                      </ul>
                                    </PopoverContent>
                                  </Popover>
                                )}
                              </div>
                              {copy?.hint && (
                                <div className="mt-1 text-[11px] font-normal normal-case tracking-normal text-muted-foreground/80">
                                  {copy.hint}
                                </div>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })(),
                      ...section.rows.map(t => {
                      const settings = rowSettings.get(t.id) ?? { format: null, caseModifier: null };
                      const dirty = !isDefault(rowSettings.get(t.id));
                      const isPostponed = isPostponedNoSot(t.category, t.token_key);
                      const isRuntime = !t.field_public_id && !isPostponed;
                      const placeholder = isPostponed
                        ? ""
                        : (isRuntime
                          ? `{{${t.token_key}}}`
                          : buildFieldPlaceholder(
                              t.field_public_id!,
                              settings.format,
                              settings.caseModifier,
                            ));
                      const kind = classifyDataType(t.field_data_type ?? t.data_type);

                      return (
                          <TableRow key={t.id} className={cn("hover:bg-muted/40 align-top", isPostponed && "opacity-70")}>
                            <TableCell className="py-2">
                              <Badge variant="outline" className="text-[10px] font-normal">
                                {GROUP_LABELS[t.category?.toLowerCase()] ?? GROUP_LABELS[t.category] ?? t.category}
                              </Badge>
                            </TableCell>
                            <TableCell className="font-medium text-sm py-2">
                              {t.ui_label}
                              {t.field_label && t.field_label !== t.ui_label && (
                                <span className="block text-[10px] text-muted-foreground">{t.field_label}</span>
                              )}
                            </TableCell>
                            <TableCell className="py-2">
                              {isPostponed ? (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Badge variant="outline" className="text-[10px] cursor-help border-dashed text-muted-foreground">
                                      нет источника
                                    </Badge>
                                  </TooltipTrigger>
                                  <TooltipContent className="max-w-xs">
                                    Поле не имеет источника данных в модели исполнителя, поэтому пока не является рабочим FLD-плейсхолдером.
                                    <code className="block mt-1">{t.token_key}</code>
                                  </TooltipContent>
                                </Tooltip>
                              ) : isRuntime ? (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Badge variant="outline" className="font-mono text-[10px] cursor-help">
                                      авто
                                    </Badge>
                                  </TooltipTrigger>
                                  <TooltipContent className="max-w-xs">
                                    Значение подставляется автоматически при формировании документа.
                                  </TooltipContent>
                                </Tooltip>
                              ) : (
                                <Badge variant="secondary" className="font-mono text-[10px]">
                                  {t.field_public_id}
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground py-2">
                              {(() => {
                                const dt = t.field_data_type ?? t.data_type;
                                return dt ? (DATA_TYPE_LABEL[dt] ?? dt) : "—";
                              })()}
                            </TableCell>
                            <TableCell className="py-2">
                              {isPostponed ? (
                                <span className="text-[10px] text-muted-foreground italic">недоступно — нет SOT</span>
                              ) : isRuntime ? (
                                <span className="text-[10px] text-muted-foreground italic">Без модификаторов</span>
                              ) : (
                                <RowSettingsCell
                                  kind={kind}
                                  settings={settings}
                                  onChange={(patch) => updateRowSettings(t.id, patch)}
                                />
                              )}
                            </TableCell>
                            <TableCell className="py-2 text-xs text-foreground/80">
                              {t.example_value
                                ? <span className="italic">{t.example_value}</span>
                                : <span className="text-muted-foreground/60 italic">— нет примера —</span>}
                            </TableCell>
                            <TableCell className="py-2">
                              {isPostponed ? (
                                <span className="text-[11px] text-muted-foreground/60 italic">— не используйте в шаблонах —</span>
                              ) : (
                                <code className="text-[11px] text-foreground/90 break-all font-mono">
                                  {placeholder}
                                </code>
                              )}
                            </TableCell>
                            <TableCell className="text-right py-2">
                              <div className="flex justify-end gap-0.5">
                                {!isPostponed && dirty && (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button
                                        size="icon" variant="ghost" className="h-7 w-7"
                                        onClick={() => resetRow(t.id)}
                                      >
                                        <RotateCcw className="h-3.5 w-3.5" />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>Сбросить настройки</TooltipContent>
                                  </Tooltip>
                                )}
                                {!isPostponed && (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button
                                        size="icon" variant="ghost" className="h-7 w-7"
                                        onClick={() => copyPlaceholder(placeholder)}
                                      >
                                        <Copy className="h-3.5 w-3.5" />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>Копировать плейсхолдер</TooltipContent>
                                  </Tooltip>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                      );
                      }),
                    ])
                  )}
                  {packageSections.flatMap((section) => [
                    <TableRow key={`pkg-sec-${section.id}`} className="bg-muted/60 hover:bg-muted/60">
                      <TableCell colSpan={8} className="py-2">
                        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          <span>{section.label}</span>
                          <span className="text-[10px] font-normal lowercase text-muted-foreground/70">
                            ({section.items.length})
                          </span>
                        </div>
                        <div className="mt-1 text-[11px] font-normal normal-case tracking-normal text-muted-foreground/80">
                          {section.hint}
                        </div>
                      </TableCell>
                    </TableRow>,
                    ...section.items.map((p) => {
                      const isReady = p.status === "copy_ready";
                      const isRolesGroup = p.groupId === "package_roles";
                      const statusLabel: Record<PackagePlaceholderStatus, string> = {
                        copy_ready: "готов",
                        source_available: "ждёт синтаксиса",
                        pending_field: "нет FLD",
                        missing_source_column: "нет колонки",
                        deferred: "Sprint 3E",
                      };
                      // Sprint 3J-UI: те же modifier-controls, что у billing.
                      const pkgKind = classifyPackageItem(p);
                      const supportsLong = packageSupportsLongFormat(p);
                      // Маппинг package kind → kind для RowSettingsCell.
                      //   text → text, date → numeric, person_name → person_name, прочее → other.
                      const rowKind: "text" | "numeric" | "boolean" | "other" | "person_name" =
                        pkgKind === "text" ? "text"
                          : pkgKind === "date" ? "numeric"
                            : pkgKind === "person_name" ? "person_name"
                              : "other";
                      const pkgSettings: RowSettings = pkgRowSettings.get(p.tech_key) ?? { format: null, caseModifier: null };
                      const pkgDirty = !isDefault(pkgRowSettings.get(p.tech_key));
                      const finalToken = isReady
                        ? buildPackagePlaceholderToken(p, pkgSettings.format, pkgSettings.caseModifier, pkgSettings.includePosition === true, pkgSettings.joinMode ?? null)
                        : p.package_token;
                      const showModifiers = isReady && rowKind !== "other";
                      // Sprint 3J-Roles: реальный preview для ФИО-полей и ролей через formatPersonName.
                      const personNamePreview = (() => {
                        if (rowKind !== "person_name") return null;
                        const fmt = (pkgSettings.format as PersonNameFormat | null) ?? "full";
                        const allowedFmts: PersonNameFormat[] = ["full", "short", "signature_short"];
                        const safeFmt = allowedFmts.includes(fmt) ? fmt : "full";
                        const namePreview = formatPersonName(DEMO_PERSON_NAME, {
                          format: safeFmt,
                          case: pkgSettings.caseModifier as PersonNameFormat extends never ? never : Parameters<typeof formatPersonName>[1]["case"],
                        });
                        if (isRolesGroup && pkgSettings.includePosition) {
                          return `${formatDemoRolePosition(pkgSettings.caseModifier)} ${namePreview}`;
                        }
                        return namePreview;
                      })();
                      return (
                        <TableRow key={`pkg-${p.tech_key}`} className="hover:bg-muted/40 align-top">
                          <TableCell className="py-2">
                            <Badge variant="outline" className="text-[10px] font-normal">
                              {section.label}
                            </Badge>
                          </TableCell>
                          <TableCell className="font-medium text-sm py-2">
                            {p.label_ru}
                          </TableCell>
                          <TableCell className="py-2">
                            {p.reused_fld ? (
                              <Badge variant="secondary" className="font-mono text-[10px]">
                                {p.reused_fld}
                              </Badge>
                            ) : isRolesGroup ? (
                              <Badge variant="outline" className="font-mono text-[10px]">
                                ln
                              </Badge>
                            ) : (
                              <span className="text-[10px] text-muted-foreground italic">—</span>
                            )}
                          </TableCell>
                          <TableCell className="py-2">
                            <Badge
                              variant={isReady ? "default" : "outline"}
                              className={cn(
                                "text-[10px]",
                                !isReady && "border-dashed text-muted-foreground",
                              )}
                            >
                              {statusLabel[p.status]}
                            </Badge>
                          </TableCell>
                          <TableCell className="py-2">
                            {showModifiers ? (
                              <RowSettingsCell
                                kind={rowKind}
                                settings={pkgSettings}
                                onChange={(patch) => updatePkgSettings(p.tech_key, patch)}
                                supportsLongFormat={supportsLong}
                                supportsPosition={isRolesGroup}
                                supportsJoin={isRolesGroup}
                              />
                            ) : (
                              <span className="text-[10px] text-muted-foreground italic">—</span>
                            )}
                          </TableCell>
                          <TableCell className="py-2 text-xs text-foreground/80">
                            {personNamePreview ? (
                              <span className="italic" title={`Demo: ${DEMO_PERSON_NAME}`}>
                                {personNamePreview}
                              </span>
                            ) : p.example_value ? (
                              <span className="italic" title="Демонстрационный пример">
                                {p.example_value}
                              </span>
                            ) : (
                              <span className="text-muted-foreground/60 italic">— нет примера —</span>
                            )}
                          </TableCell>
                          <TableCell className="py-2">
                            {finalToken ? (
                              <code className="text-[11px] text-foreground/90 break-all font-mono">
                                {finalToken}
                              </code>
                            ) : (
                              <span className="text-[11px] text-muted-foreground/60 italic">— не готов к копированию —</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right py-2">
                            <div className="flex justify-end gap-0.5">
                              {showModifiers && pkgDirty && (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      size="icon" variant="ghost" className="h-7 w-7"
                                      onClick={() => resetPkgRow(p.tech_key)}
                                    >
                                      <RotateCcw className="h-3.5 w-3.5" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>Сбросить настройки</TooltipContent>
                                </Tooltip>
                              )}
                              {finalToken && (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      className="h-7 w-7"
                                      onClick={() => copyPlaceholder(finalToken)}
                                    >
                                      <Copy className="h-3.5 w-3.5" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>Копировать пакетный плейсхолдер</TooltipContent>
                                </Tooltip>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    }),
                  ])}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}

/** Inline настройки формата/падежа для одной строки. */
function RowSettingsCell({
  kind,
  settings,
  onChange,
  supportsLongFormat = false,
  supportsPosition = false,
}: {
  // Sprint 3J-Roles: расширили kind на "person_name" (ФИО-поля + роли ln-XXXXXX).
  kind: ReturnType<typeof classifyDataType> | "person_name";
  settings: RowSettings;
  onChange: (patch: Partial<RowSettings>) => void;
  /** Sprint 3J-UI: для `package.*.org_form` доступен `|format=long`. */
  supportsLongFormat?: boolean;
  /** Для ln-ролей: добавить должность перед ФИО. */
  supportsPosition?: boolean;
}) {
  // Для прочих типов модификаторы недоступны.
  if (kind === "other") {
    return <span className="text-[10px] text-muted-foreground italic">Без модификаторов</span>;
  }

  // Sprint 3J-Roles: person_name controls — ФИО полностью / кратко / для подписи + падеж.
  const isPersonName = kind === "person_name";
  const showLongToggle = kind === "text" && supportsLongFormat;
  const showFormatToggle = kind === "numeric" || kind === "boolean" || showLongToggle || isPersonName;
  // Падеж: text — всегда; numeric — только при words; boolean — никогда; person_name — всегда.
  const caseEnabled =
    kind === "text" || isPersonName || (kind === "numeric" && settings.format === "words");

  // Значение для format toggle
  const formatValue = isPersonName
    ? (settings.format === "short" ? "short"
        : settings.format === "signature_short" ? "signature_short"
        : "full")
    : kind === "numeric"
      ? settings.format === "words" ? "words" : "asis"
      : kind === "boolean"
        ? settings.format === "text" ? "text" : "asis"
        : showLongToggle
          ? settings.format === "long" ? "long" : "asis"
          : "asis";

  const handleFormatChange = (val: string) => {
    if (!val) return; // ToggleGroup может вернуть "" при дабл-клике
    if (isPersonName) {
      // canon: full → null (default); short/signature_short → сами.
      const fmt: FieldFormat | null =
        val === "short" ? "short" : val === "signature_short" ? "signature_short" : null;
      onChange({ format: fmt });
    } else if (kind === "numeric") {
      const fmt: FieldFormat | null = val === "words" ? "words" : null;
      onChange({
        format: fmt,
        ...(fmt === null ? { caseModifier: null } : {}),
      });
    } else if (kind === "boolean") {
      const fmt: FieldFormat | null = val === "text" ? "text" : null;
      onChange({ format: fmt });
    } else if (showLongToggle) {
      const fmt: FieldFormat | null = val === "long" ? "long" : null;
      onChange({ format: fmt });
    }
  };

  const handleCaseChange = (val: string) => {
    const next: FieldCase | null = val === "none" ? null : (val as FieldCase);
    onChange({ caseModifier: next });
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {showFormatToggle && (
        <ToggleGroup
          type="single"
          size="sm"
          value={formatValue}
          onValueChange={handleFormatChange}
          className="h-7"
        >
          <ToggleGroupItem value={isPersonName ? "full" : "asis"} className="h-7 px-2 text-[10px]">
            {isPersonName ? "ФИО полностью" : showLongToggle ? "Кратко" : "Обычный"}
          </ToggleGroupItem>
          {isPersonName && (
            <ToggleGroupItem value="short" className="h-7 px-2 text-[10px]">
              ФИО кратко
            </ToggleGroupItem>
          )}
          {isPersonName && (
            <ToggleGroupItem value="signature_short" className="h-7 px-2 text-[10px]">
              ФИО для подписи
            </ToggleGroupItem>
          )}
          {kind === "numeric" && (
            <ToggleGroupItem value="words" className="h-7 px-2 text-[10px]">
              Прописью
            </ToggleGroupItem>
          )}
          {kind === "boolean" && (
            <ToggleGroupItem value="text" className="h-7 px-2 text-[10px]">
              Текстом
            </ToggleGroupItem>
          )}
          {showLongToggle && (
            <ToggleGroupItem value="long" className="h-7 px-2 text-[10px]">
              Развёрнуто
            </ToggleGroupItem>
          )}
        </ToggleGroup>
      )}

      {(kind === "text" || kind === "numeric" || isPersonName) && (
        caseEnabled ? (
          <Select
            value={settings.caseModifier ?? "none"}
            onValueChange={handleCaseChange}
          >
            <SelectTrigger className="h-7 w-[140px] text-[10px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CASE_OPTIONS.map(opt => (
                <SelectItem key={opt.value} value={opt.value} className="text-xs">
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="text-[10px] text-muted-foreground italic cursor-help">
                Падеж недоступен
              </span>
            </TooltipTrigger>
            <TooltipContent>
              Падеж доступен только для значения «прописью»
            </TooltipContent>
          </Tooltip>
        )
      )}

      {kind === "boolean" && (
        <span className="text-[10px] text-muted-foreground italic">Падеж недоступен</span>
      )}

      {isPersonName && supportsPosition && (
        <Button
          type="button"
          variant={settings.includePosition ? "default" : "outline"}
          size="sm"
          className="h-7 px-2 text-[10px]"
          onClick={() => onChange({ includePosition: !settings.includePosition })}
        >
          С должностью
        </Button>
      )}
    </div>
  );
}
