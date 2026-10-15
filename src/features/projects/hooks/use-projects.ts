import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ProjectService } from "../api/projects.service";
import { useCompany } from "@/features/companies/context/company-context";
import type {
  CreateProjectDTO,
  UpdateProjectDTO,
} from "../types/projects.types";

const QUERY_KEY = ["projects"] as const;

export function useProjects() {
  const { companyId } = useCompany();
  return useQuery({
    queryKey: [...QUERY_KEY, "list", companyId],
    queryFn: async () => {
      const res = await ProjectService.getProjects(companyId!);
      return res.data;
    },
    enabled: !!companyId,
  });
}

export function useCreateProjectMutation() {
  const queryClient = useQueryClient();
  const { companyId } = useCompany();

  return useMutation({
    mutationFn: async (data: CreateProjectDTO) => {
      const res = await ProjectService.createProject(companyId!, data);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });
}

export function useUpdateProjectMutation() {
  const queryClient = useQueryClient();
  const { companyId } = useCompany();

  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdateProjectDTO }) => {
      const res = await ProjectService.updateProject(companyId!, id, data);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });
}

export function useDeleteProjectMutation() {
  const queryClient = useQueryClient();
  const { companyId } = useCompany();

  return useMutation({
    mutationFn: async (id: string) => {
      await ProjectService.deleteProject(companyId!, id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });
}
