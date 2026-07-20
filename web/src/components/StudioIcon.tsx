interface StudioIconProps {
  name: "arrow" | "close" | "menu" | "user";
  size?: number;
}

export default function StudioIcon({ name, size = 20 }: StudioIconProps) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  if (name === "menu") {
    return (
      <svg {...common}>
        <title>Menu</title>
        <path d="M4 7h16M4 12h16M4 17h16" />
      </svg>
    );
  }

  if (name === "close") {
    return (
      <svg {...common}>
        <title>Close</title>
        <path d="m6 6 12 12M18 6 6 18" />
      </svg>
    );
  }

  if (name === "arrow") {
    return (
      <svg {...common}>
        <title>Continue</title>
        <path d="M5 12h14M14 7l5 5-5 5" />
      </svg>
    );
  }

  return (
    <svg {...common}>
      <title>User</title>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 21a7 7 0 0 1 14 0" />
    </svg>
  );
}
