import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Router } from "./lib/router";
import { useRouter } from "./lib/routerContext";
import { Landing } from "./pages/Landing";
import { Login } from "./pages/Login";
import { Register } from "./pages/Register";
import { ForgotPassword } from "./pages/ForgotPassword";
import { ResetPassword } from "./pages/ResetPassword";
import { AcceptInvitation } from "./pages/AcceptInvitation";
import { Dashboard } from "./pages/Dashboard";
import { Onboarding } from "./pages/Onboarding";
import { api, ApiError, setSessionListeners, INACTIVITY_LIMIT_MS } from "./lib/api";

const TITLES: Record<string, string> = {
	"/": "Obsidian — Personal finance for households",
	"/login": "Log in · Obsidian",
	"/register": "Sign up · Obsidian",
	"/forgot-password": "Forgot password · Obsidian",
	"/reset-password": "Reset password · Obsidian",
	"/invitations": "Accept invitation · Obsidian",
	"/onboarding": "Set up · Obsidian",
	"/dashboard": "Dashboard · Obsidian",
};

function ProtectedRoute({ children }: { children: ReactNode }) {
	const { navigate, path, search } = useRouter();
	const [ready, setReady] = useState(false);

	// Send the user to login, preserving where they were so they can return.
	const redirectToLogin = useCallback(() => {
		const returnTo = encodeURIComponent(path + search);
		navigate(`/login?returnTo=${returnTo}`);
	}, [navigate, path, search]);

	// Client-side inactivity guard. The server slides refresh_tokens.last_used_at
	// on every authenticated request and revokes the session after
	// INACTIVITY_LIMIT_MS of inactivity. We mirror that with a timer that resets
	// on each successful request (onActivity). If the user goes idle past the
	// window — e.g. just staring at the dashboard, which never polls — we
	// proactively log out (api.logout() sets revoked_at server-side) and redirect,
	// instead of leaving a logged-in-looking page that's already dead. A 401 from
	// any request (onSessionExpired) means the server already ended the session,
	// so we just redirect.
	useEffect(() => {
		let timer: number | undefined;

		const expireNow = async () => {
			try {
				await api.logout();
			} catch {
				// Best-effort revoke; redirect regardless.
			}
			redirectToLogin();
		};

		const resetTimer = () => {
			window.clearTimeout(timer);
			timer = window.setTimeout(() => void expireNow(), INACTIVITY_LIMIT_MS);
		};

		setSessionListeners({ onActivity: resetTimer, onSessionExpired: redirectToLogin });
		resetTimer(); // start the clock on mount

		return () => {
			window.clearTimeout(timer);
			setSessionListeners({});
		};
	}, [redirectToLogin]);

	useEffect(() => {
		api.getSession()
			.then(() => setReady(true))
			.catch((e) => {
				// 401 is handled by the onSessionExpired listener (redirect). For any
				// other error, render the children rather than blocking the page.
				if (!(e instanceof ApiError && e.status === 401)) {
					setReady(true);
				}
			});
	// Auth is checked once on mount, not on every navigation.
	}, []);

	if (!ready) return null;
	return <>{children}</>;
}

function Routes() {
	const { path } = useRouter();

	useEffect(() => {
		document.title = TITLES[path] || "Obsidian";
	}, [path]);

	switch (path) {
		case "/login":
			return <Login />;
		case "/register":
			return <Register />;
		case "/forgot-password":
			return <ForgotPassword />;
		case "/reset-password":
			return <ResetPassword />;
		case "/dashboard":
			return <ProtectedRoute><Dashboard /></ProtectedRoute>;
		case "/onboarding":
			return <ProtectedRoute><Onboarding /></ProtectedRoute>;
		case "/invitations":
			return <AcceptInvitation />;
		case "/":
			return <Landing />;
		default:
			return <Landing />;
	}
}

export default function App() {
	useEffect(() => {
		document.documentElement.dataset.theme = "light";
	}, []);

	return (
		<Router>
			<Routes />
		</Router>
	);
}
