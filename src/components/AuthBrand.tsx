import type { ReactNode } from "react";
import { Wordmark } from "./Wordmark";

export function AuthBrand({ children }: { children: ReactNode }) {
	return (
		<aside className="auth-brand">
			<div className="auth-brand-bg" />
			<div className="auth-brand-grid" style={{ opacity: 0 }} />
			<div className="auth-brand-inner">
				<Wordmark light size="md" />
				{children}
			</div>
		</aside>
	);
}

export function AuthPaneTop({ left, right }: { left?: ReactNode; right?: ReactNode }) {
	return (
		<div className="auth-pane-top">
			<div>{left}</div>
			<div>{right}</div>
		</div>
	);
}
