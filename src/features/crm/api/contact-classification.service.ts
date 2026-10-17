import {
  collection,
  getDocs,
  getDoc,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { ApiResponse } from "@/types/api.types";
import { withLogging } from "@/lib/service-utils";
import type {
  ContactClassificationItem,
  CreateClassificationDTO,
  UpdateClassificationDTO,
} from "../types/classification.types";

const SERVICE_NAME = "ContactClassificationService";

export const DEFAULT_CLASSIFICATIONS: ContactClassificationItem[] = [
  {
    id: "default-actual-client",
    key: "actual_client",
    nameAr: "عميل فعلي",
    nameEn: "Actual Client",
    color: "success",
    emoji: "🟢",
    isDefault: true,
    isActive: true,
    isArchived: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "default-potential-lead",
    key: "potential_lead",
    nameAr: "عميل محتمل",
    nameEn: "Potential Lead",
    color: "warning",
    emoji: "🟡",
    isDefault: true,
    isActive: true,
    isArchived: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "default-callback",
    key: "callback",
    nameAr: "معاودة الاتصال",
    nameEn: "Callback",
    color: "primary",
    emoji: "🔵",
    isDefault: true,
    isActive: true,
    isArchived: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

export const ContactClassificationService = {
  async getClassifications(
    companyId: string
  ): Promise<ApiResponse<ContactClassificationItem[]>> {
    return withLogging(SERVICE_NAME, "getClassifications", (async () => {
      if (!companyId) {
        return { data: DEFAULT_CLASSIFICATIONS, message: "Defaults used" };
      }

      const collRef = collection(
        db,
        "companies",
        companyId,
        "contact_classifications"
      );
      const snapshot = await getDocs(collRef);

      if (snapshot.empty) {
        return {
          data: DEFAULT_CLASSIFICATIONS,
          message: "Standard default classifications",
        };
      }

      const list: ContactClassificationItem[] = snapshot.docs.map((d) => {
        const raw = d.data();
        return {
          id: d.id,
          key: raw.key || d.id,
          nameAr: raw.nameAr || raw.label || raw.name || "",
          nameEn: raw.nameEn || raw.nameAr || raw.label || "",
          color: raw.color || "primary",
          isDefault: Boolean(raw.isDefault),
          isArchived: Boolean(raw.isArchived),
          createdAt:
            raw.createdAt instanceof Timestamp
              ? raw.createdAt.toDate().toISOString()
              : raw.createdAt || new Date().toISOString(),
          updatedAt:
            raw.updatedAt instanceof Timestamp
              ? raw.updatedAt.toDate().toISOString()
              : raw.updatedAt || new Date().toISOString(),
        };
      });

      // Ensure standard keys exist in returned array so legacy records always resolve
      const existingKeys = new Set(list.map((c) => c.key));
      const merged = [...list];
      for (const def of DEFAULT_CLASSIFICATIONS) {
        if (!existingKeys.has(def.key)) {
          merged.push(def);
        }
      }

      return {
        data: merged,
        message: "Classifications loaded successfully",
      };
    })());
  },

  async createClassification(
    companyId: string,
    data: CreateClassificationDTO
  ): Promise<ApiResponse<ContactClassificationItem>> {
    return withLogging(SERVICE_NAME, "createClassification", (async () => {
      const collRef = collection(
        db,
        "companies",
        companyId,
        "contact_classifications"
      );

      const normalizedKey = (data.key || data.nameEn || data.nameAr)
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9\u0600-\u06FF]+/g, "_");

      const docRef = await addDoc(collRef, {
        ...data,
        key: normalizedKey,
        isArchived: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      const newDoc = await getDoc(docRef);
      const raw = newDoc.data()!;

      return {
        data: {
          id: newDoc.id,
          key: raw.key || newDoc.id,
          nameAr: raw.nameAr,
          nameEn: raw.nameEn,
          color: raw.color || "primary",
          isDefault: false,
          isArchived: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        message: "Classification created successfully",
      };
    })());
  },

  async updateClassification(
    companyId: string,
    id: string,
    data: UpdateClassificationDTO
  ): Promise<ApiResponse<ContactClassificationItem>> {
    return withLogging(SERVICE_NAME, "updateClassification", (async () => {
      const docRef = doc(
        db,
        "companies",
        companyId,
        "contact_classifications",
        id
      );

      await updateDoc(docRef, {
        ...data,
        updatedAt: serverTimestamp(),
      });

      const updated = await getDoc(docRef);
      const raw = updated.data()!;

      return {
        data: {
          id: updated.id,
          key: raw.key || updated.id,
          nameAr: raw.nameAr,
          nameEn: raw.nameEn,
          color: raw.color || "primary",
          isDefault: Boolean(raw.isDefault),
          isArchived: Boolean(raw.isArchived),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        message: "Classification updated successfully",
      };
    })());
  },

  async deleteClassification(
    companyId: string,
    id: string
  ): Promise<ApiResponse<void>> {
    return withLogging(SERVICE_NAME, "deleteClassification", (async () => {
      const docRef = doc(
        db,
        "companies",
        companyId,
        "contact_classifications",
        id
      );
      await deleteDoc(docRef);
      return { data: undefined as any, message: "Classification deleted successfully" };
    })());
  },
};
