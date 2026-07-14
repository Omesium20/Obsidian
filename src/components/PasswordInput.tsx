import { useState } from "react";
import { IconEye, IconEyeOff, IconLock, IconCheck } from "./icons";
import { passwordChecks } from "../lib/passwordPolicy";

export function PasswordInput({
	value,
	onChange,
	placeholder = "Password",
	autoComplete = "new-password",
	name = "password",
}: {
	value: string;
	onChange: (v: string) => void;
	placeholder?: string;
	autoComplete?: string;
	name?: string;
}) {
	const [show, setShow] = useState(false);
	return (
		<div className="input-with-icon">
			<span className="icon-left">
				<IconLock size={17} />
			</span>
			<input
				className="input"
				type={show ? "text" : "password"}
				value={value}
				onChange={(e) => onChange(e.target.value)}
				placeholder={placeholder}
				name={name}
				autoComplete={autoComplete}
			/>
			<button
				type="button"
				className="icon-right"
				onClick={() => setShow((s) => !s)}
				aria-label={show ? "Hide password" : "Show password"}
			>
				{show ? <IconEyeOff size={17} /> : <IconEye size={17} />}
			</button>
		</div>
	);
}

export function PasswordChecklist({ pw }: { pw: string }) {
	const c = passwordChecks(pw);
	const items: { k: keyof typeof c; t: string }[] = [
		{ k: "len", t: "16+ characters" },
		{ k: "upper", t: "One uppercase" },
		{ k: "lower", t: "One lowercase" },
		{ k: "num", t: "One number" },
		{ k: "sym", t: "One symbol" },
	];
	return (
		<div className="pw-checks" aria-live="polite">
			{items.map(({ k, t }) => (
				<div key={k} className={`pw-check ${c[k] ? "ok" : ""}`}>
					<span className="dot">{c[k] ? <IconCheck size={10} stroke="white" /> : null}</span>
					<span>{t}</span>
				</div>
			))}
		</div>
	);
}
