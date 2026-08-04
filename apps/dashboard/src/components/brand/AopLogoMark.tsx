interface AopLogoMarkProps {
  size?: number;
  className?: string;
  animated?: boolean;
}

export const AopLogoMark = ({ size = 32, className = "", animated = false }: AopLogoMarkProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 32 32"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    role="img"
    aria-label="AOP logo"
    className={className}
  >
    {/* Fixed dark brand plate — intentionally theme-independent (the bubbles
        below need a constant dark backdrop), so it stays a literal, not a token. */}
    <rect width="32" height="32" rx="8" fill="#0f1117" />
    <circle
      cx="10"
      cy="22"
      r="3"
      fill="var(--color-running)"
      opacity="0.9"
      className={animated ? "logo-bubble-1" : undefined}
    />
    <circle
      cx="16"
      cy="18"
      r="2.5"
      fill="var(--color-blocked)"
      opacity="0.85"
      className={animated ? "logo-bubble-2" : undefined}
    />
    <circle
      cx="22"
      cy="20"
      r="2"
      fill="var(--color-queued)"
      opacity="0.8"
      className={animated ? "logo-bubble-3" : undefined}
    />
  </svg>
);
