import { createCrmCollectionService } from "./crm-base.service";
import { CRM_COLLECTIONS } from "../constants/crm-collections";
import type {
  SavedContract,
  CreateContractDTO,
  UpdateContractDTO,
} from "../types/contract.types";
import {
  validateContractPayload,
  normalizeContractPayload,
} from "../utils/contract-normalization";

const base = createCrmCollectionService<
  SavedContract,
  CreateContractDTO,
  UpdateContractDTO
>(CRM_COLLECTIONS.contracts, "ContractsService", {
  status: "draft",
  approvalStatus: "pending",
});

export const ContractsService = {
  getAll: base.getAll,
  getById: base.getById,
  async create(companyId: string, data: CreateContractDTO) {
    validateContractPayload(data);
    const normalized = normalizeContractPayload(data);
    return base.create(companyId, normalized);
  },
  async update(companyId: string, id: string, data: UpdateContractDTO) {
    validateContractPayload(data);
    const normalized = normalizeContractPayload(data);
    return base.update(companyId, id, normalized);
  },
  delete: base.delete,
};
