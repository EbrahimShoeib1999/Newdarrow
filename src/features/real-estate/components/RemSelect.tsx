/**
 * Shared HeroUI select helper for REM forms — mirrors the facilities
 * module's single-select pattern (stable machine ids as keys, translated
 * labels only for display).
 */

import { Select, SelectItem } from "@heroui/react";
import { selectFieldProps } from "@/components/shared/select-field";

export interface RemSelectOption {
  id: string;
  label: string;
}

export function RemSelect({
  label,
  value,
  onChange,
  options,
  placeholderKey,
  isInvalid,
  errorMessage,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: RemSelectOption[];
  /** Option with id "" is rendered first using this placeholder label. */
  placeholderKey?: string;
  isInvalid?: boolean;
  errorMessage?: string;
  disabled?: boolean;
}) {
  const items: RemSelectOption[] = placeholderKey
    ? [{ id: "", label: placeholderKey }, ...options]
    : options;
  return (
    <Select
      {...selectFieldProps()}
      label={label}
      placeholder={placeholderKey}
      selectedKeys={value ? [value] : placeholderKey ? ["__none__"] : []}
      onSelectionChange={(keys) => {
        const v = Array.from(keys)[0];
        const s = v == null ? "" : String(v);
        onChange(s === "__none__" ? "" : s);
      }}
      isInvalid={isInvalid}
      errorMessage={errorMessage}
      isDisabled={disabled}
    >
      {items.map((o) => (
        <SelectItem key={o.id || "__none__"} textValue={o.label}>
          {o.label}
        </SelectItem>
      ))}
    </Select>
  );
}
