/** Fixed Map entry presentation: optional numeric index followed by slot text. */
export function projectMapEntryText(props = {}, slot = {}, index = 0) {
  const text = String(slot?.text || "");
  const marker = projectMapNumber(props?.numbering, index);
  return marker ? `${marker}. ${text}` : text;
}

export function projectMapNumber(numbering = "numeric", index = 0) {
  const value = Math.max(1, Math.floor(Number(index) || 0) + 1);
  if (numbering === "none") return "";
  if (numbering === "latin_upper") return latinUpper(value);
  if (numbering === "roman_upper") return romanUpper(value);
  return String(value);
}

function latinUpper(value) {
  let current = value;
  let output = "";
  while (current > 0) {
    current -= 1;
    output = String.fromCharCode(65 + (current % 26)) + output;
    current = Math.floor(current / 26);
  }
  return output;
}

function romanUpper(value) {
  if (value > 3999) return String(value);
  const symbols = [
    [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"],
    [100, "C"], [90, "XC"], [50, "L"], [40, "XL"],
    [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]
  ];
  let current = value;
  let output = "";
  for (const [amount, symbol] of symbols) {
    while (current >= amount) {
      output += symbol;
      current -= amount;
    }
  }
  return output;
}
