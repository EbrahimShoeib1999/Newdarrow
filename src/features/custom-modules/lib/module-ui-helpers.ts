/**
 * Engine UI shared bits: the icon allow-list resolution (definitions store a
 * NAME string, never a component, so rendering stays fail-safe) and the
 * FieldError → localized message helper used by both the record form and the
 * configuration editor.
 */

import type { TFunction } from "i18next";
import {
  Box,
  Building2,
  Calendar,
  Car,
  ClipboardList,
  Dumbbell,
  FileText,
  Gavel,
  Gem,
  GraduationCap,
  Package,
  PawPrint,
  Receipt,
  Stethoscope,
  Truck,
  Users,
  Utensils,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { FieldError } from "../types/custom-module.types";

const ICONS: Record<string, LucideIcon> = {
  Box,
  ClipboardList,
  FileText,
  Users,
  Calendar,
  Receipt,
  Wrench,
  Stethoscope,
  GraduationCap,
  Building2,
  Car,
  Package,
  Truck,
  PawPrint,
  Utensils,
  Dumbbell,
  Gavel,
  Gem,
};

/** Unknown/stale icon names degrade to Box instead of crashing the render. */
export function moduleIcon(name: string): LucideIcon {
  return ICONS[name] ?? Box;
}

/** Machine reason → user text; unknown reasons surface verbatim for debug. */
export function fieldErrorText(t: TFunction, err: FieldError): string {
  return t(`errors.${err.reason}`, { ...err.params, defaultValue: err.reason });
}

/** Index FieldErrors by field key for inline display (definition field keys
 * arrive prefixed like "field:amount" / "stage:open" / "listConfig.columns"). */
export function errorsByField(errors: FieldError[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const e of errors) {
    (out[e.fieldKey] ??= []).push(e.reason);
  }
  return out;
}
