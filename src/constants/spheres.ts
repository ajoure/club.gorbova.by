// Централизованный справочник сфер (категорий)
// Используется во всех частях системы: задачи, колесо баланса, фильтры

export interface Sphere {
  id: string;
  name: string;
  color: string;
  group: string;
}

export const SPHERES: Sphere[] = [
  // Служебная
  { id: "none", name: "Без категории", color: "#6b7280", group: "Служебная" },
  
  // Работа и деньги
  { id: "work", name: "Работа", color: "#3b82f6", group: "Работа и деньги" },
  { id: "business", name: "Бизнес", color: "#2563eb", group: "Работа и деньги" },
  { id: "finance", name: "Финансы", color: "#10b981", group: "Работа и деньги" },
  
  // Развитие
  { id: "learning", name: "Обучение", color: "#8b5cf6", group: "Развитие" },
  { id: "self-development", name: "Саморазвитие", color: "#a855f7", group: "Развитие" },
  
  // Личная жизнь
  { id: "health", name: "Здоровье и спорт", color: "#ef4444", group: "Личная жизнь" },
  { id: "family", name: "Семья и дети", color: "#f97316", group: "Личная жизнь" },
  { id: "relationships", name: "Отношения", color: "#ec4899", group: "Личная жизнь" },
  { id: "personal", name: "Личное", color: "#f59e0b", group: "Личная жизнь" },
  { id: "rest", name: "Отдых и восстановление", color: "#14b8a6", group: "Личная жизнь" },
  { id: "hobbies", name: "Хобби и развлечения", color: "#06b6d4", group: "Личная жизнь" },
  
  // Социальное
  { id: "friends", name: "Окружение и друзья", color: "#f472b6", group: "Социальное" },
  
  // Стратегия и цели
  { id: "goals", name: "Цели", color: "#eab308", group: "Стратегия и цели" },
  { id: "planning", name: "Планирование", color: "#84cc16", group: "Стратегия и цели" },
  { id: "strategy", name: "Стратегия", color: "#22c55e", group: "Стратегия и цели" },
  { id: "projects", name: "Проекты", color: "#0ea5e9", group: "Стратегия и цели" },
];

// Получить сферу по ID
export function getSphereById(id: string | null | undefined): Sphere {
  if (!id) return SPHERES[0]; // Без категории
  return SPHERES.find(s => s.id === id) || SPHERES[0];
}

// Получить сферу по имени
export function getSphereByName(name: string | null | undefined): Sphere {
  if (!name) return SPHERES[0];
  return SPHERES.find(s => s.name === name) || SPHERES[0];
}

// Группы сфер для отображения в dropdown с разделителями
export function getGroupedSpheres(): { group: string; spheres: Sphere[] }[] {
  const groups: { group: string; spheres: Sphere[] }[] = [];
  
  SPHERES.forEach(sphere => {
    const existingGroup = groups.find(g => g.group === sphere.group);
    if (existingGroup) {
      existingGroup.spheres.push(sphere);
    } else {
      groups.push({ group: sphere.group, spheres: [sphere] });
    }
  });
  
  return groups;
}

// Маппинг сфер к секторам колеса баланса
export const WHEEL_SPHERE_MAPPING: Record<string, string[]> = {
  health: ["health"],
  money: ["finance", "business"],
  career: ["work", "business", "projects"],
  family: ["family", "relationships"],
  friends: ["friends"],
  growth: ["self-development", "learning"],
  hobbies: ["hobbies", "rest"],
  spirituality: ["personal", "goals", "strategy"],
};
