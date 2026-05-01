import type { ReactNode } from "react";

export function Field({
	label,
	hint,
	error,
	children,
	htmlFor,
}: {
	label?: ReactNode;
	hint?: ReactNode;
	error?: ReactNode;
	children: ReactNode;
	htmlFor?: string;
}) {
	return (
		<div className="field">
			{label ? (
				<label className="field-label" htmlFor={htmlFor}>
					{label}
				</label>
			) : null}
			{children}
			{error ? (
				<div className="field-error">{error}</div>
			) : hint ? (
				<div className="field-hint">{hint}</div>
			) : null}
		</div>
	);
}
