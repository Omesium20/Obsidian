import { useEffect, useState, type ReactNode } from "react";
import { Router, useRouter } from "./lib/router";
import { Landing } from "./pages/Landing";
import { Login } from "./pages/Login";
import { Register } from "./pages/Register";
import { ForgotPassword } from "./pages/ForgotPassword";
import { ResetPassword } from "./pages/ResetPassword";
import { AcceptInvitation } from "./pages/AcceptInvitation";
import { Dashboard } from "./pages/Dashboard";
import { Onboarding } from "./pages/Onboarding";
import { api, ApiError } from "./lib/api";

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

	useEffect(() => {
		api.getSession()
			.then(() => setReady(true))
			.catch((e) => {
				if (e instanceof ApiError && e.status === 401) {
					const returnTo = encodeURIComponent(path + search);
					navigate(`/login?returnTo=${returnTo}`);
				} else {
					setReady(true);
				}
			});
	// path and search are intentionally excluded — we only want to check auth
	// once when the component mounts, not on every navigation.
	// eslint-disable-next-line react-hooks/exhaustive-deps
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
