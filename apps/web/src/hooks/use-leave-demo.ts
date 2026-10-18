import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { authClient } from "@/lib/auth-client";

export function useLeaveDemo(beforeSignOut?: () => Promise<unknown>) {
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	return useMutation({
		retry: false,
		mutationFn: async () => {
			await beforeSignOut?.();
			const { error } = await authClient.signOut();
			if (error) throw error;
			await queryClient.cancelQueries();
			queryClient.removeQueries();
			await navigate({ to: "/login", search: { mode: "sign-up" } });
		},
	});
}
