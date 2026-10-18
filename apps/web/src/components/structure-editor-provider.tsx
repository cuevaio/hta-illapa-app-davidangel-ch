import { StructureEditorConfirmDialog } from "@hack-the-andes-project/ui/components/structure-editor-dialogs";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useBlocker } from "@tanstack/react-router";
import {
	createContext,
	type ReactNode,
	useContext,
	useEffect,
	useMemo,
	useState,
	useSyncExternalStore,
} from "react";
import { toast } from "sonner";
import {
	ENGINEERING_UNDO_TOAST_ID,
	STRUCTURE_REFETCH_INTERVAL_MS,
} from "@/constants";
import { structureEditorLabels } from "@/lib/structure-editor-labels";
import { StructureEditorSession } from "@/lib/structure-editor-session";
import { structureClient, structureQueries } from "@/lib/structure-queries";
import { m } from "@/paraglide/messages";

function useEditorSession(userId: string) {
	const queryClient = useQueryClient();
	const [session] = useState(() => {
		const editorSession = new StructureEditorSession({
			userId,
			onInvalidEdit: () => toast.error(m.engineering_invalidEdit()),
			onCommit: () => toast.dismiss(ENGINEERING_UNDO_TOAST_ID),
			onRejected: (id) => {
				toast.error(m.engineering_rejectedEdit(), {
					id: `structure-rejected:${id}`,
					action: {
						label: m.engineering_discard(),
						onClick: () => editorSession.discard(id),
					},
				});
			},
		});
		const cachedStructures = queryClient.getQueryData(
			structureQueries.list.queryKey,
		);
		if (cachedStructures)
			editorSession.mergeRemote(cachedStructures, editorSession.version);
		return editorSession;
	});
	const snapshot = useSyncExternalStore(
		session.subscribe,
		session.getSnapshot,
		session.getSnapshot,
	);
	const query = useQuery({
		...structureQueries.list,
		queryFn: async () => {
			const requestedVersion = session.version;
			const structures = await structureClient.structures.list();
			session.mergeRemote(structures, requestedVersion);
			return structures;
		},
		select: () => true,
		refetchInterval: STRUCTURE_REFETCH_INTERVAL_MS,
		meta: { silentError: true },
	});
	useEffect(() => {
		session.restorePending();
		const updateOnline = () => session.queue.setOnline(navigator.onLine);
		updateOnline();
		window.addEventListener("online", updateOnline);
		window.addEventListener("offline", updateOnline);
		return () => {
			window.removeEventListener("online", updateOnline);
			window.removeEventListener("offline", updateOnline);
			session.queue.setOnline(false);
		};
	}, [session]);
	const blocker = useBlocker({
		shouldBlockFn: async ({ next }) => {
			if (
				next.pathname.startsWith("/ingenieria") ||
				next.pathname === "/login" ||
				!session.queue.hasPending
			)
				return false;
			return !(await session.queue.flush());
		},
		withResolver: true,
		enableBeforeUnload: () => session.queue.hasPending,
	});
	const { data, isPending, isLoadingError, isSuccess, refetch } = query;
	return useMemo(
		() => ({
			session,
			snapshot,
			query: {
				hasData: Boolean(data),
				isPending,
				isLoadingError,
				isSuccess,
				refetch,
			},
			blocker,
		}),
		[
			session,
			snapshot,
			data,
			isPending,
			isLoadingError,
			isSuccess,
			refetch,
			blocker,
		],
	);
}
interface StructureEditorContextValue
	extends ReturnType<typeof useEditorSession> {}
const StructureEditorContext =
	createContext<StructureEditorContextValue | null>(null);
export function StructureEditorProvider({
	userId,
	children,
}: {
	userId: string;
	children: ReactNode;
}) {
	const value = useEditorSession(userId);
	return (
		<StructureEditorContext.Provider value={value}>
			{children}
			<StructureEditorConfirmDialog
				open={value.blocker.status === "blocked"}
				title={m.engineering_leaveTitle()}
				description={m.engineering_leaveDetail()}
				action={m.engineering_leaveAnyway()}
				labels={structureEditorLabels()}
				destructive={false}
				onConfirm={() => value.blocker.proceed?.()}
				onOpenChange={(dialogOpen) => {
					if (!dialogOpen) value.blocker.reset?.();
				}}
			/>
		</StructureEditorContext.Provider>
	);
}
export function useStructureEditor() {
	const context = useContext(StructureEditorContext);
	if (!context) throw new Error("StructureEditorProvider is required");
	return context;
}
