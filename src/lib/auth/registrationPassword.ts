export const REGISTRATION_PASSWORD_MIN_LENGTH = 6;

export interface RegistrationPasswordChecks {
  minLength: boolean;
  hasLetter: boolean;
  hasDigit: boolean;
}

export function checkRegistrationPassword(password: string): RegistrationPasswordChecks {
  return {
    minLength: password.length >= REGISTRATION_PASSWORD_MIN_LENGTH,
    hasLetter: /[A-Za-zА-Яа-яЁё]/.test(password),
    hasDigit: /\d/.test(password),
  };
}

export function isRegistrationPasswordValid(password: string): boolean {
  const checks = checkRegistrationPassword(password);
  return checks.minLength && checks.hasLetter && checks.hasDigit;
}
