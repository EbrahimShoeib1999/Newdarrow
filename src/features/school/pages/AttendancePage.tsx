import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Card, CardBody, Chip, Select, SelectItem } from "@heroui/react";
import { ClipboardCheck } from "lucide-react";
import { Input } from "@heroui/react";
import { selectFieldProps } from "@/components/shared/select-field";
import { useAppPermissions } from "@/features/companies/hooks/use-app-permissions";
import { useSections, useStudents, useAttendanceForSection, useMarkAttendance } from "../hooks/use-school";
import type { AttendanceMark } from "../types/school.types";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

const MARKS: AttendanceMark[] = ["present", "absent", "late", "excused"];

const MARK_COLORS: Record<AttendanceMark, "success" | "danger" | "warning" | "default"> = {
  present: "success", absent: "danger", late: "warning", excused: "default",
};

export function AttendancePage() {
  const { t } = useTranslation("school");
  const { can } = useAppPermissions();
  const canMark = can("school.mark_attendance");

  const { data: sections = [] } = useSections();
  const { data: students = [] } = useStudents();

  const [sectionId, setSectionId] = useState("");
  const [date, setDate] = useState(todayIso());

  const { data: existingAttendance = [] } = useAttendanceForSection(
    sectionId || null,
    date,
  );
  const markMut = useMarkAttendance();

  // Students enrolled in the selected section.
  const sectionStudents = useMemo(
    () => students.filter((s) => s.sectionId === sectionId && s.status === "enrolled"),
    [students, sectionId],
  );

  // Map studentId → current mark from already-saved attendance rows.
  const markMap = useMemo(() => {
    const m = new Map<string, AttendanceMark>();
    for (const a of existingAttendance) m.set(a.studentId, a.mark);
    return m;
  }, [existingAttendance]);

  const getMark = (studentId: string): AttendanceMark | undefined => markMap.get(studentId);

  const markFor = (studentId: string, mark: AttendanceMark) => {
    if (!canMark) return;
    markMut.mutate({ date, sectionId, studentId, mark, note: null });
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-default-900 flex items-center gap-2">
          <ClipboardCheck className="w-6 h-6 text-primary" />{t("attendancePage.title")}
        </h1>
        <p className="text-sm text-default-500 mt-1">{t("attendancePage.subtitle")}</p>
      </div>

      <div className="flex gap-4 flex-wrap items-end">
        <Select {...selectFieldProps()} label={t("attendancePage.sectionLabel")}
          selectedKeys={sectionId ? [sectionId] : []}
          onSelectionChange={(keys) => { const v = Array.from(keys)[0] as string | undefined; setSectionId(v ?? ""); }}
          className="w-56">
          {sections.map((s) => <SelectItem key={s.id} textValue={s.name}>{s.name}</SelectItem>)}
        </Select>
        <Input type="date" label={t("attendancePage.dateLabel")} value={date}
          onValueChange={setDate} className="w-48" max={todayIso()} />
      </div>

      {!sectionId ? (
        <Card>
          <CardBody className="py-10 text-center text-sm text-default-400">
            {t("attendancePage.noSectionSelected")}
          </CardBody>
        </Card>
      ) : sectionStudents.length === 0 ? (
        <Card>
          <CardBody className="py-10 text-center text-sm text-default-400">
            {t("attendancePage.noStudentsInSection")}
          </CardBody>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <CardBody className="p-0 overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-default-200 bg-default-50/80 text-xs font-semibold uppercase tracking-wide text-default-500">
                  <th className="px-4 py-2.5 text-start">{t("fields.name")}</th>
                  <th className="px-4 py-2.5 text-start">{t("fields.identifier")}</th>
                  <th className="px-4 py-2.5 text-start">{t("fields.mark")}</th>
                  {canMark && <th className="px-4 py-2.5 text-start">{t("fields.mark")}</th>}
                </tr>
              </thead>
              <tbody>
                {sectionStudents.map((s) => {
                  const current = getMark(s.id);
                  return (
                    <tr key={s.id} className="border-b border-default-100 last:border-0">
                      <td className="px-4 py-2.5 font-medium text-default-800">{s.name}</td>
                      <td className="px-4 py-2.5 text-default-600">{s.identifier ?? "—"}</td>
                      <td className="px-4 py-2.5">
                        {current ? (
                          <Chip size="sm" variant="flat" color={MARK_COLORS[current]}>
                            {t(`attendanceMark.${current}`)}
                          </Chip>
                        ) : (
                          <span className="text-default-400 text-xs">—</span>
                        )}
                      </td>
                      {canMark && (
                        <td className="px-4 py-2.5">
                          <div className="flex gap-1 flex-wrap">
                            {MARKS.map((m) => (
                              <Button key={m} size="sm"
                                variant={current === m ? "solid" : "bordered"}
                                color={current === m ? MARK_COLORS[m] : "default"}
                                isLoading={markMut.isPending && markMut.variables?.studentId === s.id && (markMut.variables as { mark?: AttendanceMark }).mark === m}
                                onPress={() => markFor(s.id, m)}>
                                {t(`attendanceMark.${m}`)}
                              </Button>
                            ))}
                          </div>
                          {current && (
                            <p className="text-xs text-default-400 mt-1">{t("attendancePage.alreadyMarked")}</p>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
