import { useEffect } from "react";
import { Router, useRouter } from "./lib/router";
import { Landing } from "./pages/Landing";
import { Login } from "./pages/Login";
import { Register } from "./pages/Register";
import { ForgotPassword } from "./pages/ForgotPassword";
import { ResetPassword } from "./pages/ResetPassword";
import { AcceptInvitation } from "./pages/AcceptInvitation";
import { Dashboard } from "./pages/Dashboard";

const TITLES: Record<string, string> = {
	"/": "Obsidian — Personal finance for households",
	"/login": "Log in · Obsidian",
	"/register": "Sign up · Obsidian",
	"/forgot-password": "Forgot password · Obsidian",
	"/reset-password": "Reset password · Obsidian",
	"/invitations": "Accept invitation · Obsidian",
	"/dashboard": "Dashboard · Obsidian",
};

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
			return <Dashboard />;
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
