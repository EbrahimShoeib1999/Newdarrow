/**
 * Monthly lateness report — always RE-DERIVED live from the attendance rows
 * (schedule snapshots where present, legacy lateMinutes otherwise), never a
 * stored aggregate, so a correction can't leave a stale number behind. The
 * legacy minutes column keeps the old cutoff basis honestly labeled.
 */
import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Chip,
  Input,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableColumn,
  TableHeader,
  TableRow,
} from "@heroui/react";
import { Download, BarChart3 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAppPermissions } from "@/features/companies/hooks/use-app-permissions";
import { useLatenessReportQuery } from "../hooks/use-work-schedule";
import { useAttendanceLatePolicyQuery } from "../hooks/use-people";
import { formatDurationHM, periodKeyOf } from "../lib/work-schedule-rules";

export default function LatenessReportPage() {
  const { t } = useTranslation("people");
  const { can } = useAppPermissions();
  const allowed = can("people.view_lateness") || can("people.view_all_attendance");
  // Default period follows the COMPANY period zone (Settings → Attendance),
  // not the browser clock, so "this month" agrees with the timesheets grid.
  // Stays UTC-derived until the policy loads; a manually chosen period is
  // never overwritten.
  const { data: latePolicyRes } = useAttendanceLatePolicyQuery();
  const companyTz = latePolicyRes?.data?.timezone;
  const [periodKey, setPeriodKey] = useState<string>(periodKeyOf(Date.now(), null));
  const [periodTouched, setPeriodTouched] = useState(false);
  useEffect(() => {
    if (!periodTouched && companyTz) {
      setPeriodKey(periodKeyOf(Date.now(), companyTz));
    }
  }, [companyTz, periodTouched]);
  const [search, setSearch] = useState("");

  const { data: rows, isLoading } = useLatenessReportQuery(allowed ? periodKey : "");

  const filtered = useMemo(() => {
    const src = rows ?? [];
    if (!search.trim()) return src;
    const q = search.trim().toLowerCase();
    return src.filter(
      (r) => r.employeeName.toLowerCase().includes(q) || r.department.toLowerCase().includes(q)
    );
  }, [rows, search]);

  if (!allowed) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] gap-4">
        <h2 className="text-2xl font-bold">{t("approvals.access_denied")}</h2>
        <p className="text-default-500">{t("approvals.no_permission")}</p>
      </div>
    );
  }

  const exportCsv = () => {
    const header = ["employee", "department", "total_minutes", "legacy_minutes", "excused_minutes", "cases", "deduction_total"];
    const lines = filtered.map((r) =>
      [
        `"${r.employeeName.replace(/"/g, '""')}"`,
        `"${r.department}"`,
        r.totalMinutes,
        r.legacyMinutes,
        r.excusedMinutes,
        r.cases.length,
        r.cases.reduce((s, c) => s + (c.amount ?? 0), 0),
      ].join(",")
    );
    const blob = new Blob(["\uFEFF" + [header.join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `lateness-${periodKey}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="w-full min-w-0 space-y-6 pb-12 animate-in fade-in duration-300">
      <div className="flex items-start gap-3 sm:items-center">
        <div className="p-3 bg-primary/10 text-primary rounded-2xl border border-primary/20 shadow-sm">
          <BarChart3 size={24} />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-black tracking-tight text-foreground">{t("report.title")}</h1>
          <p className="text-xs text-default-500 font-medium mt-0.5">{t("report.subtitle")}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Input
          size="sm"
          type="month"
          label={t("cases.col_period")}
          value={periodKey}
          onValueChange={(v) => {
            setPeriodTouched(true);
            setPeriodKey(v);
          }}
          className="w-44"
        />
        <Input
          size="sm"
          label={t("report.search")}
          value={search}
          onValueChange={setSearch}
          className="w-56"
        />
        <Button size="sm" variant="bordered" startContent={<Download size={14} />} onPress={exportCsv} isDisabled={filtered.length === 0}>
          {t("report.export")}
        </Button>
      </div>

      {isLoading ? (
        <Spinner className="m-8" />
      ) : (
        <div className="w-full overflow-x-auto rounded-2xl border border-default-200/80 bg-content1 shadow-sm">
          <Table aria-label="Monthly lateness report" className="min-w-[820px]" removeWrapper>
            <TableHeader>
              {[
                t("cases.col_employee"),
                t("schedules.col_department"),
                t("report.col_total"),
                t("report.col_legacy"),
                t("report.col_excused"),
                t("report.col_cases"),
                t("report.col_deduction_total"),
              ].map((label, i) => (
                <TableColumn key={`c${i}`} className="bg-default-50 text-default-500 font-bold text-xs py-4">
                  {label}
                </TableColumn>
              ))}
            </TableHeader>
            <TableBody items={filtered} emptyContent={t("report.empty")}>
              {(r) => (
                <TableRow key={r.employeeId} className="border-b border-default-50 last:border-0 hover:bg-default-50/50">
                  <TableCell className="py-4 font-bold text-sm">{r.employeeName}</TableCell>
                  <TableCell className="text-sm text-default-500">{r.department || "—"}</TableCell>
                  <TableCell className="text-sm tabular-nums">{formatDurationHM(r.totalMinutes)}</TableCell>
                  <TableCell className="text-sm tabular-nums">
                    {r.legacyMinutes > 0 ? (
                      <Chip size="sm" variant="flat" color="warning">
                        {formatDurationHM(r.legacyMinutes)} {t("report.legacy_badge")}
                      </Chip>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="text-sm tabular-nums text-default-500">
                    {r.excusedMinutes > 0 ? formatDurationHM(r.excusedMinutes) : "—"}
                  </TableCell>
                  <TableCell className="text-sm">{r.cases.length}</TableCell>
                  <TableCell className="text-sm tabular-nums font-bold">
                    {r.cases.reduce((s, c) => s + (c.amount ?? 0), 0) || "—"}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}

      <p className="text-xs text-default-400 font-medium">{t("report.derived_note")}</p>
    </div>
  );
}
