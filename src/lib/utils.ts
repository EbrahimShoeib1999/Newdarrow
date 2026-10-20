import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import i18n from "./i18n";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Converts any Eastern Arabic digits (٠-٩) or Persian digits (۰-۹) to standard Western/English digits (0-9).
 * Guarantees that displayed numbers are always in Western numerals regardless of active language or OS locale.
 */
export function toWesternDigits(input: string | number | null | undefined): string {
  if (input == null) return "";
  const s = String(input);
  return s
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 1632))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 1776));
}

export function formatNumber(
  value: number | string | null | undefined,
  options?: Intl.NumberFormatOptions
): string {
  if (value == null || value === "") return "0";
  const num = typeof value === "string" ? Number(value) : value;
  if (isNaN(num)) return toWesternDigits(String(value));

  const currentLang = i18n.language || "en";
  const locale = currentLang.toLowerCase().startsWith("ar") ? "ar-u-nu-latn" : currentLang;

  const formatted = new Intl.NumberFormat(locale, {
    maximumFractionDigits: 2,
    ...options,
  }).format(num);

  return toWesternDigits(formatted);
}

export function formatDate(date: unknown): string {
  if (!date) return "—";
  
  let d: Date;
  if (date && typeof date === "object" && "toDate" in date && typeof (date as { toDate: () => unknown }).toDate === "function") {
    d = (date as { toDate: () => Date }).toDate();
  } else if (typeof date === "string" || typeof date === "number" || date instanceof Date) {
    d = new Date(date);
  } else {
    return "—";
  }

  if (isNaN(d.getTime())) return "—";

  const currentLang = i18n.language || "en";
  const locale = currentLang.toLowerCase().startsWith("ar") ? "ar-u-nu-latn" : currentLang;

  const formatted = new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(d);

  return toWesternDigits(formatted);
}

export function generateId(): string {
  return crypto.randomUUID();
}

/**
 * True if the string contains an ASCII control character (C0 range U+0000–U+001F
 * or DEL U+007F). Names/labels may use any casing, spaces, Arabic and normal
 * punctuation, but control codes would corrupt stored values and rendering.
 * Implemented via code points (not a control-character regex) to stay clear of
 * the `no-control-regex` lint rule while remaining a plain data-integrity check.
 */
export function containsControlCharacters(value: string | null | undefined): boolean {
  if (!value) return false;
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return true;
  }
  return false;
}

/** App display currency is always Saudi Riyal. */
export const APP_CURRENCY = "SAR";

/** Official Unicode Saudi Riyal Sign (U+20C1) for plain-text / CSV only. Prefer <MoneyAmount /> in UI. */
export const RIYAL_SIGN = "\u20C1";

export function isSarCurrency(_currency?: string | null): boolean {
  void _currency;
  return true;
}

/** Always returns SAR — any other stored code is remapped for display/storage defaults. */
export function normalizeCurrencyCode(_currency?: string | null): string {
  void _currency;
  return APP_CURRENCY;
}

/** Formats amount for plain text. UI should use <MoneyAmount /> for the SVG رiyal mark. */
export function formatCurrency(
  amount: number,
  _currency?: string | null,
  options?: Intl.NumberFormatOptions
): string {
  void _currency;
  const currentLang = i18n.language || "en";
  const fractionDigits = options?.maximumFractionDigits ?? 2;
  const locale = currentLang.toLowerCase().startsWith("ar") ? "ar-u-nu-latn" : currentLang;

  const formatted = amount.toLocaleString(locale, {
    maximumFractionDigits: fractionDigits,
    minimumFractionDigits: 0,
    ...options,
  });

  return `${toWesternDigits(formatted)}\u00A0${RIYAL_SIGN}`;
}
