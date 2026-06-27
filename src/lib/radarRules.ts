import type { RadarFrequency, SubscriptionPlan } from "./types";

const standardFrequencies: RadarFrequency[] = ["Semanal", "Quincenal"];
const premiumFrequencies: RadarFrequency[] = ["Semanal", "Quincenal", "Diaria"];

export function frequencyOptionsForPlan(plan: SubscriptionPlan): RadarFrequency[] {
  return plan === "Premium" ? premiumFrequencies : standardFrequencies;
}

export function ensureFrequencyForPlan(
  frequency: RadarFrequency | string | undefined,
  plan: SubscriptionPlan
): RadarFrequency {
  const options = frequencyOptionsForPlan(plan);
  return options.includes(frequency as RadarFrequency) ? (frequency as RadarFrequency) : options[0];
}

export function normalizeKeywordInput(value: string) {
  return value.replace(/[^0-9A-Za-zÁÉÍÓÚáéíóúÑñÜü, ]/g, "");
}

export function parseKeywordInput(value: string) {
  return normalizeKeywordInput(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
