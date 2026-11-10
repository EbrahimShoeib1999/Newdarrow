import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
  type Firestore,
} from "firebase/firestore";
import type { PortalId } from "../../../lib/portal-permissions";
import { parsePortalSubRoles } from "../../../lib/permissions/sub-roles";
import type { User, UserRole } from "../types/auth.types";

interface AuthenticatedInvitee {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
}

interface InviteRecord {
  token: string;
  email: string;
  role: UserRole;
  companyId: string;
  companyName: string;
  status: string;
  expiresAt: unknown;
  employeeId?: string;
  portalAccess?: unknown;
  portalSubRoles?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function inviteError(code: string): Error {
  return new Error(code);
}

async function traceFirestoreOperation<T>(
  operation: "get" | "list" | "create" | "update",
  path: string,
  uid: string,
  perform: () => Promise<T>
): Promise<T> {
  const context = {
    operation,
    path,
    authenticated: Boolean(uid),
  };
  console.info("[AuthService:acceptInvite] Firestore operation started", context);
  try {
    const result = await perform();
    console.info("[AuthService:acceptInvite] Firestore operation succeeded", context);
    return result;
  } catch (error) {
    const code = isRecord(error) && typeof error.code === "string" ? error.code : "unknown";
    console.error("[AuthService:acceptInvite] Firestore operation failed", {
      ...context,
      code,
    });
    throw error;
  }
}

function toDate(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (isRecord(value) && typeof value.toDate === "function") {
    const result = value.toDate();
    return result instanceof Date ? result : null;
  }
  if (typeof value === "string") {
    const result = new Date(value);
    return Number.isNaN(result.getTime()) ? null : result;
  }
  return null;
}

function parseInvite(token: string, value: unknown): InviteRecord | null {
  if (!isRecord(value)) return null;
  return {
    token: typeof value.token === "string" ? value.token : token,
    email: typeof value.email === "string" ? value.email.trim().toLowerCase() : "",
    role: (typeof value.role === "string" ? value.role : "employee") as UserRole,
    companyId: typeof value.companyId === "string" ? value.companyId : "",
    companyName: typeof value.companyName === "string" ? value.companyName : "",
    status: typeof value.status === "string" ? value.status : "",
    expiresAt: value.expiresAt,
    employeeId: typeof value.employeeId === "string" ? value.employeeId : undefined,
    portalAccess: value.portalAccess,
    portalSubRoles: value.portalSubRoles,
  };
}

function isAllowedEmployeeRole(role: UserRole): boolean {
  return ["employee", "viewer", "manager", "global_hr_manager"].includes(role);
}

/**
 * Completes the authenticated invitation using the existing Auth UID. Profile
 * staging is deliberately inert: pending profiles cannot access tenant data or
 * start attendance. The employee link and invite consumption commit together.
 */
export async function acceptInvitationForUser(
  firestore: Firestore,
  user: AuthenticatedInvitee,
  token: string,
  suppliedName?: string
): Promise<User> {
  const email = user.email?.trim().toLowerCase() ?? "";
  if (!user.uid || !email) throw inviteError("INVITE_AUTH_REQUIRED");

  const inviteRef = doc(firestore, "invites", token);
  const inviteSnap = await traceFirestoreOperation(
    "get",
    "invites/{token}",
    user.uid,
    () => getDoc(inviteRef)
  );
  if (!inviteSnap.exists()) throw inviteError("INVITE_NOT_FOUND");
  const invite = parseInvite(inviteSnap.id, inviteSnap.data());
  if (!invite || invite.token !== inviteSnap.id) throw inviteError("INVITE_INVALID");
  if (invite.status === "accepted") throw inviteError("INVITE_ACCEPTED");
  if (invite.status !== "pending") throw inviteError("INVITE_INVALID");
  const expiry = toDate(invite.expiresAt);
  if (!expiry || expiry.getTime() <= Date.now()) throw inviteError("INVITE_EXPIRED");
  if (invite.email !== email) throw inviteError("INVITE_EMAIL_MISMATCH");
  if (!invite.companyId || !isAllowedEmployeeRole(invite.role)) {
    throw inviteError("INVITE_ROLE_INVALID");
  }

  const userRef = doc(firestore, "users", user.uid);
  const existingUserSnap = await traceFirestoreOperation(
    "get",
    "users/{auth.uid}",
    user.uid,
    () => getDoc(userRef)
  );
  const existingUser = existingUserSnap.data() ?? {};
  const existingCompanyId =
    typeof existingUser.companyId === "string" ? existingUser.companyId.trim() : "";
  if (existingCompanyId && existingCompanyId !== invite.companyId) {
    throw inviteError(
      "COMPANY_CONFLICT: This account already belongs to another company."
    );
  }
  const existingInviteToken =
    typeof existingUser.invitationToken === "string" ? existingUser.invitationToken : "";
  if (
    existingUser.onboardingStatus === "pending" &&
    existingInviteToken &&
    existingInviteToken !== token
  ) {
    throw inviteError("INVITE_ONBOARDING_IN_PROGRESS");
  }

  const name =
    (typeof existingUser.name === "string" && existingUser.name.trim()) ||
    suppliedName?.trim() ||
    user.displayName?.trim() ||
    email.split("@")[0] ||
    "User";
  const profile = {
    ...existingUser,
    id: user.uid,
    email,
    name,
    nameAr: typeof existingUser.nameAr === "string" ? existingUser.nameAr : "",
    avatar:
      user.photoURL ||
      (typeof existingUser.avatar === "string" ? existingUser.avatar : "") ||
      `https://avatar.vercel.sh/${user.uid}`,
    role: invite.role,
    companyId: invite.companyId,
    companyName: invite.companyName,
    portalAccess: Array.isArray(invite.portalAccess) ? invite.portalAccess : [],
    portalSubRoles: isRecord(invite.portalSubRoles) ? invite.portalSubRoles : {},
    invitationToken: token,
    onboardingStatus: "pending",
    updatedAt: serverTimestamp(),
    ...(existingUserSnap.exists() ? {} : { createdAt: serverTimestamp() }),
    ...(existingUserSnap.exists() || existingUser.customPermissions !== undefined
      ? {}
      : { customPermissions: [] }),
  };

  await traceFirestoreOperation(
    existingUserSnap.exists() ? "update" : "create",
    "users/{auth.uid}",
    user.uid,
    () => setDoc(userRef, profile, { merge: true })
  );

  let employeeId = invite.employeeId || "";
  let employeeData: Record<string, unknown> | null = null;
  if (!employeeId) {
    const employeesRef = collection(firestore, "companies", invite.companyId, "employees");
    const matchingEmployees = await traceFirestoreOperation(
      "list",
      "companies/{invite.companyId}/employees",
      user.uid,
      () => getDocs(query(employeesRef, where("email", "==", email)))
    );
    if (matchingEmployees.size > 1) throw inviteError("INVITE_EMPLOYEE_AMBIGUOUS");
    if (!matchingEmployees.empty) {
      const match = matchingEmployees.docs[0];
      employeeId = match.id;
      employeeData = match.data();
    } else {
      employeeId = user.uid;
    }
  }

  if (invite.employeeId && !employeeData) {
    const employeeRef = doc(
      firestore,
      "companies",
      invite.companyId,
      "employees",
      employeeId
    );
    const employeeSnap = await traceFirestoreOperation(
      "get",
      "companies/{invite.companyId}/employees/{invite.employeeId}",
      user.uid,
      () => getDoc(employeeRef)
    );
    if (!employeeSnap.exists()) throw inviteError("INVITE_EMPLOYEE_NOT_FOUND");
    employeeData = employeeSnap.data();
  }

  if (employeeData) {
    const employeeEmail =
      typeof employeeData.email === "string" ? employeeData.email.trim().toLowerCase() : "";
    if (
      employeeEmail !== email ||
      (employeeData.companyId && employeeData.companyId !== invite.companyId) ||
      (employeeData.userId && employeeData.userId !== user.uid) ||
      (employeeData.role && employeeData.role !== invite.role)
    ) {
      throw inviteError("INVITE_EMPLOYEE_MISMATCH");
    }
  }

  const employeeRef = doc(
    firestore,
    "companies",
    invite.companyId,
    "employees",
    employeeId
  );
  const batch = writeBatch(firestore);
  batch.update(userRef, {
    onboardingStatus: "active",
    updatedAt: serverTimestamp(),
  });
  batch.set(
    employeeRef,
    employeeData || invite.employeeId
      ? {
          userId: user.uid,
          updatedAt: serverTimestamp(),
        }
      : {
          id: employeeId,
          userId: user.uid,
          companyId: invite.companyId,
          email,
          name,
          firstName: name.split(/\s+/)[0] || "User",
          lastName: name.split(/\s+/).slice(1).join(" "),
          role: invite.role,
          status: "active",
          workMode: "remote",
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
    { merge: true }
  );
  batch.update(inviteRef, {
    status: "accepted",
    acceptedAt: serverTimestamp(),
    acceptedBy: user.uid,
    employeeId,
  });

  await traceFirestoreOperation(
    "update",
    "users/{auth.uid}, companies/{invite.companyId}/employees/{employeeId}, invites/{token}",
    user.uid,
    () => batch.commit()
  );

  const allowedPortals = new Set<PortalId>(["tasks", "crm", "people", "billing", "chat"]);
  const portalAccess = Array.isArray(profile.portalAccess)
    ? profile.portalAccess.filter(
        (portal): portal is PortalId =>
          typeof portal === "string" && allowedPortals.has(portal as PortalId)
      )
    : undefined;
  return {
    id: user.uid,
    email,
    name,
    nameAr: typeof profile.nameAr === "string" ? profile.nameAr : "",
    avatar: typeof profile.avatar === "string" ? profile.avatar : "",
    role: invite.role,
    companyId: invite.companyId,
    companyName: invite.companyName,
    portalAccess: portalAccess?.length ? portalAccess : undefined,
    portalSubRoles: parsePortalSubRoles(profile.portalSubRoles),
  };
}
