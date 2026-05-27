import { z } from "zod";

// Query params for the paginated dashboard transaction list.
// `view` controls whose transactions are shown:
//   "me"          — the requesting user's own transactions
//   "group"       — all transactions shared with the group
//   "member-{id}" — a specific group member's transactions
export const dashboardTxQuerySchema = z.object({
	view: z.string().min(1),
	page: z.coerce.number().int().min(1).default(1),
	filter: z.enum(["all", "income", "spend"]).default("all"),
});
