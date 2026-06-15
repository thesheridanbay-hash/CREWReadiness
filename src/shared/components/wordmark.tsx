import Image from "next/image";

/**
 * SonarCoach brand lockup: the S-tile logo + the two-tone wordmark
 * (Sonar pine / Coach gold — the CrewYield family palette). Single source for
 * the brand mark — used in the
 * sidebar, the auth screens, and the marketing header. `iconSize` and
 * `textClass` size it per surface; `className` adds layout (padding, etc.).
 */
export function Wordmark({
  iconSize = 40,
  textClass = "text-2xl",
  className = "",
  onDark = false,
}: {
  iconSize?: number;
  textClass?: string;
  className?: string;
  /** On the pine sidebar/header, "Sonar" needs to be light (pine-on-pine is
   * invisible) and "Coach" a brighter gold. */
  onDark?: boolean;
}) {
  return (
    <div className={`flex items-center gap-x-3 ${className}`.trim()}>
      <Image src="/logo.svg" alt="SonarCoach" height={iconSize} width={iconSize} />
      <span className={`font-display font-extrabold tracking-tight ${textClass}`}>
        <span className={onDark ? "text-white" : "text-brand"}>Sonar</span>
        <span className={onDark ? "text-gold-500" : "text-gold-700"}>Coach</span>
      </span>
    </div>
  );
}
