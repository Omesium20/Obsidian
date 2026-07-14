import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Ctx } from "./routerContext";

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
