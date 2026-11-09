import type { CSSProperties } from "react";

export default function Logo({ size = 44, style }: { size?: number; style?: CSSProperties }) {
  const s = size / 44;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 44 44"
      role="img"
      aria-label="RisePay"
      style={{ ...style }}
    >
      <defs>
        <linearGradient id="rpGold" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#f6e05e" />
          <stop offset="50%" stopColor="#d4a017" />
          <stop offset="100%" stopColor="#8a5a00" />
        </linearGradient>
        <linearGradient id="rpDark" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#121212" />
          <stop offset="100%" stopColor="#050505" />
        </linearGradient>
        <filter id="rpGlow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="6" stdDeviation="10" flood-color="#000" flood-opacity="0.45" />
        </filter>
        <filter id="rpInnerGlow" x="-10%" y="-10%" width="120%" height="120%">
          <feMorphology operator="dilate" radius="1" in="SourceAlpha" result="spread" />
          <feGaussianBlur stdDeviation="1.5" result="blur" />
          <feFlood flood-color="#f6e05e" flood-opacity="0.35" result="color" />
          <feComposite in="color" in2="blur" operator="in" result="coloredBlur" />
          <feMerge>
            <feMergeNode in="coloredBlur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Dark rounded-square app icon background */}
      <rect x="1" y="1" width="42" height="42" rx="13" fill="url(#rpDark)" filter="url(#rpGlow)" />
      <rect x="1.5" y="1.5" width="41" height="41" rx="12.5" fill="none" stroke="url(#rpGold)" strokeWidth="1.4" opacity="0.95" />

      {/* Bold gold "R" mark — modern app icon */}
      <path
        d="M13.5 11h6.2c2.4 0 4.2 1.9 4.2 4.2v10.2c0 2.3-1.8 4.2-4.2 4.2h-4v10h-2.4V20.4h4c-2.4 0-4.2-1.9-4.2-4.2v-4.2c0-2.3 1.8-4.2 4.2-4.2"
        fill="none"
        stroke="url(#rpGold)"
        strokeWidth="2.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        filter="url(#rpInnerGlow)"
      />
      <path d="M23.9 19.2v10" fill="none" stroke="url(#rpGold)" strokeWidth="2.8" strokeLinecap="round" />

      {/* Gold accent dot */}
      <circle cx="30.5" cy="11.5" r="2.4" fill="url(#rpGold)" />
    </svg>
  );
}
