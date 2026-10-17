import type { Employee, LeaveRequest } from "@/features/people/types/people.types";
import type { Task } from "@/features/tasks/types/task.types";

export interface SmartMatchResult {
  employee: Employee;
  score: number;
  matchLevel: "best" | "good" | "available" | "overloaded" | "on_leave";
  workload: number;
  isOnLeave: boolean;
  reasons: string[];
  warning?: string;
}

export interface SmartAssignmentReport {
  targetDepartment?: string;
  totalActiveEmployees: number;
  recommendedCandidates: SmartMatchResult[];
  otherCandidates: SmartMatchResult[];
  explanation: string;
}

/**
 * Normalizes text for lenient keyword matching (removes Arabic diacritics, prefixes, etc.)
 */
function normalizeText(text: string): string {
  if (!text) return "";
  return text
    .toLowerCase()
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/[^\w\s\u0600-\u06FF]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Checks if an employee is on approved leave today.
 */
function isEmployeeOnLeave(employee: Employee, leaveRequests?: LeaveRequest[]): boolean {
  if (!leaveRequests || leaveRequests.length === 0) return false;
  const now = new Date();

  return leaveRequests.some((req) => {
    if (req.employeeId !== employee.id && req.employeeId !== employee.userId) return false;
    if (req.status !== "approved") return false;

    const start = req.startDate instanceof Date ? req.startDate : new Date(req.startDate as any);
    const end = req.endDate instanceof Date ? req.endDate : new Date(req.endDate as any);

    return now >= start && now <= end;
  });
}

/**
 * Calculates the current active task count (workload) for an employee.
 */
function calculateWorkload(employee: Employee, allTasks?: Task[]): number {
  if (!allTasks || allTasks.length === 0) return 0;
  return allTasks.filter(
    (t) =>
      (t.assigneeId === employee.userId || t.assigneeId === employee.id) &&
      t.status !== "done"
  ).length;
}

/**
 * Evaluates and ranks employees for a given task based on:
 * 1. Active status (inactive employees flagged/deprioritized)
 * 2. Department match
 * 3. Job title / role relevance
 * 4. Documented skills match
 * 5. Current workload balancing
 * 6. Leave / absence status
 */
export function getSmartTaskRecommendations(
  task: {
    title: string;
    department?: string;
    tags?: string[];
    description?: string;
  },
  employees: Employee[],
  allTasks: Task[] = [],
  leaveRequests: LeaveRequest[] = []
): SmartAssignmentReport {
  const normTaskDept = normalizeText(task.department || "");
  const normTaskTitle = normalizeText(task.title || "");
  const taskKeywords = new Set([
    ...normTaskTitle.split(" ").filter((w) => w.length > 2),
    ...(task.tags || []).map(normalizeText).filter(Boolean),
  ]);

  const activeEmployees = employees.filter((e) => e.status === "active");

  const results: SmartMatchResult[] = activeEmployees.map((employee) => {
    let score = 0;
    const reasons: string[] = [];
    let warning: string | undefined;

    const normEmpDept = normalizeText(employee.department || "");
    const normJobTitle = normalizeText(employee.jobTitle || "");
    const workload = calculateWorkload(employee, allTasks);
    const onLeave = isEmployeeOnLeave(employee, leaveRequests);

    // 1. Department Match
    if (normTaskDept && normEmpDept) {
      if (normEmpDept === normTaskDept || normEmpDept.includes(normTaskDept) || normTaskDept.includes(normEmpDept)) {
        score += 45;
        reasons.push(`مطابقة القسم: ${employee.department}`);
      }
    }

    // 2. Job Title Keyword Match
    let jobMatchFound = false;
    for (const kw of taskKeywords) {
      if (normJobTitle.includes(kw)) {
        jobMatchFound = true;
        break;
      }
    }
    if (jobMatchFound) {
      score += 25;
      reasons.push(`المسمى الوظيفي متوافق: ${employee.jobTitle}`);
    }

    // 3. Skills Match
    if (employee.skills && employee.skills.length > 0) {
      for (const skill of employee.skills) {
        const normSkill = normalizeText(skill.name);
        for (const kw of taskKeywords) {
          if (normSkill.includes(kw) || kw.includes(normSkill)) {
            const levelBonus = Math.min(skill.level || 1, 5) * 3;
            score += 20 + levelBonus;
            reasons.push(`يمتلك مهارة: ${skill.name} (المستوى ${skill.level || 1}/5)`);
            break;
          }
        }
      }
    }

    // 4. Workload Balancing
    if (workload === 0) {
      score += 15;
      reasons.push("متاح بالكامل (لا توجد مهام نشطة حالياً)");
    } else if (workload <= 3) {
      score += 10;
      reasons.push(`عبء عمل خفيف (${workload} مهام نشطة)`);
    } else if (workload <= 5) {
      score += 5;
      reasons.push(`عبء عمل معتدل (${workload} مهام نشطة)`);
    } else {
      score -= 15;
      warning = `لديه عبء عمل مرتفع (${workload} مهام نشطة)`;
    }

    // 5. Leave Status
    if (onLeave) {
      score -= 30;
      warning = "الموظف في إجازة رسمية معتمدة حالياً";
    }

    // Determine match level
    let matchLevel: SmartMatchResult["matchLevel"] = "available";
    if (onLeave) {
      matchLevel = "on_leave";
    } else if (workload > 5) {
      matchLevel = "overloaded";
    } else if (score >= 60) {
      matchLevel = "best";
    } else if (score >= 35) {
      matchLevel = "good";
    }

    return {
      employee,
      score: Math.max(0, score),
      matchLevel,
      workload,
      isOnLeave: onLeave,
      reasons,
      warning,
    };
  });

  // Sort candidates by score (desc), then workload (asc)
  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.workload - b.workload;
  });

  const recommendedCandidates = results.filter(
    (r) => r.matchLevel === "best" || r.matchLevel === "good"
  );
  const otherCandidates = results.filter(
    (r) => r.matchLevel !== "best" && r.matchLevel !== "good"
  );

  let explanation = "";
  if (recommendedCandidates.length > 0) {
    explanation = `تم العثور على ${recommendedCandidates.length} مرشحين متطابقين مع قسم "${task.department || "المهام"}" وتخصص المهمة.`;
  } else if (task.department) {
    explanation = `لم يتم العثور على موظف متطابق تلقائياً في قسم "${task.department}". يمكنك التعيين اليدوي أو تحديث تخصصات الموظفين.`;
  } else {
    explanation = "المهمة غير مقترنة بقسم محدد، تم ترتيب الموظفين بحسب عبء العمل والمهارات.";
  }

  return {
    targetDepartment: task.department,
    totalActiveEmployees: activeEmployees.length,
    recommendedCandidates,
    otherCandidates,
    explanation,
  };
}
