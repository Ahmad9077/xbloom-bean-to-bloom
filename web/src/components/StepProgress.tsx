export type StepStatus = "complete" | "active" | "next";

export interface ProgressStep {
  label: string;
  status: StepStatus;
}

interface Props {
  steps: ProgressStep[];
}

export default function StepProgress({ steps }: Props) {
  return (
    <nav aria-label="Progress" className="w-full">
      <ol className="flex items-center justify-center gap-0">
        {steps.map((step, i) => (
          <li key={step.label} className="flex items-center">
            <div className="flex flex-col items-center gap-1">
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold
                  ${
                    step.status === "complete"
                      ? "bg-espresso text-ivory"
                      : step.status === "active"
                        ? "bg-terracotta text-ivory"
                        : "bg-espresso/10 text-espresso/40"
                  }`}
                aria-hidden="true"
              >
                {step.status === "complete" ? (
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                    <path
                      d="M2 6l3 3 5-5"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : (
                  i + 1
                )}
              </div>
              <span
                className={`text-[10px] font-semibold uppercase tracking-widest
                  ${
                    step.status === "active"
                      ? "text-terracotta"
                      : step.status === "complete"
                        ? "text-espresso"
                        : "text-espresso/30"
                  }`}
                aria-current={step.status === "active" ? "step" : undefined}
              >
                {step.label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div
                className={`h-px w-8 mx-1 mb-4 ${step.status === "complete" ? "bg-espresso/40" : "bg-espresso/10"}`}
                aria-hidden="true"
              />
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
