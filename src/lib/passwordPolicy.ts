export const USER_PASSWORD_MIN_LENGTH = 6;

export function validateUserPassword(password: string) {
  return {
    minLength: password.length >= USER_PASSWORD_MIN_LENGTH,
  };
}

export function getUserPasswordRequirementText() {
  return `Минимум ${USER_PASSWORD_MIN_LENGTH} символов`;
}
