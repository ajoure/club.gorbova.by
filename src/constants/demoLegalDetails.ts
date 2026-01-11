// Демонстрационные данные для формы реквизитов
// Эти данные НЕ сохраняются в БД, используются только для UI-подсказок

export const DEMO_INDIVIDUAL = {
  ind_full_name: "Иванов Иван Иванович",
  ind_birth_date: "1990-01-15",
  ind_personal_number: "1234567A009PB1",
  email: "demo.user@example.com",
  phone: "+375 29 7000000",
  ind_passport_series: "MP",
  ind_passport_number: "7654321",
  ind_passport_issued_date: "2018-06-05",
  ind_passport_valid_until: "2028-06-05",
  ind_passport_issued_by: "Тестовым РУВД г. Минска",
  ind_address_index: "220000",
  ind_address_region: "Минская область",
  ind_address_district: "Минский район",
  ind_address_city: "Минск",
  ind_address_street: "ул. Тестовая",
  ind_address_house: "1",
  ind_address_apartment: "1",
  bank_account: "", // Не заполняем, чтобы не ломать валидацию IBAN
  bank_name: "",
  bank_code: "",
};

export const DEMO_ENTREPRENEUR = {
  ent_name: "ИП Иванов Иван Иванович",
  ent_unp: "123456789",
  ent_address: "220000, г. Минск, ул. Тестовая, д. 1, оф. 1",
  ent_acts_on_basis: "свидетельства о государственной регистрации",
  email: "demo.ip@example.com",
  phone: "+375 29 7000000",
  bank_account: "",
  bank_name: "",
  bank_code: "",
};

export const DEMO_LEGAL_ENTITY = {
  leg_org_form: "ООО",
  leg_name: "Тестовая Компания",
  leg_unp: "987654321",
  leg_address: "220000, г. Минск, ул. Тестовая, д. 1, оф. 1",
  leg_director_position: "директор",
  leg_director_name: "Иванов Иван Иванович",
  leg_acts_on_basis: "Устава",
  email: "demo.company@example.com",
  phone: "+375 29 7000000",
  bank_account: "",
  bank_name: "",
  bank_code: "",
};

// Проверка, являются ли данные демо-данными (для защиты от случайного сохранения)
export function isDemoData(data: Record<string, any>): boolean {
  const demoEmails = [
    "demo.user@example.com",
    "demo.ip@example.com", 
    "demo.company@example.com"
  ];
  return demoEmails.includes(data.email);
}
