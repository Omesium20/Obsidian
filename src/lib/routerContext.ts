import { createContext, useContext } from "react";

export type RouterCtx = {
	path: string;
	search: string;
	navigate: (to: string) => void;
};

// Shared between the <Router> provider (lib/router.tsx) and the hooks below.
// Split from the component file so react-refresh can hot-reload it cleanly
// (react-refresh/only-export-components).
export const Ctx = createContext<RouterCtx | null>(null);

export function useRouter() {
	const ctx = useContext(Ctx);
	if (!ctx) throw new Error("useRouter must be used inside <Router>");
	return ctx;
}

export function useQueryParam(name: string): string | null {
	const { search } = useRouter();
	return new URLSearchParams(search).get(name);
}
