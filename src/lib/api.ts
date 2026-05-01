type ApiErrorBody = {
	status?: string;
	errorCode?: string;
	message?: string;
	details?: unknown;
};

export class ApiError extends Error {
	status: number;
	errorCode?: string;
	details?: unknown;
	constructor(status: number, body: ApiErrorBody) {
		super(body.message || `Request failed with status ${status}`);
		this.status = status;
		this.errorCode = body.errorCode;
		this.details = body.details;
	}
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
	const res = await fetch(path, {
		credentials: "include",
		...init,
		headers: {
			"Content-Type": "application/json",
			...(init?.headers || {}),
		},
	});

	const text = await res.text();
	const body = text ? (JSON.parse(text) as ApiErrorBody & Record<string, unknown>) : {};

	if (!res.ok) {
		throw new ApiError(res.status, body);
	}
	return body as T;
}

export const api = {
	login: (email: string, password: string) =>
		request<{ message: string }>("/api/v1/login", {
			method: "POST",
			body: JSON.stringify({ email, password }),
		}),

	register: (data: {
		email: string;
		password_hash: string;
		username: string;
		first_name: string;
		last_name: string;
	}) =>
		request<{ message: string }>("/api/v1/register/auth/register", {
			method: "POST",
			body: JSON.stringify(data),
		}),

	logout: () =>
		request<{ message: string }>("/api/v1/logout", {
			method: "POST",
		}),

	requestPasswordReset: (email: string) =>
		request<{ message: string }>("/api/v1/password-reset/request", {
			method: "POST",
			body: JSON.stringify({ email }),
		}),

	resetPassword: (token: string, new_password: string) =>
		request<{ message: string }>("/api/v1/password-reset/reset", {
			method: "POST",
			body: JSON.stringify({ token, new_password }),
		}),

	acceptInvitation: (token: string) =>
		request<{ message: string }>("/api/v1/invitations/accept", {
			method: "POST",
			body: JSON.stringify({ token }),
		}),

	declineInvitation: (token: string) =>
		request<{ message: string }>("/api/v1/invitations/decline", {
			method: "POST",
			body: JSON.stringify({ token }),
		}),
};
