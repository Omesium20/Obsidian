import type { CSSProperties, ReactNode } from "react";

type IconProps = {
	size?: number;
	stroke?: string;
	style?: CSSProperties;
};

type BaseIconProps = IconProps & {
	d: string | ReactNode;
	fill?: boolean;
};

const Icon = ({ d, size = 18, fill = false, stroke = "currentColor", style }: BaseIconProps) => (
	<svg
		width={size}
		height={size}
		viewBox="0 0 24 24"
		fill={fill ? "currentColor" : "none"}
		stroke={stroke}
		strokeWidth="1.6"
		strokeLinecap="round"
		strokeLinejoin="round"
		style={style}
	>
		{typeof d === "string" ? <path d={d} /> : d}
	</svg>
);

export const IconMail = (p: IconProps) => (
	<Icon
		{...p}
		d={
			<>
				<rect x="3" y="5" width="18" height="14" rx="2.5" />
				<path d="M3.5 7.5l8.5 6 8.5-6" />
			</>
		}
	/>
);

export const IconLock = (p: IconProps) => (
	<Icon
		{...p}
		d={
			<>
				<rect x="4" y="11" width="16" height="9" rx="2" />
				<path d="M8 11V8a4 4 0 0 1 8 0v3" />
			</>
		}
	/>
);

export const IconUser = (p: IconProps) => (
	<Icon
		{...p}
		d={
			<>
				<circle cx="12" cy="8" r="3.5" />
				<path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5" />
			</>
		}
	/>
);

export const IconEye = (p: IconProps) => (
	<Icon
		{...p}
		d={
			<>
				<path d="M2.5 12s3.5-7 9.5-7 9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7z" />
				<circle cx="12" cy="12" r="2.6" />
			</>
		}
	/>
);

export const IconEyeOff = (p: IconProps) => (
	<Icon
		{...p}
		d={
			<>
				<path d="M3 3l18 18" />
				<path d="M10.6 6.2A9.7 9.7 0 0 1 12 6c6 0 9.5 6 9.5 6a14.6 14.6 0 0 1-3 3.6" />
				<path d="M6.5 7.5C3.7 9.5 2.5 12 2.5 12s3.5 6 9.5 6c1.5 0 2.8-.4 4-.9" />
				<path d="M9.6 9.6a3 3 0 0 0 4.2 4.2" />
			</>
		}
	/>
);

export const IconCheck = (p: IconProps) => <Icon {...p} d="M5 12.5l4 4 10-10" />;
export const IconArrow = (p: IconProps) => <Icon {...p} d="M5 12h14M13 6l6 6-6 6" />;
export const IconArrowL = (p: IconProps) => <Icon {...p} d="M19 12H5M11 6l-6 6 6 6" />;

export const IconShield = (p: IconProps) => (
	<Icon
		{...p}
		d={
			<>
				<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z" />
				<path d="M9 12l2 2 4-4" />
			</>
		}
	/>
);

export const IconBolt = (p: IconProps) => (
	<Icon {...p} d="M13 3L4 14h7l-1 7 9-11h-7l1-7z" />
);

export const IconChart = (p: IconProps) => (
	<Icon
		{...p}
		d={
			<>
				<path d="M4 20V8" />
				<path d="M10 20v-7" />
				<path d="M16 20V4" />
			</>
		}
	/>
);

export const IconUsers = (p: IconProps) => (
	<Icon
		{...p}
		d={
			<>
				<circle cx="9" cy="8" r="3.2" />
				<path d="M3 19c.6-3 3-4.5 6-4.5s5.4 1.5 6 4.5" />
				<circle cx="17" cy="7" r="2.5" />
				<path d="M16 13.5c2.5 0 4.4 1.2 5 3.5" />
			</>
		}
	/>
);

// Account-type icons — used next to account-type groups on the Accounts tab to
// signal what each group is at a glance (cash, credit, loans, investments).
export const IconBank = (p: IconProps) => (
	<Icon
		{...p}
		d={
			<>
				<path d="M3 9.5l9-5.5 9 5.5" />
				<path d="M5 10v7M9.5 10v7M14.5 10v7M19 10v7" />
				<path d="M3.5 20.5h17" />
			</>
		}
	/>
);

export const IconCard = (p: IconProps) => (
	<Icon
		{...p}
		d={
			<>
				<rect x="2.5" y="5" width="19" height="14" rx="2.5" />
				<path d="M2.5 9.5h19" />
				<path d="M6 14.5h4" />
			</>
		}
	/>
);

export const IconLoan = (p: IconProps) => (
	<Icon
		{...p}
		d={
			<>
				<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
				<path d="M14 3v5h5" />
				<path d="M9 13h6M9 16.5h4" />
			</>
		}
	/>
);

export const IconInvest = (p: IconProps) => (
	<Icon
		{...p}
		d={
			<>
				<path d="M3 16.5l5.5-5.5 4 4 8-8" />
				<path d="M16 7h4.5v4.5" />
			</>
		}
	/>
);

export const IconSparkle = (p: IconProps) => (
	<Icon
		{...p}
		d={
			<>
				<path d="M12 3v4M12 17v4M3 12h4M17 12h4" />
				<path d="M5.5 5.5l2.5 2.5M16 16l2.5 2.5M5.5 18.5L8 16M16 8l2.5-2.5" />
			</>
		}
	/>
);
