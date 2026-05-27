import { Router } from "express";
import {
	getGroupById,
	removeGroup,
	leaveGroup,
	kickMember,
} from "../../services/groupService.js";
import { authenticate } from "../../middleware/authenticate.js";
import { authorizeMember } from "../../middleware/authorizeMember.js";
import { authorizeCreator } from "../../middleware/authorizeCreator.js";
import { attachFreshToken } from "../../middleware/attachFreshToken.js";
import { validate } from "../../middleware/validate.js";
import { idParamSchema } from "../../schemas/common.js";
import {
	deleteGroupSchema,
	leaveGroupSchema,
	kickMemberSchema,
} from "../../schemas/groupSchemas.js";

const router = Router();

// All group routes require authentication
router.use(authenticate);

// Get group by ID (members only — must match the caller's own group)
router.get("/:id", authorizeMember, validate({ params: idParamSchema }), async (req, res) => {
	const id = Number(req.params.id);
	if (id !== req.user!.groupId) {
		res.status(403).json({ message: "Access denied" });
		return;
	}
	const data = await getGroupById(id);
	res.status(200).json({
		message: "Data received successfully",
		data,
	});
});

// Delete group (creator only). Re-mints the access token with the deleter's
// new personal auto-group on the payload.
router.delete("/", authorizeCreator, attachFreshToken, validate({ body: deleteGroupSchema }), async (req, res) => {
	const { deletedGroup, newGroupId } = await removeGroup(
		req.body.id,
		req.user!.userId,
		req.user!.role
	);
	res.locals.reissueToken = true;
	res.locals.newGroupId = newGroupId;
	res.locals.newRole = "creator";

	res.status(200).json({
		message: "Group deleted",
		group: deletedGroup,
		new_group_id: newGroupId,
	});
});

// Leave group (members only, not creator). Re-mints the access token with
// the leaver's new personal auto-group on the payload.
router.post("/leave", authorizeMember, attachFreshToken, validate({ body: leaveGroupSchema }), async (req, res) => {
	const { membership, newGroupId } = await leaveGroup(
		req.body.id,
		req.user!.userId,
		req.user!.role
	);
	res.locals.reissueToken = true;
	res.locals.newGroupId = newGroupId;
	res.locals.newRole = "creator";

	res.status(200).json({
		message: "Successfully left the group",
		membership,
		new_group_id: newGroupId,
	});
});

// Kick a member (creator only). Operates on the caller's own group from the JWT.
router.post("/kick", authorizeCreator, validate({ body: kickMemberSchema }), async (req, res) => {
	const removed = await kickMember(
		req.user!.groupId!,
		req.user!.userId,
		req.user!.role,
		req.body.user_id
	);
	res.status(200).json({
		message: "Member removed from group",
		membership: removed,
	});
});

export default router;
