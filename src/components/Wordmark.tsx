type Size = "sm" | "md" | "lg";

const SIZES: Record<Size, number> = { sm: 16, md: 18, lg: 22 };
const MARK_SIZES: Record<Size, number> = { sm: 18, md: 22, lg: 26 };

export function Wordmark({ size = "md", light = false }: { size?: Size; light?: boolean }) {
	return (
		<span
			className="wordmark"
			style={{
				fontSize: SIZES[size],
				color: light ? "white" : undefined,
			}}
		>
			<span
				className="wordmark-mark"
				style={{
					width: MARK_SIZES[size],
					height: MARK_SIZES[size],
					fontSize: "18px",
					opacity: 1,
				}}
			/>
			Obsidian
		</span>
	);
}
