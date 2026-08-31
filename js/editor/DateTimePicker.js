export function createDateTimePicker({ value = "", onChange = null, label = "Дата и время", disabled = false, accessory = null } = {}) {
  const row = document.createElement("div");
  row.className = "date-time-picker" + (accessory ? " has-accessory" : "");

  const input = document.createElement("input");
  input.type = "datetime-local";
  input.step = "60";
  input.value = String(value || "");
  input.disabled = Boolean(disabled);
  input.title = label;
  input.setAttribute("aria-label", label);

  // The timestamp is chosen in the native picker, not typed as an arbitrary
  // string. Tab and Escape still retain their normal navigation behaviour.
  input.addEventListener("keydown", event => {
    if (["Tab", "Escape"].includes(event.key)) return;
    event.preventDefault();
  });
  input.addEventListener("beforeinput", event => event.preventDefault());
  input.addEventListener("paste", event => event.preventDefault());
  input.addEventListener("change", () => onChange?.(input.value));

  const openPicker = () => {
    if (input.disabled) return;
    try {
      if (typeof input.showPicker === "function") input.showPicker();
      else input.focus();
    } catch {
      input.focus();
    }
  };
  input.addEventListener("click", openPicker);

  row.append(input);
  if (accessory) row.append(accessory);
  return row;
}
