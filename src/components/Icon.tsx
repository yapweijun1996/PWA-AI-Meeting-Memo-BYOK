import type {LucideIcon, LucideProps} from "lucide-react";

/** Physical SVG dimensions; preserve established geometry while centralizing ownership. */
export const ICON_SIZES = {
  micro: 12, tiny: 13, small: 14, compact: 15, inline: 16, status: 17,
  control: 18, navigation: 19, transport: 20, section: 21, heading: 22,
  large: 24, upload: 25, empty: 32,
} as const;
export type IconSize = keyof typeof ICON_SIZES;

/** Lucide remains the glyph registry. The surrounding control owns its accessible name. */
export function Icon({glyph: Glyph, size, ...props}: Omit<LucideProps, "size"> & {glyph: LucideIcon; size: IconSize}) {
  return <Glyph {...props} size={ICON_SIZES[size]} />;
}
