// Password policy shared by the PasswordInput/PasswordChecklist components
// and the register/reset pages. Lives outside the component file so
// react-refresh can hot-reload it cleanly (react-refresh/only-export-components).

export function passwordChecks(pw: string) {
	return {
		len: pw.length >= 16,
		lower: /[a-z]/.test(pw),
		upper: /[A-Z]/.test(pw),
		num: /[0-9]/.test(pw),
		sym: /[^a-zA-Z0-9]/.test(pw),
	};
}

export function passwordValid(pw: string) {
	const c = passwordChecks(pw);
	return c.len && c.lower && c.upper && c.num && c.sym;
}
