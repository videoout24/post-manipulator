import { t } from "../i18n/index.js?v=1.8.0";
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
    throw new PasswordPolicyError("PASSWORD_CONFIRMATION_MISMATCH", t("security.passwordPolicy.passwordsDoNotMatch"));
  }
  return String(password);
}

export function validatePassword(password) {
  const value = String(password ?? "");
  const points = Array.from(value);
  if (points.length < PASSWORD_MIN_CODE_POINTS) {
    throw new PasswordPolicyError("PASSWORD_TOO_SHORT", t("security.passwordPolicy.passwordMustBeAtLeast8Characters"));
  }
  if (/^\s|\s$/u.test(value)) {
    throw new PasswordPolicyError("PASSWORD_EDGE_WHITESPACE", t("security.passwordPolicy.passwordCannotStartOrEndWithA"));
  }
  if (!/\p{L}/u.test(value)) {
    throw new PasswordPolicyError("PASSWORD_LETTER_REQUIRED", t("security.passwordPolicy.passwordMustContainALetter"));
  }
  if (!/\p{N}/u.test(value)) {
    throw new PasswordPolicyError("PASSWORD_DIGIT_REQUIRED", t("security.passwordPolicy.passwordMustContainADigit"));
  }
  return value;
}
