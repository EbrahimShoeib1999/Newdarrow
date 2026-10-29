import { useTranslation } from "react-i18next";
import { Input, Select, SelectItem, Switch, Textarea } from "@heroui/react";
import { selectFieldProps } from "@/components/shared/select-field";
import type { ModuleFieldDefinition } from "../types/custom-module.types";

interface FieldRendererProps {
  field: ModuleFieldDefinition;
  value: unknown;
  onChange: (next: unknown) => void;
  /** Resolved {id,label} list for relation pickers (from listRelationOptions). */
  relationOptions?: { id: string; label: string }[];
  errorText?: string;
  disabled?: boolean;
}

/**
 * One configurable field → one native-feeling control. The bilingual label
 * flips with the document language, RTL/LTR comes from logical utilities the
 * shared components already use, and every control stays accessible (label +
 * errorMessage wiring through HeroUI). The pure engine (coerceFieldValue) is
 * the authority on what a value means; this component only collects input.
 */
export function FieldRenderer({
  field,
  value,
  onChange,
  relationOptions,
  errorText,
  disabled,
}: FieldRendererProps) {
  const { i18n } = useTranslation("custom_modules");
  const lang = i18n.language === "ar" ? "ar" : "en";
  const label = `${field.label[lang]}${field.required ? " *" : ""}`;
  const help = field.help?.[lang];
  const description = errorText ?? help;

  if (field.type === "boolean") {
    return (
      <Switch
        isSelected={value === true}
        isDisabled={disabled}
        onValueChange={onChange}
        aria-label={label}
      >
        <span className="text-sm">{label}</span>
        {errorText && <span className="text-xs text-danger">{errorText}</span>}
      </Switch>
    );
  }

  if (field.type === "select" || field.type === "multiselect" || field.type === "relation") {
    const isMulti = field.type === "multiselect";
    const options =
      field.type === "relation"
        ? (relationOptions ?? [])
        : (field.options ?? []).map((o) => ({ id: o.key, label: o.label[lang] }));
    const selectedKeys = isMulti
      ? (Array.isArray(value) ? (value as string[]) : [])
      : value === null || value === undefined || value === ""
        ? []
        : [String(value)];
    return (
      <Select
        {...selectFieldProps()}
        label={label}
        isDisabled={disabled}
        isInvalid={!!errorText}
        selectionMode={isMulti ? "multiple" : "single"}
        disallowEmptySelection={field.required && !isMulti}
        selectedKeys={selectedKeys}
        onSelectionChange={(keys) => {
          const arr = Array.from(keys as Set<unknown>, (k) => String(k));
          onChange(isMulti ? arr : (arr[0] ?? null));
        }}
        errorMessage={description}
      >
        {options.map((o) => (
          <SelectItem key={o.id}>{o.label}</SelectItem>
        ))}
      </Select>
    );
  }

  if (field.type === "textarea") {
    return (
      <Textarea
        label={label}
        value={typeof value === "string" ? value : ""}
        isDisabled={disabled}
        isInvalid={!!errorText}
        description={description}
        onValueChange={onChange}
        maxLength={field.maxLen}
      />
    );
  }

  const numeric = field.type === "number" || field.type === "currency";
  return (
    <Input
      label={label}
      type={field.type === "date" ? "date" : numeric ? "number" : field.type === "email" ? "email" : "text"}
      inputMode={numeric ? "decimal" : field.type === "phone" ? "tel" : undefined}
      step={field.type === "currency" ? "0.01" : field.type === "number" ? "any" : undefined}
      value={value === null || value === undefined ? "" : String(value)}
      isDisabled={disabled}
      isInvalid={!!errorText}
      description={description}
      onValueChange={(v) => onChange(numeric && v === "" ? null : v)}
      maxLength={field.maxLen}
    />
  );
}
