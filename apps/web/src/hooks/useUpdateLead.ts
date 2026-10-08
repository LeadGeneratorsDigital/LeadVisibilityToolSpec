import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { data } from "@/lib/data";
import type { Lead } from "@/lib/types";

export function useUpdateLead(leadId: string, successMessage = "Lead saved") {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (fields: Partial<Lead>) => data.updateLead(leadId, fields),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["lead", leadId] });
      void queryClient.invalidateQueries({ queryKey: ["leads"] });
      toast.success(successMessage);
    },
    onError: (err: Error) => toast.error(err.message),
  });
}
