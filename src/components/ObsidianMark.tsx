import { useId } from "react";
import type { CSSProperties } from "react";

/**
 * Obsidian — Shard-O brand mark: a faceted obsidian shard with a beveled,
 * glassy "O" punched through the centre. The body gradient is wired to the
 * app's --brand / --accent CSS custom properties so the mark tracks the theme.
 */
export function ObsidianMark({ size = 22, style }: { size?: number; style?: CSSProperties }) {
	// useId keeps gradient/mask ids unique when several marks render on one page.
	const u = useId().replace(/:/g, "");
	const cx = 50;
	const cy = 53;
	const hole = 17;

	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 100 100"
			fill="none"
			aria-hidden="true"
			style={style}
		>
			<defs>
				<linearGradient id={`body${u}`} x1="22" y1="6" x2="78" y2="96" gradientUnits="userSpaceOnUse">
					<stop offset="0" stopColor="var(--brand, #0384fc)" />
					<stop offset="1" stopColor="var(--accent, #bc03fc)" />
				</linearGradient>
				<linearGradient id={`rim${u}`} x1="34" y1="36" x2="66" y2="72" gradientUnits="userSpaceOnUse">
					<stop offset="0" stopColor="rgba(255,255,255,0.65)" />
					<stop offset="1" stopColor="rgba(0,0,0,0.30)" />
				</linearGradient>
				<mask id={`m${u}`}>
					<rect width="100" height="100" fill="white" />
					<circle cx={cx} cy={cy} r={hole} fill="black" />
				</mask>
			</defs>

			<g mask={`url(#m${u})`}>
				{/* shard body */}
				<path d="M50 3 L83 33 L73 74 L50 97 L27 74 L17 33 Z" fill={`url(#body${u})`} />
				{/* cut-facet lines */}
				<g stroke="rgba(255,255,255,0.30)" strokeWidth="1.1" fill="none">
					<path d="M50 3 L50 30" />
					<path d="M17 33 L33 44" />
					<path d="M83 33 L67 44" />
					<path d="M27 74 L40 64" />
					<path d="M73 74 L60 64" />
					<path d="M50 97 L50 72" />
				</g>
				{/* gloss facet upper-left */}
				<path d="M50 3 L17 33 L34 44 L50 28 Z" fill="rgba(255,255,255,0.20)" />
				{/* shadow facet lower-right */}
				<path d="M83 33 L73 74 L60 64 L67 44 Z" fill="rgba(0,0,0,0.12)" />
			</g>

			{/* beveled O rim — sits outside the mask so the bright ring is fully visible */}
			<circle cx={cx} cy={cy} r={hole + 2} fill="none" stroke={`url(#rim${u})`} strokeWidth="4" />
		</svg>
	);
}
