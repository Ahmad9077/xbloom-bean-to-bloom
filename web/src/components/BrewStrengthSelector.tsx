import type { BrewStrength } from "../types.js";

interface Props {
  value: BrewStrength;
  onChange: (strength: BrewStrength) => void;
  disabled?: boolean;
}

const OPTIONS: Array<{ value: BrewStrength; label: string }> = [
  { value: "strong", label: "Strong" },
  { value: "soft", label: "Soft" },
];

export default function BrewStrengthSelector({ value, onChange, disabled = false }: Props) {
  return (
    <div
      role="radiogroup"
      aria-label="Brew strength"
      className="grid grid-cols-2 overflow-hidden rounded-card border border-espresso/20"
    >
      {OPTIONS.map((option) => {
        const selected = value === option.value;
        const id = `brew-strength-${option.value}`;
        return (
          <div key={option.value} className="relative">
            <input
              id={id}
              type="radio"
              name="strength"
              value={option.value}
              checked={selected}
              onChange={() => onChange(option.value)}
              disabled={disabled}
              className="peer sr-only"
              aria-label={option.label}
            />
            <label
              htmlFor={id}
              className={`flex min-h-touch cursor-pointer select-none items-center justify-center px-4 py-3
                          font-body text-sm font-semibold transition-colors
                          peer-focus-visible:outline peer-focus-visible:outline-2
                          peer-focus-visible:outline-offset-[-3px] peer-focus-visible:outline-terracotta
                          ${selected ? "bg-espresso text-ivory" : "bg-ivory text-espresso hover:bg-espresso/5"}
                          ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
            >
              {option.label}
            </label>
          </div>
        );
      })}
    </div>
  );
}
