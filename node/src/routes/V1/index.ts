import { Router } from "express";
import userRoutes from "./userRoutes.js";
import transactionRoutes from "./transactionRoutes.js";
import groupRoutes from "./groupRoutes.js";
import accountRoutes from "./accountRoutes.js";
import adminRoutes from "./adminRoutes.js";
import registerRoutes from "./registrationRoutes.js";
import loginRoutes from "./loginRoute.js";
import logoutRoutes from "./logoutRoute.js";
import passwordResetRoutes from "./passwordResetRoutes.js";
import invitationRoutes from "./invitationRoutes.js";
import plaidRoutes from "./plaidRoutes.js";
import sessionRoute from "./sessionRoute.js";
import dashboardRoutes from "./dashboardRoutes.js";
import eventsRoutes from "./eventsRoutes.js";
import { authRateLimit } from "../../middleware/rateLimit.js";

const router = Router();

// Rate limiting strategy: the brute-force-sensitive public routes get the tight
// IP-keyed authRateLimit here; every authenticated sub-router mounts the
// per-user apiRateLimit after its own authenticate. Both are no-ops when Redis
// is disabled.

// Public routes
router.use("/register", authRateLimit, registerRoutes);
router.use("/login", authRateLimit, loginRoutes);
router.use("/logout", logoutRoutes);
router.use("/password-reset", authRateLimit, passwordResetRoutes);
router.use("/session", sessionRoute);

// Authenticated routes
router.use("/users", userRoutes);
router.use("/transactions", transactionRoutes);
router.use("/groups", groupRoutes);
router.use("/accounts", accountRoutes);
router.use("/invitations", invitationRoutes);
router.use("/plaid", plaidRoutes);
router.use("/dashboard", dashboardRoutes);
router.use("/events", eventsRoutes);

// Admin routes
router.use("/admin", adminRoutes);

export default router;
