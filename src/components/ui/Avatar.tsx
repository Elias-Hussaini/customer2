/**
 * Round profile avatar — photo when one is set, otherwise the first letter
 * of the name on a soft brand background. Used in lists and detail pages.
 */

interface AvatarProps {
  photo?: string | null;
  name?: string | null;
  /** sm = 36px (tables), md = 44px (cards), lg = 96px (detail profile). */
  size?: "sm" | "md" | "lg";
  className?: string;
}

const SIZES: Record<NonNullable<AvatarProps["size"]>, string> = {
  sm: "h-9 w-9 text-[13px]",
  md: "h-11 w-11 text-[15px]",
  lg: "h-24 w-24 text-[28px]",
};

export function Avatar({ photo, name, size = "sm", className }: AvatarProps) {
  const dims = SIZES[size];
  const letter = (name ?? "").trim().slice(0, 1) || "؟";
  if (photo) {
    return (
      <img
        src={photo}
        alt={name ?? "عکس پروفایل"}
        loading="lazy"
        className={`shrink-0 rounded-full bg-ink-500/10 object-cover ring-2 ring-white/60 dark:ring-white/10 ${dims} ${className ?? ""}`}
      />
    );
  }
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-full bg-brand-500/12 font-bold text-brand-600 dark:text-brand-300 ${dims} ${className ?? ""}`}
    >
      {letter}
    </span>
  );
}
