import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Card, CardBody, Chip } from "@heroui/react";
import { GraduationCap, Users, UserRound, Layers, BookA, ClipboardCheck, Lock } from "lucide-react";
import { useStudents, useSections, useSubjects } from "../hooks/use-school";

export function SchoolDashboardPage() {
  const { t } = useTranslation("school");
  const { data: students = [], isLoading } = useStudents();
  const { data: sections = [] } = useSections();
  const { data: subjects = [] } = useSubjects();

  const stats = useMemo(() => ({
    total: students.length,
    enrolled: students.filter((s) => s.status === "enrolled").length,
    pending: students.filter((s) => s.status === "pending").length,
    sections: sections.length,
    subjects: subjects.length,
  }), [students, sections, subjects]);

  const kpis = [
    { label: t("dashboard.totalStudents"), value: String(stats.total), icon: GraduationCap, to: "/school/students" },
    { label: t("dashboard.enrolledStudents"), value: String(stats.enrolled), icon: UserRound, to: "/school/students?status=enrolled" },
    { label: t("dashboard.pendingStudents"), value: String(stats.pending), icon: Users, to: "/school/students?status=pending" },
    { label: t("dashboard.totalSections"), value: String(stats.sections), icon: Layers, to: "/school/sections" },
    { label: t("dashboard.totalSubjects"), value: String(stats.subjects), icon: BookA, to: "/school/subjects" },
  ];

  const upcoming = [
    { label: t("dashboard.examsResults"), icon: ClipboardCheck },
    { label: t("dashboard.timetables"), icon: Lock },
    { label: t("dashboard.fees"), icon: Lock },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-default-900 flex items-center gap-2">
          <GraduationCap className="w-6 h-6 text-primary" />
          {t("dashboard.title")}
        </h1>
        <p className="text-sm text-default-500 mt-1">{t("dashboard.subtitle")}</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        {kpis.map((kpi) => (
          <Link key={kpi.label} to={kpi.to}>
            <Card className="border border-default-100 hover:border-primary/40 transition-colors">
              <CardBody className="p-4 gap-1">
                <div className="flex items-center gap-2 text-default-400">
                  <kpi.icon className="w-4 h-4" />
                  <span className="text-xs">{kpi.label}</span>
                </div>
                <span className="text-2xl font-bold text-default-900 tabular-nums">
                  {isLoading ? "—" : kpi.value}
                </span>
              </CardBody>
            </Card>
          </Link>
        ))}
      </div>

      {/* v1 scope boundary — these workflows are planned but not yet shipped. */}
      <Card className="border border-default-100">
        <CardBody className="gap-3">
          <p className="text-sm font-semibold text-default-700">{t("dashboard.comingSoon")}</p>
          <div className="flex flex-wrap gap-3">
            {upcoming.map((item) => (
              <Chip key={item.label} variant="flat" size="sm" startContent={<item.icon className="w-3 h-3" />}>
                {item.label}
              </Chip>
            ))}
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
