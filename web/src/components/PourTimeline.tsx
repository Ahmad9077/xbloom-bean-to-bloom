import type { Pour } from "../types.js";

interface Props {
  pours: Pour[];
}

const STEP_LABELS: Record<string, string> = {
  Bloom: "B",
  "Pour 2": "2",
  "Pour 3": "3",
  "Pour 4": "4",
  "Pour 5": "5",
};

export default function PourTimeline({ pours }: Props) {
  return (
    <ol className="space-y-3" aria-label="Pour timeline">
      {pours.map((pour) => (
        <li key={pour.label} className="flex gap-4 items-start bg-espresso/5 rounded-[16px] p-4">
          <div
            className="flex-shrink-0 w-8 h-8 rounded-full bg-terracotta text-ivory
                        flex items-center justify-center text-xs font-semibold"
            aria-hidden="true"
          >
            {STEP_LABELS[pour.label] ?? pour.label.charAt(0)}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm text-espresso">{pour.label}</p>
            <dl className="mt-1 grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs text-espresso/70">
              <div>
                <dt className="inline">Volume </dt>
                <dd className="inline font-medium text-espresso">{pour.volumeMl} ml</dd>
              </div>
              <div>
                <dt className="inline">Temp </dt>
                <dd className="inline font-medium text-espresso">{pour.tempC} °C</dd>
              </div>
              <div>
                <dt className="inline">Flow </dt>
                <dd className="inline font-medium text-espresso">{pour.flowRateMlPerSec} ml/s</dd>
              </div>
              {pour.pauseSec > 0 && (
                <div>
                  <dt className="inline">Pause </dt>
                  <dd className="inline font-medium text-espresso">{pour.pauseSec} s</dd>
                </div>
              )}
              <div>
                <dt className="inline">Pattern </dt>
                <dd className="inline font-medium text-espresso capitalize">{pour.pattern}</dd>
              </div>
            </dl>
          </div>
        </li>
      ))}
    </ol>
  );
}
