// Console arguments must never contain an Error instance, its stack/cause, or
// arbitrary API payloads: browser inspectors expose their nested request URLs.
export function safeErrorDetails(error) {
  const details = {};
  const method = error?.method;
  if (typeof method === "string" && /^[A-Za-z]{1,40}$/.test(method)) details.method = method;
  if (Number.isInteger(error?.errorCode) && error.errorCode >= 0 && error.errorCode <= 599) details.code = error.errorCode;
  if (error?.timedOut === true) details.timedOut = true;
  return details;
}
