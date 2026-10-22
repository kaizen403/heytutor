/** English numeric words shared by voice output and board cue matching. */
const ONES_WORDS = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
  "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
  "seventeen", "eighteen", "nineteen",
];
const TENS_WORDS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

function integerToWords(n: number): string {
  if (n < 20) {
    return ONES_WORDS[n]!;
  }
  if (n < 100) {
    const rest = n % 10;
    return `${TENS_WORDS[Math.floor(n / 10)]}${rest ? ` ${ONES_WORDS[rest]}` : ""}`;
  }
  if (n < 1000) {
    const rest = n % 100;
    return `${ONES_WORDS[Math.floor(n / 100)]} hundred${rest ? ` ${integerToWords(rest)}` : ""}`;
  }
  if (n < 1_000_000) {
    const rest = n % 1000;
    return `${integerToWords(Math.floor(n / 1000))} thousand${rest ? ` ${integerToWords(rest)}` : ""}`;
  }
  if (n < 1_000_000_000) {
    const rest = n % 1_000_000;
    return `${integerToWords(Math.floor(n / 1_000_000))} million${rest ? ` ${integerToWords(rest)}` : ""}`;
  }
  return String(n)
    .split("")
    .map((digit) => ONES_WORDS[Number(digit)] ?? digit)
    .join(" ");
}

/**
 * "0.43" -> "zero point four three", "1,000" -> "one thousand". Both the board
 * token and the narration go through this, so a digit string on the board
 * finds the same words whether the model wrote the number in digits or spelt
 * it out for the voice.
 */
export function numberToSpokenWords(raw: string): string {
  const cleaned = raw.replace(/,/g, "");
  const [intPart = "", decimalPart] = cleaned.split(".");
  const digitsOnly = intPart.replace(/\D/g, "");
  const intWords =
    digitsOnly.length === 0
      ? ""
      : digitsOnly.length > 9
        ? digitsOnly.split("").map((digit) => ONES_WORDS[Number(digit)]).join(" ")
        : integerToWords(Number(digitsOnly));
  if (decimalPart === undefined || decimalPart.length === 0) {
    return intWords;
  }
  const decimalWords = decimalPart
    .split("")
    .map((digit) => ONES_WORDS[Number(digit)] ?? digit)
    .join(" ");
  return `${intWords.length > 0 ? `${intWords} ` : ""}point ${decimalWords}`;
}

