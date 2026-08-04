import { AopLogoMark } from "./brand/AopLogoMark";

interface LogoProps {
  showWordmark?: boolean;
  size?: "sm" | "md" | "lg";
  animated?: boolean;
}

const sizeMap = {
  sm: { icon: 24, wordmark: "text-base" },
  md: { icon: 28, wordmark: "text-lg" },
  lg: { icon: 32, wordmark: "text-lg" },
};

export const Logo = ({ showWordmark = true, size = "md", animated = false }: LogoProps) => {
  const { icon, wordmark } = sizeMap[size];

  return (
    <div className="flex items-center gap-2.5">
      <AopLogoMark size={icon} animated={animated} />
      {showWordmark ? (
        <span className={`font-sans ${wordmark} font-bold tracking-tight text-text`}>AOP</span>
      ) : null}
    </div>
  );
};
