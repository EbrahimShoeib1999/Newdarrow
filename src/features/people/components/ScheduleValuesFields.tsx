/**
 * Shared editable form block for ScheduleValues (templates + assignment
 * overrides). Controlled component — the parent owns the draft object so the
 * same fields work for create/edit of templates AND for per-assignment
 * overrides without duplicating markup per page.
 */
import { Input, Select, SelectItem, Switch, Checkbox } from "@heroui/react";
import { useTranslation } from "react-i18next";
import { selectFieldProps } from "@/components/shared/select-field";
import type { ScheduleValues } from "../types/work-schedule.types";
import { formatDurationHM, scheduleDurationMinutes, TIMEZONE_OPTIONS } from "../lib/work-schedule-rules";

const WEEKDAY_KEYS = [
  "common.weekday_sun",
  "common.weekday_mon",
  "common.weekday_tue",
  "common.weekday_wed",
  "common.weekday_thu",
  "common.weekday_fri",
  "common.weekday_sat",
];

interface Props {
  value: ScheduleValues;
  onChange: (next: ScheduleValues) => void;
  /** Overrides mode: unset fields stay "inherit" instead of showing defaults. */
  compact?: boolean;
}

export function ScheduleValuesFields({ value, onChange, compact = false }: Props) {
  const { t } = useTranslation("people");
  const set = <K extends keyof ScheduleValues>(key: K, v: ScheduleValues[K]) =>
    onChange({ ...value, [key]: v });

  const duration = scheduleDurationMinutes(value);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Input
          type="time"
          label={t("schedules.field_start")}
          value={value.startTime}
          onValueChange={(v) => set("startTime", v)}
        />
        <Input
          type="time"
          label={t("schedules.field_end")}
          value={value.endTime}
          onValueChange={(v) => set("endTime", v)}
        />
      </div>

      <div>
        <p className="text-xs font-bold text-default-500 mb-2">{t("schedules.field_working_days")}</p>
        <div className="flex flex-wrap gap-2">
          {WEEKDAY_KEYS.map((key, idx) => (
            <Checkbox
              key={key}
              isSelected={value.workingDays.includes(idx)}
              onValueChange={(checked) =>
                set(
                  "workingDays",
                  checked
                    ? [...value.workingDays, idx].sort((a, b) => a - b)
                    : value.workingDays.filter((d) => d !== idx)
                )
              }
            >
              <span className="text-xs font-semibold">{t(key)}</span>
            </Checkbox>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Input
          type="number"
          label={t("schedules.field_grace")}
          value={String(value.graceMinutes)}
          onValueChange={(v) => set("graceMinutes", Number(v) || 0)}
        />
        <Input
          type="number"
          label={t("schedules.field_break")}
          value={String(value.breakMinutes)}
          onValueChange={(v) => set("breakMinutes", Number(v) || 0)}
        />
        <Input
          type="number"
          label={t("schedules.field_required_daily")}
          placeholder={t("schedules.field_required_daily_hint")}
          value={value.requiredDailyMinutes == null ? "" : String(value.requiredDailyMinutes)}
          onValueChange={(v) => set("requiredDailyMinutes", v === "" ? null : Number(v) || 0)}
        />
      </div>

      <div className="flex flex-wrap items-center gap-6">
        <Switch isSelected={value.breakCountsAsWork} onValueChange={(v: boolean) => set("breakCountsAsWork", v)}>
          <span className="text-xs font-semibold">{t("schedules.field_break_counts_as_work")}</span>
        </Switch>
        {!compact && (
          <Switch
            isSelected={!!value.overtime?.enabled}
            onValueChange={(v: boolean) =>
              set("overtime", v ? { enabled: true, afterWorkMinutes: value.overtime?.afterWorkMinutes ?? 480 } : null)
            }
          >
            <span className="text-xs font-semibold">{t("schedules.field_overtime_enabled")}</span>
          </Switch>
        )}
        {!compact && (
          <Switch
            isSelected={!!value.flexibleStartWindow}
            onValueChange={(v: boolean) =>
              set("flexibleStartWindow", v ? ["13:00", "13:30"] : null)
            }
          >
            <span className="text-xs font-semibold">{t("schedules.field_flexible_window")}</span>
          </Switch>
        )}
      </div>

      {value.overtime?.enabled && (
        <Input
          type="number"
          label={t("schedules.field_overtime_after")}
          value={String(value.overtime.afterWorkMinutes)}
          onValueChange={(v) =>
            set("overtime", { enabled: true, afterWorkMinutes: Number(v) || 0 })
          }
          className="max-w-[240px]"
        />
      )}

      {value.flexibleStartWindow && (
        <div className="grid grid-cols-2 gap-4 max-w-[400px]">
          <Input
            type="time"
            label={t("schedules.field_window_from")}
            value={value.flexibleStartWindow[0]}
            onValueChange={(v) => set("flexibleStartWindow", [v, value.flexibleStartWindow![1]])}
          />
          <Input
            type="time"
            label={t("schedules.field_window_to")}
            value={value.flexibleStartWindow[1]}
            onValueChange={(v) => set("flexibleStartWindow", [value.flexibleStartWindow![0], v])}
          />
        </div>
      )}

      {!compact && (
        <Select
          {...selectFieldProps()}
          label={t("schedules.field_timezone")}
          selectedKeys={[value.timezone]}
          onSelectionChange={(k) => set("timezone", String(k))}
        >
          {TIMEZONE_OPTIONS.map((tz) => (
            <SelectItem key={tz}>{tz}</SelectItem>
          ))}
        </Select>
      )}

      <p className="text-xs text-default-400 font-medium">
        {t("schedules.derived_duration")}: {formatDurationHM(duration)}
      </p>
    </div>
  );
}
