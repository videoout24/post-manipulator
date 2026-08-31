export const PASSWORD_MIN_CODE_POINTS = 8;

export class PasswordPolicyError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PasswordPolicyError";
    this.code = code;
  }
}

export function validateNewPassword(password, confirmation) {
  validatePassword(password);
  if (String(password) !== String(confirmation)) {
    throw new PasswordPolicyError("PASSWORD_CONFIRMATION_MISMATCH", "Пароли не совпадают");
  }
  return String(password);
}

export function validatePassword(password) {
  const value = String(password ?? "");
  const points = Array.from(value);
  if (points.length < PASSWORD_MIN_CODE_POINTS) {
    throw new PasswordPolicyError("PASSWORD_TOO_SHORT", "Пароль должен содержать не менее 8 символов");
  }
  if (/^\s|\s$/u.test(value)) {
    throw new PasswordPolicyError("PASSWORD_EDGE_WHITESPACE", "Пароль не может начинаться или заканчиваться пробелом");
  }
  if (!/\p{L}/u.test(value)) {
    throw new PasswordPolicyError("PASSWORD_LETTER_REQUIRED", "Пароль должен содержать букву");
  }
  if (!/\p{N}/u.test(value)) {
    throw new PasswordPolicyError("PASSWORD_DIGIT_REQUIRED", "Пароль должен содержать цифру");
  }
  return value;
}
