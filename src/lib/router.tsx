import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";

type RouterCtx = {
	path: string;
	search: string;
	navigate: (to: string) => void;
};

const Ctx = createContext<RouterCtx | null>(null);

function readLocation() {
	return {
		path: window.location.pathname || "/",
		search: window.location.search || "",
	};
}

export function Router({ children }: { children: ReactNode }) {
	const [loc, setLoc] = useState(readLocation);

	useEffect(() => {
		const onPop = () => setLoc(readLocation());
		window.addEventListener("popstate", onPop);
		return () => window.removeEventListener("popstate", onPop);
	}, []);

	useEffect(() => {
		window.scrollTo({ top: 0 });
	}, [loc.path]);

	const navigate = useCallback((to: string) => {
		const url = new URL(to, window.location.origin);
		window.history.pushState({}, "", url.pathname + url.search + url.hash);
		setLoc({ path: url.pathname, search: url.search });
	}, []);

	return <Ctx.Provider value={{ ...loc, navigate }}>{children}</Ctx.Provider>;
}

export function useRouter() {
	const ctx = useContext(Ctx);
	if (!ctx) throw new Error("useRouter must be used inside <Router>");
	return ctx;
}

export function useQueryParam(name: string): string | null {
	const { search } = useRouter();
	return new URLSearchParams(search).get(name);
}
