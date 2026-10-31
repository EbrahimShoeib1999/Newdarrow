import { useQuery } from "@tanstack/react-query";
import { useTasksStore } from "@/stores/tasks.store";
import { toast } from "sonner";
import type { User } from "@/features/auth/types/auth.types";
import { mapFirestoreUser } from "@/features/auth/utils/map-user";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useCompany } from "@/features/companies/context/company-context";
import { useAuthStore } from "@/stores/auth.store";
import { UsersService } from "@/features/users/api/users.service";
import i18n from "@/lib/i18n";

export function useAllUsers() {
  const { setAvailableUsers, setLoadingUsers } = useTasksStore();
  const { companyId } = useCompany();

  return useQuery({
    queryKey: ["users", "all", companyId],
    queryFn: async () => {
      if (!companyId) return [];
      setLoadingUsers(true);
      try {
        const usersRef = collection(db, "users");
        const q = query(
          usersRef, 
          where("companyId", "==", companyId)
        );
        const querySnapshot = await getDocs(q);
        
        const users: User[] = querySnapshot.docs.map((docSnap) =>
          mapFirestoreUser(docSnap.id, docSnap.data() as Record<string, unknown>)
        );

        // Client-side sorting to avoid index requirement during development
        users.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
        
        setAvailableUsers(users);
        return users;
      } catch (error) {
        console.error("Failed to fetch users:", error);
        toast.error(i18n.t("toast.users_load_failed", { ns: "people" }));
        throw error;
      } finally {
        setLoadingUsers(false);
      }
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    enabled: !!companyId,
  });
}

export function useUsersByRole(role?: string) {
  const query = useAllUsers();
  
  return {
    ...query,
    data: role ? query.data?.filter((user: User) => user.role === role) : query.data,
  };
}

export function useActiveUsers() {
  const query = useAllUsers();
  
  return {
    ...query,
    data: query.data?.filter((user: User) => (user.role as string) !== 'inactive'),
  };
}

/**
 * Reconciliation view (mission 1.3): surfaces accounts that carry no tenant so
 * a platform super admin can review/assign them. Disabled for every other role
 * (the underlying query is super-admin gated in both the service and rules).
 * Read-only — it never deletes or recreates orphan accounts.
 */
export function useUnassignedAccounts() {
  const role = useAuthStore((s) => s.user?.role);
  const isSuperAdmin = role === "super_admin";

  return useQuery({
    queryKey: ["users", "unassigned"],
    queryFn: async () => {
      try {
        return await UsersService.listUnassignedAccounts("super_admin");
      } catch (error) {
        console.error("Failed to fetch unassigned accounts:", error);
        toast.error(i18n.t("toast.users_load_failed", { ns: "people" }));
        throw error;
      }
    },
    enabled: isSuperAdmin,
    staleTime: 5 * 60 * 1000,
  });
}
