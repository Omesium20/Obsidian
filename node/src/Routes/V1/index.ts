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
import { apiRateLimit } from "../../middleware/rateLimit.js";

const router = Router();

// Global API rate limit across all v1 routes. authenticate runs inside each
// sub-router (below), so req.user isn't resolved here yet — this keys by IP, a
// per-client edge guard that also covers the public routes. No-op when Redis is
// disabled. For per-USER limits, mount apiRateLimit after authenticate inside a
// specific sub-router instead.
router.use(apiRateLimit);

// Public routes
router.use("/register", registerRoutes);
router.use("/login", loginRoutes);
router.use("/logout", logoutRoutes);
router.use("/password-reset", passwordResetRoutes);
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
