import React from "react";

export type Platform = "instagram" | "tiktok" | "youtube";

export const PLATFORMS: Record<Platform, { name: string; sub: string; a: string; b: string }> = {
  instagram: { name: "Instagram", sub: "Reels", a: "#FF5C7A", b: "#FFA24C" },
  tiktok: { name: "TikTok", sub: "TikTok", a: "#25F4EE", b: "#FE2C55" },
  youtube: { name: "YouTube", sub: "Shorts", a: "#FF6A4D", b: "#FF0033" },
};

// Display order in the UI.
export const PK: Platform[] = ["instagram", "tiktok", "youtube"];

export const HOME: Record<Platform, string> = {
  instagram: "https://instagram.com",
  tiktok: "https://tiktok.com",
  youtube: "https://youtube.com",
};

export function Icon({ p, size = 16, color = "currentColor" }: { p: Platform; size?: number; color?: string }) {
  const s = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: color,
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  if (p === "instagram")
    return (
      <svg {...s}>
        <rect x="3" y="3" width="18" height="18" rx="5" />
        <circle cx="12" cy="12" r="4" />
        <circle cx="17" cy="7" r="1" fill={color} stroke="none" />
      </svg>
    );
  if (p === "tiktok")
    return (
      <svg {...s}>
        <path d="M9 18a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />
        <path d="M12 12V4c.5 2 2 3.3 4 3.6" />
      </svg>
    );
  return (
    <svg {...s}>
      <rect x="2" y="5" width="20" height="14" rx="4" />
      <path d="M10 9l5 3-5 3V9z" fill={color} stroke="none" />
    </svg>
  );
}
