import type { BrewMode } from "../types.js";

interface Props {
  value: BrewMode;
  onChange: (mode: BrewMode) => void;
  disabled?: boolean;
}

const OPTIONS: { value: BrewMode; label: string; description: string }[] = [
  {
    value: "cold",
    label: "Cold",
    description: "Iced pour-over — the xBloom machine brews hot; you pour over ice after.",
  },
  {
    value: "hot",
    label: "Hot",
    description: "Classic hot pour-over directly from the xBloom machine.",
  },
];

export default function BrewModeSelector({ value, onChange, disabled = false }: Props) {
  return (
    <div
      role="radiogroup"
      aria-label="Brew mode"
      className="flex rounded-card border border-espresso/20 overflow-hidden"
    >
      {OPTIONS.map((opt) => {
        const selected = value === opt.value;
        return (
          <label
            key={opt.value}
            className={`flex-1 cursor-pointer min-h-touch flex flex-col items-center justify-center
                        gap-0.5 px-4 py-3 transition-colors select-none
                        ${selected ? "bg-espresso text-ivory" : "bg-ivory text-espresso hover:bg-espresso/5"}
                        ${disabled ? "opacity-50 cursor-not-allowed" : ""}
                        `}
          >
            <input
              type="radio"
              name="brewMode"
              value={opt.value}
              checked={selected}
              onChange={() => onChange(opt.value)}
              disabled={disabled}
              className="sr-only"
              aria-label={opt.label}
            />
            <span className="font-body font-semibold text-sm" aria-hidden="true">
              {opt.label}
            </span>
            <span className="sr-only">{opt.description}</span>
          </label>
        );
      })}
    </div>
  );
}
