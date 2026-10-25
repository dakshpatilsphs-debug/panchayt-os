import type { CSSProperties } from "react";

export default function Logo({ size = 40, style }: { size?: number; style?: CSSProperties }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      role="img"
      aria-label="Society emblem"
      style={{ borderRadius: Math.round(size * 0.21), ...style }}
    >
      <defs>
        <linearGradient id="skbg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#1E543E" />
          <stop offset="1" stopColor="#0E3025" />
        </linearGradient>
      </defs>
      <rect x="4" y="4" width="504" height="504" rx="110" fill="url(#skbg)" />
      <rect x="14" y="14" width="484" height="484" rx="100" fill="none" stroke="#fff" strokeOpacity="0.28" strokeWidth="5" />
      <circle cx="367" cy="133" r="37" fill="#C9A24B" />
      <path d="M96 250 232 168l172 100" fill="none" stroke="#fff" strokeWidth="14" strokeLinecap="round" />
      <rect x="120" y="250" width="66" height="148" fill="#fff" />
      <rect x="200" y="214" width="84" height="184" fill="#fff" />
      <rect x="298" y="268" width="84" height="130" fill="#fff" />
      <g fill="#1E543E">
        <rect x="214" y="234" width="22" height="22" />
        <rect x="248" y="234" width="22" height="22" />
        <rect x="214" y="274" width="22" height="22" />
        <rect x="248" y="274" width="22" height="22" />
        <rect x="214" y="314" width="22" height="22" />
        <rect x="248" y="314" width="22" height="22" />
        <rect x="214" y="354" width="22" height="22" />
        <rect x="248" y="354" width="22" height="22" />
      </g>
    </svg>
  );
}
