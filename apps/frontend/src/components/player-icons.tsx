type IconProps = { className?: string };

const base = "currentColor";

export function PlayIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill={base} className={className}>
      <polygon points="7,4 20,12 7,20" />
    </svg>
  );
}

export function PauseIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill={base} className={className}>
      <rect x="6" y="4" width="4" height="16" />
      <rect x="14" y="4" width="4" height="16" />
    </svg>
  );
}

export function SkipNextIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill={base} className={className}>
      <polygon points="6,5 6,19 16,12" />
      <rect x="17" y="5" width="2.5" height="14" />
    </svg>
  );
}

export function SkipPreviousIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill={base} className={className}>
      <rect x="4.5" y="5" width="2.5" height="14" />
      <polygon points="18,5 18,19 8,12" />
    </svg>
  );
}

function svgIconProps(className?: string) {
  return {
    viewBox: "0 0 24 24",
    fill: "none" as const,
    stroke: base,
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className,
  };
}

export function Replay10Icon({ className }: IconProps) {
  return (
    <svg {...svgIconProps(className)}>
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <polyline points="3 4 3 9 8 9" />
      <text x="12" y="15.5" fontSize="7" stroke="none" fill={base} textAnchor="middle">
        10
      </text>
    </svg>
  );
}

export function Forward10Icon({ className }: IconProps) {
  return (
    <svg {...svgIconProps(className)}>
      <path d="M21 12a9 9 0 1 1-3-6.7" />
      <polyline points="21 4 21 9 16 9" />
      <text x="12" y="15.5" fontSize="7" stroke="none" fill={base} textAnchor="middle">
        10
      </text>
    </svg>
  );
}

export function SettingsIcon({ className }: IconProps) {
  return (
    <svg {...svgIconProps(className)}>
      <line x1="4" y1="6" x2="20" y2="6" />
      <circle cx="9" cy="6" r="2" fill={base} />
      <line x1="4" y1="12" x2="20" y2="12" />
      <circle cx="15" cy="12" r="2" fill={base} />
      <line x1="4" y1="18" x2="20" y2="18" />
      <circle cx="9" cy="18" r="2" fill={base} />
    </svg>
  );
}

export function ListIcon({ className }: IconProps) {
  return (
    <svg {...svgIconProps(className)}>
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" />
      <line x1="3" y1="12" x2="3.01" y2="12" />
      <line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  );
}

export function FullscreenIcon({ className }: IconProps) {
  return (
    <svg {...svgIconProps(className)}>
      <path d="M8 3H5a2 2 0 0 0-2 2v3" />
      <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
      <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
      <path d="M3 16v3a2 2 0 0 0 2 2h3" />
    </svg>
  );
}

export function FullscreenExitIcon({ className }: IconProps) {
  return (
    <svg {...svgIconProps(className)}>
      <path d="M8 3v3a2 2 0 0 1-2 2H3" />
      <path d="M16 3v3a2 2 0 0 0 2 2h3" />
      <path d="M21 16h-3a2 2 0 0 0-2 2v3" />
      <path d="M3 16h3a2 2 0 0 1 2 2v3" />
    </svg>
  );
}

export function VolumeHighIcon({ className }: IconProps) {
  return (
    <svg {...svgIconProps(className)}>
      <polygon points="11,5 6,9 2,9 2,15 6,15 11,19" fill={base} stroke="none" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7" />
      <path d="M19 5a10 10 0 0 1 0 14" />
    </svg>
  );
}

export function VolumeMuteIcon({ className }: IconProps) {
  return (
    <svg {...svgIconProps(className)}>
      <polygon points="11,5 6,9 2,9 2,15 6,15 11,19" fill={base} stroke="none" />
      <line x1="23" y1="9" x2="17" y2="15" />
      <line x1="17" y1="9" x2="23" y2="15" />
    </svg>
  );
}

export function CloseIcon({ className }: IconProps) {
  return (
    <svg {...svgIconProps(className)}>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

export function ChevronLeftIcon({ className }: IconProps) {
  return (
    <svg {...svgIconProps(className)}>
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}
