import type { ReactNode } from "react";

export interface IconProps {
  size?: number;
  className?: string;
  strokeWidth?: number;
}

function S({ size = 18, className, children, strokeWidth = 1.8 }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const IconSend = (p: IconProps) => (
  <S {...p}><path d="M3.5 4.5 20.5 12 3.5 19.5 5.6 12z" /><path d="M5.6 12 20.5 12" /></S>
);
export const IconHistory = (p: IconProps) => (
  <S {...p}><circle cx="12" cy="12" r="8.2" /><path d="M12 7.6v4.6l3 1.8" /></S>
);
export const IconShield = (p: IconProps) => (
  <S {...p}><path d="M12 3.2 19 6v5.2c0 4.4-2.9 7.4-7 8.8-4.1-1.4-7-4.4-7-8.8V6z" /><path d="M9.2 11.8l2 2 3.6-3.8" /></S>
);
export const IconCog = (p: IconProps) => (
  <S {...p}>
    <path d="M4 7.5h7" /><circle cx="13.5" cy="7.5" r="2.3" /><path d="M18 7.5h2" />
    <path d="M4 16.5h2" /><circle cx="8.5" cy="16.5" r="2.3" /><path d="M13 16.5h7" />
  </S>
);
export const IconDownload = (p: IconProps) => (
  <S {...p}><path d="M12 4v10.5" /><path d="m8 11 4 4 4-4" /><path d="M4.5 20h15" /></S>
);
export const IconMail = (p: IconProps) => (
  <S {...p}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3.5 7.5 8.5 6 8.5-6" /></S>
);
export const IconTrash = (p: IconProps) => (
  <S {...p}><path d="M4 7h16" /><path d="M9.5 7V5h5v2" /><path d="m6.5 7 1 13h9l1-13" /><path d="M10 11v5.5" /><path d="M14 11v5.5" /></S>
);
export const IconCheck = (p: IconProps) => (
  <S {...p}><path d="m5 12.5 4.4 4.4L19 7.5" /></S>
);
export const IconClose = (p: IconProps) => (
  <S {...p}><path d="m6 6 12 12" /><path d="M18 6 6 18" /></S>
);
export const IconPlus = (p: IconProps) => (
  <S {...p}><path d="M12 5.5v13" /><path d="M5.5 12h13" /></S>
);
export const IconPrint = (p: IconProps) => (
  <S {...p}><path d="M7 8.5V4h10v4.5" /><rect x="4.5" y="8.5" width="15" height="7" rx="1" /><path d="M7 13.5h10V20H7z" /></S>
);
export const IconBuilding = (p: IconProps) => (
  <S {...p}><path d="M4 20.5V8.5h6v-4h7v16" /><path d="M10 20.5v-6h7" /><path d="M2.5 20.5h19" /><path d="M6.5 11h1" /><path d="M6.5 14h1" /><path d="M13 11h1.5" /><path d="M13 17h1.5" /></S>
);
export const IconCoins = (p: IconProps) => (
  <S {...p}><circle cx="9" cy="9" r="5.2" /><path d="M14.6 10.2A5.2 5.2 0 1 1 10.2 20" /><path d="M6.8 9h4.4" /><path d="M6.8 6.8h4.4" /></S>
);
export const IconAlert = (p: IconProps) => (
  <S {...p}><path d="M12 3.5 1.8 20.5h20.4z" /><path d="M12 10v4.5" /><path d="M12 17.4h.01" /></S>
);
export const IconQr = (p: IconProps) => (
  <S {...p}><rect x="3.5" y="3.5" width="6.5" height="6.5" /><rect x="14" y="3.5" width="6.5" height="6.5" /><rect x="3.5" y="14" width="6.5" height="6.5" /><path d="M14 14h2.6v2.6H14zM17.9 17.9h2.6v2.6h-2.6z" /></S>
);
export const IconSearch = (p: IconProps) => (
  <S {...p}><circle cx="11" cy="11" r="7" /><path d="m21 21-4.2-4.2" /></S>
);
export const IconHome = (p: IconProps) => (
  <S {...p}><path d="m4 11.5 8-7 8 7" /><path d="M6.2 9.8V20h11.6V9.8" /><path d="M10 20v-5h4v5" /></S>
);
export const IconLedger = (p: IconProps) => (
  <S {...p}><path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v18H6.5A1.5 1.5 0 0 1 5 19.5z" /><path d="M19 17H6.5A1.5 1.5 0 0 0 5 19.5" /><path d="M9 7.5h6" /></S>
);
export const IconArrow = (p: IconProps) => (
  <S {...p}><path d="M5 12h13.5" /><path d="m13 6.5 5.5 5.5-5.5 5.5" /></S>
);
export const IconRefresh = (p: IconProps) => (
  <S {...p}><path d="M20 6.5V11h-4.5" /><path d="M20 11a8 8 0 1 0-2.4 5.7" /></S>
);
export const IconArchive = (p: IconProps) => (
  <S {...p}><path d="M3 6.5 4.2 4h15.6L21 6.5" /><path d="M3 6.5h18" /><path d="M5 6.5V19a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V6.5" /><path d="M10 10.5h4" /></S>
);
export const IconLock = (p: IconProps) => (
  <S {...p}><rect x="5" y="10.5" width="14" height="9.5" rx="1.6" /><path d="M8.5 10.5V7.6a3.5 3.5 0 0 1 7 0v2.9" /><path d="M12 14v3" /></S>
);
export const IconUsers = (p: IconProps) => (
  <S {...p}><circle cx="9" cy="8" r="3.4" /><path d="M3.5 20a5.5 5.5 0 0 1 11 0" /><circle cx="16.8" cy="9.4" r="2.6" /><path d="M15.6 14.8a5 5 0 0 1 5 4.2" /></S>
);
export const IconDashboard = (p: IconProps) => (
  <S {...p}><rect x="3.5" y="3.5" width="7.5" height="7.5" rx="1" /><rect x="13" y="3.5" width="7.5" height="7.5" rx="1" /><rect x="3.5" y="13" width="7.5" height="7.5" rx="1" /><rect x="13" y="13" width="7.5" height="7.5" rx="1" /></S>
);
export const IconCopy = (p: IconProps) => (
  <S {...p}><rect x="8.5" y="8.5" width="12" height="12" rx="1.6" /><path d="M15.5 8.5v-4a1 1 0 0 0-1-1h-10a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h4" /></S>
);
export const IconEye = (p: IconProps) => (
  <S {...p}><path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="3" /></S>
);
export const IconPhone = (p: IconProps) => (
  <S {...p}><path d="M7.2 3.5 9 7.6l-2 1.6a12.5 12.5 0 0 0 7.6 7.6l1.6-2 4.2 1.7-.6 3a1.7 1.7 0 0 1-1.9 1.3C10.7 19.6 4.4 13.3 3.9 6a1.7 1.7 0 0 1 1.3-1.9z" /></S>
);
export const IconCard = (p: IconProps) => (
  <S {...p}><rect x="2.5" y="5.5" width="19" height="13" rx="2" /><path d="M2.5 10h19" /><path d="M6 15h4" /></S>
);
/** Camera — for attaching a payment screenshot as proof. */
export const IconCamera = (p: IconProps) => (
  <S {...p}><path d="M4 7.5h3l1.6-2.2a1 1 0 0 1 .8-.4h5.2a1 1 0 0 1 .8.4L17 7.5h3a1 1 0 0 1 1 1V18a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18V8.5a1 1 0 0 1 1-1z" /><circle cx="12" cy="13" r="3.2" /></S>
);
/** Document-with-photo — the attached-evidence marker. */
export const IconImage = (p: IconProps) => (
  <S {...p}><rect x="3.5" y="4.5" width="17" height="15" rx="1.6" /><circle cx="9" cy="10" r="1.8" /><path d="M3.5 16.5 9 11l3.5 3.5L16 11l4.5 5" /></S>
);
