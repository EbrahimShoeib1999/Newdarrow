import { doc, getDoc, setDoc, serverTimestamp, deleteField } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { ApiResponse } from "@/types/api.types";
import { withLogging } from "@/lib/service-utils";
import type {
  ProjectSettings,
  ProjectTerminology,
} from "../schemas/project-settings.schema";

const SERVICE_NAME = "ProjectSettingsService";

/**
 * Tenant-scoped project settings live on companies/{companyId}/settings/projects
 * — the same settings-document precedent used by billing. Merged writes keep the
 * project code sequence untouched when only terminology changes.
 */
export const ProjectSettingsService = {
  async get(companyId: string): Promise<ApiResponse<ProjectSettings>> {
    return withLogging(SERVICE_NAME, "get", (async () => {
      const snap = await getDoc(doc(db, "companies", companyId, "settings", "projects"));
      if (!snap.exists()) return { data: {}, message: "Defaults" };
      const data = snap.data() as Record<string, unknown>;
      return {
        data: { terminology: data.terminology as ProjectTerminology | undefined },
        message: "Success",
      };
    })());
  },

  async updateTerminology(
    companyId: string,
    terminology: ProjectTerminology | null
  ): Promise<ApiResponse<ProjectSettings>> {
    return withLogging(SERVICE_NAME, "updateTerminology", (async () => {
      await setDoc(
        doc(db, "companies", companyId, "settings", "projects"),
        {
          terminology: terminology ?? deleteField(),
          terminologyUpdatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      return {
        data: { terminology: terminology ?? undefined },
        message: "Settings saved",
      };
    })());
  },
};
