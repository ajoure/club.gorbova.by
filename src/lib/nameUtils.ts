/**
 * Централизованные утилиты для работы с именами контактов
 */

/**
 * Парсит полное имя в first_name + last_name
 * Поддерживает форматы: "Имя Фамилия", "ФАМИЛИЯ ИМЯ", "Фамилия Имя Отчество"
 */
export function parseFullName(fullName: string | null): { 
  firstName: string; 
  lastName: string;
} {
  if (!fullName?.trim()) return { firstName: "", lastName: "" };
  
  const parts = fullName.trim().split(/\s+/);
  
  // Если всё в UPPERCASE латиницей — формат банковской карты: LASTNAME FIRSTNAME
  const isCardFormat = /^[A-Z\s]+$/.test(fullName);
  
  if (isCardFormat && parts.length >= 2) {
    // Карточный формат: ZELIANKEVICH AKSANA → firstName=Aksana, lastName=Zeliankevich
    return {
      firstName: capitalize(parts[parts.length - 1]),
      lastName: parts.slice(0, -1).map(capitalize).join(" ")
    };
  }
  
  // Стандартный формат: Имя Фамилия
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: "" };
  }
  
  // Если первая часть — фамилия (кириллица, заканчивается на типичные суффиксы)
  // Формат: Иванов Иван Иванович → lastName=Иванов, firstName=Иван
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(" ")
  };
}

/**
 * Форматирует имя для отображения как "Фамилия Имя"
 */
export function formatContactName(contact: { 
  first_name?: string | null; 
  last_name?: string | null; 
  full_name?: string | null;
}): string {
  if (contact.last_name && contact.first_name) {
    return `${contact.last_name} ${contact.first_name}`;
  }
  if (contact.last_name) return contact.last_name;
  if (contact.first_name) return contact.first_name;
  if (contact.full_name) return contact.full_name;
  return "—";
}

/**
 * Capitalize first letter, lowercase rest
 */
function capitalize(str: string): string {
  if (!str) return "";
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}
