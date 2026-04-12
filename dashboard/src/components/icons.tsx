import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function BaseIcon({ children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export function JobsIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M7 9h10M7 13h6M7 17h4" />
    </BaseIcon>
  );
}

export function GpuIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <rect x="4" y="6" width="12" height="12" rx="2" />
      <path d="M16 10h3M16 14h3M8 3v3M12 3v3M8 18v3M12 18v3M7 9h6v6H7z" />
    </BaseIcon>
  );
}

export function CreditIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <rect x="3" y="6" width="18" height="12" rx="2" />
      <path d="M3 10h18M8 14h4" />
    </BaseIcon>
  );
}

export function ClockIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v6l4 2" />
    </BaseIcon>
  );
}

export function SunIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8" />
    </BaseIcon>
  );
}

export function MoonIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M20 14.3A8 8 0 1 1 9.7 4 6.5 6.5 0 1 0 20 14.3z" />
    </BaseIcon>
  );
}

export function ChatIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M4 5h16v10H8l-4 4V5z" />
      <path d="M8 9h8M8 12h6" />
    </BaseIcon>
  );
}

export function SendIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="m3 12 18-9-5 18-4-6-9-3z" />
    </BaseIcon>
  );
}

export function ConnectionIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M4 9a12 12 0 0 1 16 0M7 12a8 8 0 0 1 10 0M10.5 15a4 4 0 0 1 3 0" />
      <circle cx="12" cy="18" r="1.2" fill="currentColor" stroke="none" />
    </BaseIcon>
  );
}
