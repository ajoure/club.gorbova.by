const RUSSIAN_MONTHS = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
] as const;

const CYRILLIC_TRANSLITERATION: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "zh",
  з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o",
  п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts",
  ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu",
  я: "ya",
};

export function dateToRussianFormat(date: Date): string {
  return `${date.getDate()} ${RUSSIAN_MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

export function fullNameToInitials(fullName?: string | null): string {
  if (!fullName) return "";
  const parts = String(fullName).trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[1][0].toUpperCase()}.${parts[0]}`;
  return `${parts[1][0].toUpperCase()}.${parts[2][0].toUpperCase()}.${parts[0]}`;
}

export function generateDocumentNumber(prefix = "CORP"): string {
  const now = new Date();
  const year = now.getFullYear().toString().slice(-2);
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const random = Math.floor(Math.random() * 1000).toString().padStart(3, "0");
  return `${prefix}-${year}${month}${day}-${random}`;
}

export function buildAddress(entity: Record<string, unknown>): string {
  const clientType = entity.client_type as string;
  if (clientType === "individual") {
    return [
      entity.ind_address_index,
      entity.ind_address_region,
      entity.ind_address_district,
      entity.ind_address_city,
      entity.ind_address_street,
      entity.ind_address_house,
      entity.ind_address_apartment && `кв. ${entity.ind_address_apartment}`,
    ].filter(Boolean).join(", ");
  }
  if (clientType === "entrepreneur") return (entity.ent_address as string) || "";
  return (entity.leg_address as string) || "";
}

export function entityName(entity: Record<string, unknown>): string {
  const clientType = entity.client_type as string;
  if (clientType === "individual") return (entity.ind_full_name as string) || "";
  if (clientType === "entrepreneur") return (entity.ent_name as string) || "";
  return (entity.leg_name as string) || "";
}

export function sanitizeFileName(name: string, defaultExtension = ""): string {
  try {
    if (!name) return `file${defaultExtension}`;
    const lastDot = name.lastIndexOf(".");
    const extension = lastDot > 0 ? name.slice(lastDot).toLowerCase() : defaultExtension;
    const base = lastDot > 0 ? name.slice(0, lastDot) : name;

    let safe = base.toLowerCase();
    for (const [cyrillic, latin] of Object.entries(CYRILLIC_TRANSLITERATION)) {
      safe = safe.replaceAll(cyrillic, latin);
    }
    safe = safe
      .replace(/\s+/g, "_")
      .replace(/[^a-z0-9_.-]/g, "")
      .replace(/_+/g, "_")
      .slice(0, 100);

    return `${safe || "file"}${extension}`;
  } catch {
    return `file${defaultExtension}`;
  }
}
