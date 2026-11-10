import { useState, useEffect, useMemo } from "react";
import {
  Card,
  CardBody,
  CardHeader,
  Button,
  Input,
  Select,
  SelectItem,
  Table,
  TableHeader,
  TableColumn,
  TableBody,
  TableRow,
  TableCell,
  Chip,
  Tabs,
  Tab,
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  useDisclosure,
} from "@heroui/react";
import {
  Building2,
  Users,
  ShieldCheck,
  Search,
  Globe2,
  AlertTriangle,
  History,
  CheckCircle2,
  ArrowRightLeft,
  RefreshCw,
} from "lucide-react";
import { useAuthStore } from "@/stores/auth.store";
import { useCompany } from "@/features/companies/context/company-context";
import { CompanyService } from "@/features/companies/api/company.service";
import { UsersService } from "@/features/users/api/users.service";
import { AuditLogService, type AuditLogEntry } from "../api/audit-log.service";
import type { CompanyProfile } from "@/features/companies/types/company.types";
import type { User, UserRole } from "@/features/auth/types/auth.types";
import { ROLE_LABELS } from "@/lib/permissions";

export function PlatformAdminDashboardPage() {
  const user = useAuthStore((s) => s.user);
  const { companyId: activeCompanyId, setCompanyId } = useCompany();

  const [companies, setCompanies] = useState<CompanyProfile[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Filters
  const [companySearch, setCompanySearch] = useState("");
  const [userSearch, setUserSearch] = useState("");
  const [userRoleFilter, setUserRoleFilter] = useState<string>("ALL");
  const [userStatusFilter, setUserStatusFilter] = useState<string>("ALL");
  const [userCompanyFilter, setUserCompanyFilter] = useState<string>("ALL");

  // Selected User for Editing
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [editRole, setEditRole] = useState<UserRole>("employee");
  const [isUpdatingUser, setIsUpdatingUser] = useState(false);
  const { isOpen, onOpen, onClose } = useDisclosure();

  const loadData = async () => {
    if (user?.role !== "platform_admin") return;
    setIsLoading(true);
    try {
      const [compRes, userList, logs] = await Promise.all([
        CompanyService.listAllCompanies(),
        UsersService.listAllPlatformUsers("platform_admin"),
        AuditLogService.listRecent(50),
      ]);
      setCompanies(compRes.data || []);
      setUsers(userList);
      setAuditLogs(logs);
    } catch (err) {
      console.error("Failed to load platform admin data:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [user]);

  // Derived metrics
  const totalCompanies = companies.length;
  const totalUsers = users.length;
  const activeCountries = useMemo(() => {
    const set = new Set<string>();
    companies.forEach((c) => {
      if (c.country) set.add(c.country);
    });
    users.forEach((u) => {
      if (u.country) set.add(u.country);
      if (Array.isArray(u.countryScope)) u.countryScope.forEach((cs) => set.add(cs));
    });
    return Array.from(set);
  }, [companies, users]);

  // Filtered companies
  const filteredCompanies = useMemo(() => {
    return companies.filter((c) => {
      const q = companySearch.toLowerCase();
      return (
        c.name.toLowerCase().includes(q) ||
        (c.commercialRegister && c.commercialRegister.includes(q)) ||
        (c.country && c.country.toLowerCase().includes(q)) ||
        (c.primaryActivity && c.primaryActivity.toLowerCase().includes(q))
      );
    });
  }, [companies, companySearch]);

  // Filtered users
  const filteredUsers = useMemo(() => {
    return users.filter((u) => {
      const q = userSearch.toLowerCase();
      const matchSearch =
        u.name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        (u.companyName && u.companyName.toLowerCase().includes(q));

      const matchRole = userRoleFilter === "ALL" || u.role === userRoleFilter;
      const status = (u as any).status || "active";
      const matchStatus = userStatusFilter === "ALL" || status === userStatusFilter;
      const matchCompany = userCompanyFilter === "ALL" || u.companyId === userCompanyFilter;

      return matchSearch && matchRole && matchStatus && matchCompany;
    });
  }, [users, userSearch, userRoleFilter, userStatusFilter, userCompanyFilter]);

  const handleSwitchCompanyContext = (company: CompanyProfile) => {
    setCompanyId(company.id);
    AuditLogService.record({
      actorUid: user?.id || "",
      actorEmail: user?.email,
      action: "SWITCH_COMPANY_CONTEXT",
      targetEntity: "company",
      targetId: company.id,
      companyId: company.id,
      details: { companyName: company.name },
      result: "SUCCESS",
    });
  };

  const handleOpenUserModal = (targetUser: User) => {
    setSelectedUser(targetUser);
    setEditRole(targetUser.role);
    onOpen();
  };

  const handleSaveUserChanges = async () => {
    if (!selectedUser) return;
    setIsUpdatingUser(true);
    try {
      if (editRole !== selectedUser.role) {
        await UsersService.updateUserRole(
          selectedUser.companyId || "",
          user?.id || "",
          "platform_admin",
          selectedUser.id,
          editRole
        );
        await AuditLogService.record({
          actorUid: user?.id || "",
          actorEmail: user?.email,
          action: "UPDATE_USER_ROLE",
          targetEntity: "user",
          targetId: selectedUser.id,
          companyId: selectedUser.companyId,
          details: { oldRole: selectedUser.role, newRole: editRole },
          result: "SUCCESS",
        });
      }
      onClose();
      await loadData();
    } catch (err) {
      console.error("Failed to update user:", err);
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setIsUpdatingUser(false);
    }
  };

  const handleUpdateStatus = async (targetUser: User, newStatus: "active" | "suspended" | "disabled") => {
    try {
      await UsersService.updateUserStatus("platform_admin", targetUser.id, newStatus, targetUser.companyId);
      await AuditLogService.record({
        actorUid: user?.id || "",
        actorEmail: user?.email,
        action: `USER_STATUS_${newStatus.toUpperCase()}`,
        targetEntity: "user",
        targetId: targetUser.id,
        companyId: targetUser.companyId,
        details: { newStatus },
        result: "SUCCESS",
      });
      await loadData();
    } catch (err) {
      console.error("Failed to update status:", err);
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  if (user?.role !== "platform_admin") {
    return (
      <div className="p-8 text-center max-w-lg mx-auto">
        <AlertTriangle className="w-12 h-12 text-danger mx-auto mb-4" />
        <h2 className="text-xl font-bold">Access Denied</h2>
        <p className="text-default-500 mt-2">
          This hub is restricted to Platform Administrators.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto p-4 md:p-6">
      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-gradient-to-r from-primary/10 via-primary/5 to-transparent p-6 rounded-2xl border border-primary/20">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-2 rounded-xl bg-primary/20 text-primary">
              <ShieldCheck className="w-6 h-6" />
            </span>
            <h1 className="text-2xl font-bold">Platform Administration Hub</h1>
            <Chip color="primary" variant="solid" size="sm">
              PLATFORM_ADMIN
            </Chip>
          </div>
          <p className="text-default-500 mt-1 text-sm">
            Cross-tenant control center, global user management, and administrative audit monitoring.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button
            size="sm"
            variant="flat"
            startContent={<RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />}
            onPress={loadData}
          >
            Refresh Data
          </Button>
          {activeCompanyId && (
            <Chip color="secondary" variant="flat" size="md">
              Active Context: {companies.find((c) => c.id === activeCompanyId)?.name || activeCompanyId}
            </Chip>
          )}
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border border-default-200/60 shadow-sm">
          <CardBody className="flex flex-row items-center gap-4 p-4">
            <div className="p-3 rounded-xl bg-primary/10 text-primary">
              <Building2 className="w-6 h-6" />
            </div>
            <div>
              <p className="text-xs text-default-500 font-medium">Total Companies</p>
              <h3 className="text-2xl font-bold">{totalCompanies}</h3>
            </div>
          </CardBody>
        </Card>

        <Card className="border border-default-200/60 shadow-sm">
          <CardBody className="flex flex-row items-center gap-4 p-4">
            <div className="p-3 rounded-xl bg-success/10 text-success">
              <Users className="w-6 h-6" />
            </div>
            <div>
              <p className="text-xs text-default-500 font-medium">Global Users</p>
              <h3 className="text-2xl font-bold">{totalUsers}</h3>
            </div>
          </CardBody>
        </Card>

        <Card className="border border-default-200/60 shadow-sm">
          <CardBody className="flex flex-row items-center gap-4 p-4">
            <div className="p-3 rounded-xl bg-warning/10 text-warning">
              <Globe2 className="w-6 h-6" />
            </div>
            <div>
              <p className="text-xs text-default-500 font-medium">Countries Covered</p>
              <h3 className="text-2xl font-bold">{activeCountries.length || 2}</h3>
            </div>
          </CardBody>
        </Card>

        <Card className="border border-default-200/60 shadow-sm">
          <CardBody className="flex flex-row items-center gap-4 p-4">
            <div className="p-3 rounded-xl bg-secondary/10 text-secondary">
              <History className="w-6 h-6" />
            </div>
            <div>
              <p className="text-xs text-default-500 font-medium">Audit Events</p>
              <h3 className="text-2xl font-bold">{auditLogs.length}</h3>
            </div>
          </CardBody>
        </Card>
      </div>

      {/* Main Tabs */}
      <Tabs aria-label="Platform Admin Sections" color="primary" variant="underlined">
        {/* TAB 1: Companies & Tenants */}
        <Tab
          key="companies"
          title={
            <div className="flex items-center gap-2">
              <Building2 className="w-4 h-4" />
              <span>Companies & Tenants ({companies.length})</span>
            </div>
          }
        >
          <Card className="border border-default-200/60 mt-4 shadow-sm">
            <CardHeader className="flex flex-col sm:flex-row justify-between gap-4 p-4">
              <Input
                placeholder="Search by company name, CR, country, activity..."
                startContent={<Search className="w-4 h-4 text-default-400" />}
                value={companySearch}
                onValueChange={setCompanySearch}
                size="sm"
                className="max-w-md"
              />
            </CardHeader>
            <CardBody className="p-0 overflow-x-auto">
              <Table aria-label="Companies Table" shadow="none">
                <TableHeader>
                  <TableColumn>COMPANY NAME</TableColumn>
                  <TableColumn>COMMERCIAL REGISTER</TableColumn>
                  <TableColumn>PRIMARY ACTIVITY</TableColumn>
                  <TableColumn>COUNTRY / CITY</TableColumn>
                  <TableColumn>CONTEXT ACTION</TableColumn>
                </TableHeader>
                <TableBody emptyContent="No companies registered">
                  {filteredCompanies.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell>
                        <div className="font-semibold">{c.name}</div>
                        <div className="text-xs text-default-400 font-mono">{c.id}</div>
                      </TableCell>
                      <TableCell>{c.commercialRegister || "—"}</TableCell>
                      <TableCell>
                        <Chip size="sm" variant="flat" color="primary">
                          {c.primaryActivity}
                        </Chip>
                      </TableCell>
                      <TableCell>{c.country || c.city || "Multi-Country"}</TableCell>
                      <TableCell>
                        {activeCompanyId === c.id ? (
                          <Chip size="sm" color="success" variant="flat">
                            Currently Active
                          </Chip>
                        ) : (
                          <Button
                            size="sm"
                            variant="flat"
                            color="secondary"
                            startContent={<ArrowRightLeft className="w-3.5 h-3.5" />}
                            onPress={() => handleSwitchCompanyContext(c)}
                          >
                            Switch to Tenant
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardBody>
          </Card>
        </Tab>

        {/* TAB 2: Global Users */}
        <Tab
          key="users"
          title={
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4" />
              <span>Global User Directory ({users.length})</span>
            </div>
          }
        >
          <Card className="border border-default-200/60 mt-4 shadow-sm">
            <CardHeader className="flex flex-wrap items-center justify-between gap-3 p-4">
              <Input
                placeholder="Search by user name, email, company..."
                startContent={<Search className="w-4 h-4 text-default-400" />}
                value={userSearch}
                onValueChange={setUserSearch}
                size="sm"
                className="w-full sm:w-64"
              />

              <div className="flex flex-wrap items-center gap-2">
                <Select
                  aria-label="Role Filter"
                  size="sm"
                  className="w-36"
                  selectedKeys={[userRoleFilter]}
                  onSelectionChange={(k) => setUserRoleFilter(Array.from(k as Set<string>)[0] || "ALL")}
                >
                  <SelectItem key="ALL">All Roles</SelectItem>
                  <SelectItem key="platform_admin">Platform Admin</SelectItem>
                  <SelectItem key="super_admin">Super Admin</SelectItem>
                  <SelectItem key="admin">Admin</SelectItem>
                  <SelectItem key="manager">Manager</SelectItem>
                  <SelectItem key="global_hr_manager">Global HR</SelectItem>
                  <SelectItem key="employee">Employee</SelectItem>
                  <SelectItem key="viewer">Viewer</SelectItem>
                </Select>

                <Select
                  aria-label="Status Filter"
                  size="sm"
                  className="w-32"
                  selectedKeys={[userStatusFilter]}
                  onSelectionChange={(k) => setUserStatusFilter(Array.from(k as Set<string>)[0] || "ALL")}
                >
                  <SelectItem key="ALL">All Status</SelectItem>
                  <SelectItem key="active">Active</SelectItem>
                  <SelectItem key="suspended">Suspended</SelectItem>
                  <SelectItem key="disabled">Disabled</SelectItem>
                </Select>

                <Select
                  aria-label="Company Filter"
                  size="sm"
                  className="w-40"
                  selectedKeys={[userCompanyFilter]}
                  onSelectionChange={(k) => setUserCompanyFilter(Array.from(k as Set<string>)[0] || "ALL")}
                >
                  {[
                    <SelectItem key="ALL">All Companies</SelectItem>,
                    ...companies.map((comp) => (
                      <SelectItem key={comp.id}>{comp.name}</SelectItem>
                    )),
                  ]}
                </Select>
              </div>
            </CardHeader>

            <CardBody className="p-0 overflow-x-auto">
              <Table aria-label="Global Users Table" shadow="none">
                <TableHeader>
                  <TableColumn>NAME & EMAIL</TableColumn>
                  <TableColumn>COMPANY</TableColumn>
                  <TableColumn>ROLE</TableColumn>
                  <TableColumn>ACCOUNT STATUS</TableColumn>
                  <TableColumn>MANAGEMENT ACTIONS</TableColumn>
                </TableHeader>
                <TableBody emptyContent="No users match the search">
                  {filteredUsers.map((u) => {
                    const status = (u as any).status || "active";
                    return (
                      <TableRow key={u.id}>
                        <TableCell>
                          <div className="font-semibold">{u.name}</div>
                          <div className="text-xs text-default-500">{u.email}</div>
                          <div className="text-[10px] text-default-400 font-mono">{u.id}</div>
                        </TableCell>
                        <TableCell>
                          {companies.find((c) => c.id === u.companyId)?.name || u.companyId || "—"}
                        </TableCell>
                        <TableCell>
                          <Chip
                            size="sm"
                            variant="flat"
                            color={
                              u.role === "platform_admin"
                                ? "danger"
                                : u.role === "super_admin" || u.role === "admin"
                                ? "primary"
                                : u.role === "global_hr_manager"
                                ? "secondary"
                                : "default"
                            }
                          >
                            {ROLE_LABELS[u.role]?.en || u.role}
                          </Chip>
                        </TableCell>
                        <TableCell>
                          <Chip
                            size="sm"
                            variant="dot"
                            color={
                              status === "active"
                                ? "success"
                                : status === "suspended"
                                ? "warning"
                                : "danger"
                            }
                          >
                            {status.toUpperCase()}
                          </Chip>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5">
                            <Button
                              size="sm"
                              variant="flat"
                              color="primary"
                              onPress={() => handleOpenUserModal(u)}
                            >
                              Edit Role
                            </Button>

                            {status === "active" ? (
                              <>
                                <Button
                                  size="sm"
                                  variant="light"
                                  color="warning"
                                  onPress={() => handleUpdateStatus(u, "suspended")}
                                >
                                  Suspend
                                </Button>
                                <Button
                                  size="sm"
                                  variant="light"
                                  color="danger"
                                  onPress={() => handleUpdateStatus(u, "disabled")}
                                >
                                  Disable
                                </Button>
                              </>
                            ) : (
                              <Button
                                size="sm"
                                variant="flat"
                                color="success"
                                startContent={<CheckCircle2 className="w-3.5 h-3.5" />}
                                onPress={() => handleUpdateStatus(u, "active")}
                              >
                                Reactivate
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardBody>
          </Card>
        </Tab>

        {/* TAB 3: Audit Trail */}
        <Tab
          key="audit"
          title={
            <div className="flex items-center gap-2">
              <History className="w-4 h-4" />
              <span>Audit Trail & Monitoring ({auditLogs.length})</span>
            </div>
          }
        >
          <Card className="border border-default-200/60 mt-4 shadow-sm">
            <CardHeader className="p-4">
              <h3 className="text-base font-semibold">Administrative Audit Trail</h3>
              <p className="text-xs text-default-500">
                Immutable, append-only security logs of Platform Administrator actions.
              </p>
            </CardHeader>
            <CardBody className="p-0 overflow-x-auto">
              <Table aria-label="Audit Logs Table" shadow="none">
                <TableHeader>
                  <TableColumn>TIMESTAMP</TableColumn>
                  <TableColumn>ACTION</TableColumn>
                  <TableColumn>OPERATOR</TableColumn>
                  <TableColumn>TARGET ENTITY</TableColumn>
                  <TableColumn>RESULT</TableColumn>
                </TableHeader>
                <TableBody emptyContent="No audit entries recorded yet">
                  {auditLogs.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell className="font-mono text-xs text-default-500">
                        {new Date(log.timestamp).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <Chip size="sm" variant="flat" color="primary">
                          {log.action}
                        </Chip>
                      </TableCell>
                      <TableCell className="text-xs">{log.actorEmail || log.actorUid}</TableCell>
                      <TableCell className="text-xs font-mono">
                        {log.targetEntity}: {log.targetId || "global"}
                      </TableCell>
                      <TableCell>
                        <Chip
                          size="sm"
                          variant="solid"
                          color={log.result === "SUCCESS" ? "success" : "danger"}
                        >
                          {log.result}
                        </Chip>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardBody>
          </Card>
        </Tab>
      </Tabs>

      {/* Edit Role Modal */}
      <Modal isOpen={isOpen} onClose={onClose}>
        <ModalContent>
          <ModalHeader>Update Role for {selectedUser?.name}</ModalHeader>
          <ModalBody>
            <p className="text-xs text-default-500 mb-2">
              Assign a platform or company role. Platform Administrator has cross-tenant rights.
            </p>
            <Select
              label="Select Role"
              selectedKeys={[editRole]}
              onSelectionChange={(k) => setEditRole(Array.from(k as Set<string>)[0] as UserRole)}
            >
              <SelectItem key="super_admin">Super Admin (Company Level)</SelectItem>
              <SelectItem key="admin">Admin (Company Level)</SelectItem>
              <SelectItem key="manager">Manager</SelectItem>
              <SelectItem key="global_hr_manager">Global HR Manager</SelectItem>
              <SelectItem key="employee">Employee</SelectItem>
              <SelectItem key="viewer">Viewer</SelectItem>
            </Select>
          </ModalBody>
          <ModalFooter>
            <Button variant="light" onPress={onClose}>
              Cancel
            </Button>
            <Button color="primary" isLoading={isUpdatingUser} onPress={handleSaveUserChanges}>
              Save Role
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}

export default PlatformAdminDashboardPage;
