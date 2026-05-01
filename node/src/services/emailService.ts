import { transporter, EMAIL_FROM } from "../config/email.js";

export const sendPasswordResetEmail = async (
	to: string,
	token: string
): Promise<void> => {
	const resetLink = `${process.env.CLIENT_URL || "http://127.0.0.1:5173"}/reset-password?token=${token}`;

	await transporter.sendMail({
		from: EMAIL_FROM,
		to,
		subject: "Obsidian Financial — Password Reset Request",
		html: `
			<h2>Password Reset</h2>
			<p>You requested a password reset. Use the button below to set a new password:</p>
			<p style="margin: 24px 0;">
				<a href="${resetLink}" style="background-color: #1a1a2e; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">Change Password</a>
			</p>
			<p>This link expires in 1 hour.</p>
			<p>If you did not request this, you can safely ignore this email.</p>
		`,
	});
};

export const sendInvitationEmail = async (
	to: string,
	inviterName: string,
	groupName: string,
	token: string
): Promise<void> => {
	const inviteLink = `${process.env.CLIENT_URL || "http://127.0.0.1:5173"}/invitations?token=${token}`;

	await transporter.sendMail({
		from: EMAIL_FROM,
		to,
		subject: `Obsidian Financial — ${inviterName} invited you to ${groupName}`,
		html: `
			<h2>Group Invitation</h2>
			<p><strong>${inviterName}</strong> has invited you to join <strong>${groupName}</strong> on Obsidian Financial.</p>
			<p style="margin: 24px 0;">
				<a href="${inviteLink}" style="background-color: #1a1a2e; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">Join Group</a>
			</p>
			<p>This invitation expires in 7 days.</p>
			<p>If you did not expect this invitation, you can safely ignore this email.</p>
		`,
	});
};
