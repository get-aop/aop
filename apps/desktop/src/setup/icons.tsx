import type { ReactElement, ReactNode } from "react";

interface IconProps {
  size?: number;
  strokeWidth?: number;
  className?: string;
}

interface SvgProps extends IconProps {
  children: ReactNode;
  fill?: string;
}

const Svg = ({ size = 18, strokeWidth = 1.8, className, children, fill = "none" }: SvgProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill={fill}
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

export const GitIcon = ({ size = 22 }: IconProps): ReactElement => (
  <Svg size={size}>
    <circle cx="6" cy="7" r="2.3" />
    <circle cx="6" cy="17" r="2.3" />
    <circle cx="18" cy="9" r="2.3" />
    <path d="M6 9.3v5.4" />
    <path d="M18 11.3c0 3-2.4 4.7-5 4.7" />
  </Svg>
);

export const GithubIcon = ({ size = 22 }: IconProps): ReactElement => (
  <Svg size={size}>
    <rect x="3" y="4.5" width="18" height="15" rx="2.6" />
    <path d="M7.5 9.5l3 2.5-3 2.5" />
    <path d="M13 15h3.5" />
  </Svg>
);

export const CpuIcon = ({ size = 22 }: IconProps): ReactElement => (
  <Svg size={size}>
    <rect x="6" y="6" width="12" height="12" rx="3" />
    <rect x="9.5" y="9.5" width="5" height="5" rx="1.2" />
    <path d="M9.5 2.5v3M14.5 2.5v3M9.5 18.5v3M14.5 18.5v3M2.5 9.5h3M2.5 14.5h3M18.5 9.5h3M18.5 14.5h3" />
  </Svg>
);

export const CheckIcon = ({ size = 16, strokeWidth = 2.6 }: IconProps): ReactElement => (
  <Svg size={size} strokeWidth={strokeWidth}>
    <path d="M20 6L9 17l-5-5" />
  </Svg>
);

export const ShieldIcon = ({ size = 19 }: IconProps): ReactElement => (
  <Svg size={size}>
    <path d="M12 3l7 2.5v5.5c0 4.3-3 7-7 8.5-4-1.5-7-4.2-7-8.5V5.5z" />
    <path d="M9 12l2 2 4-4.5" />
  </Svg>
);

export const ScanIcon = ({ size = 16, strokeWidth = 2.2 }: IconProps): ReactElement => (
  <Svg size={size} strokeWidth={strokeWidth}>
    <path d="M21 12a9 9 0 11-3-6.7" />
    <path d="M21 4v4h-4" />
  </Svg>
);

export const ReRunIcon = ({ size = 15, strokeWidth = 2.2 }: IconProps): ReactElement => (
  <Svg size={size} strokeWidth={strokeWidth}>
    <path d="M21 12a9 9 0 11-3-6.7" />
    <path d="M21 4v4h-4" />
  </Svg>
);

export const ArrowIcon = ({ size = 16, strokeWidth = 2.2 }: IconProps): ReactElement => (
  <Svg size={size} strokeWidth={strokeWidth}>
    <path d="M5 12h13M12 5l7 7-7 7" />
  </Svg>
);

export const FlagIcon = ({ size = 22 }: IconProps): ReactElement => (
  <Svg size={size}>
    <path d="M5 21V4" />
    <path d="M5 4h11l-1.6 3.2L16 11H5" />
  </Svg>
);

export const InstallGlyph = ({ size = 15, strokeWidth = 2 }: IconProps): ReactElement => (
  <Svg size={size} strokeWidth={strokeWidth}>
    <path d="M12 3v11M7.5 10.5L12 15l4.5-4.5M5 19h14" />
  </Svg>
);

export const SpinnerIcon = ({ size = 16 }: IconProps): ReactElement => (
  <Svg size={size} strokeWidth={2.4} className="aop-spin">
    <path d="M21 12a9 9 0 11-6.2-8.5" />
  </Svg>
);

/** Coding-agent glyph shown on each picker tile. */
export const AgentMark = ({ id, size = 20 }: { id: string; size?: number }): ReactElement => {
  if (id === "codex") {
    return (
      <Svg size={size} strokeWidth={1.9}>
        <path d="M12 4.5v15M5.5 8l13 8M18.5 8l-13 8" />
      </Svg>
    );
  }
  if (id === "claude") {
    return (
      <Svg size={size} strokeWidth={1.8}>
        <circle cx="12" cy="12" r="3" />
        <path d="M12 3.5v3M12 17.5v3M3.5 12h3M17.5 12h3M6 6l2 2M16 16l2 2M18 6l-2 2M8 16l-2 2" />
      </Svg>
    );
  }
  if (id === "pi") {
    return (
      <Svg size={size} strokeWidth={1.9}>
        <path d="M6 8h12M9 8v9M15 8v9" />
      </Svg>
    );
  }
  return (
    <Svg size={size} strokeWidth={1.9}>
      <path d="M9 6l-5 6 5 6M15 6l5 6-5 6" />
    </Svg>
  );
};

export const SunIcon = ({ size = 15 }: IconProps): ReactElement => (
  <Svg size={size}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.5v2M12 19.5v2M4.5 12h-2M21.5 12h-2M6 6L4.6 4.6M19.4 19.4L18 18M6 18l-1.4 1.4M19.4 4.6L18 6" />
  </Svg>
);

export const MoonIcon = ({ size = 15 }: IconProps): ReactElement => (
  <Svg size={size}>
    <path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z" />
  </Svg>
);

export const InfoIcon = ({ size = 13, strokeWidth = 1.8 }: IconProps): ReactElement => (
  <Svg size={size} strokeWidth={strokeWidth}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 8v4M12 16h.01" />
  </Svg>
);

/** AOP brand mark used in the top bar. */
export const BrandMark = ({ size = 26 }: { size?: number }): ReactElement => (
  <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
    <rect width="32" height="32" rx="8" fill="#0f1117" />
    <circle cx="10" cy="22" r="3" fill="#2dd4bf" opacity="0.9" />
    <circle cx="16" cy="18" r="2.5" fill="#fb7185" opacity="0.85" />
    <circle cx="22" cy="20" r="2" fill="#c4b5fd" opacity="0.8" />
  </svg>
);

/** Large brand mark shown on the finished overlay. */
export const BrandBig = (): ReactElement => (
  <svg width={38} height={38} viewBox="0 0 32 32" fill="none" aria-hidden="true">
    <rect width="32" height="32" rx="8" fill="#0f1117" />
    <circle cx="10" cy="22" r="3" fill="#2dd4bf" />
    <circle cx="16" cy="18" r="2.5" fill="#fb7185" />
    <circle cx="22" cy="20" r="2" fill="#c4b5fd" />
  </svg>
);
