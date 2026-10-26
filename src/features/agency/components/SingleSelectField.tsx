import { Select, SelectItem } from "@heroui/react";
import { selectFieldProps } from "@/components/shared/select-field";

export interface SingleSelectOption {
  id: string;
  label: string;
}

interface SingleSelectFieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: readonly SingleSelectOption[];
  placeholder: string;
  isInvalid?: boolean;
  errorMessage?: string;
}

/**
 * Single-choice select following the repo's HeroUI convention (same shape as
 * the facilities modal helper): selection is keyed by the record id, the
 * blank option means "none/unassigned" and never submits a fake reference.
 */
export function SingleSelectField({
  label,
  value,
  onChange,
  options,
  placeholder,
  isInvalid,
  errorMessage,
}: SingleSelectFieldProps) {
  return (
    <Select
      {...selectFieldProps()}
      label={label}
      placeholder={placeholder}
      selectedKeys={value ? [value] : []}
      onSelectionChange={(keys) => {
        const v = Array.from(keys)[0] as string | undefined;
        onChange(v ?? "");
      }}
      isInvalid={isInvalid}
      errorMessage={errorMessage}
    >
      {[{ id: "", label: placeholder }, ...options].map((o) => (
        <SelectItem key={o.id} textValue={o.label}>
          {o.label}
        </SelectItem>
      ))}
    </Select>
  );
}
