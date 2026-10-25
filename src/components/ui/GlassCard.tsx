import type { ReactNode } from "react";

interface GlassCardProps {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  as?: "div" | "section" | "article";
}

/** Base translucent glass surface used across the app. */
export function GlassCard({ children, className = "", onClick, as = "div" }: GlassCardProps) {
  const Tag = onClick ? "button" : as;
  return (
    <Tag
      className={`glass rounded-3xl ${onClick ? "w-full text-right transition-transform duration-150 active:scale-[0.99]" : ""} ${className}`}
      onClick={onClick}
    >
      {children}
    </Tag>
  );
}
