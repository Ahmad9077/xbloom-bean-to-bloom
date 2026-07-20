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
    <ol className="pour-list" aria-label="Pour timeline">
      {pours.map((pour, index) => (
        <li key={`${pour.label}-${index}`}>
          <span className="pour-number" aria-hidden="true">
            {STEP_LABELS[pour.label] ?? pour.label.charAt(0)}
          </span>
          <div className="pour-title">
            <strong>{pour.label}</strong>
            <small>{pour.pattern}</small>
          </div>
          <dl>
            <div>
              <dt>Volume</dt>
              <dd>{pour.volumeMl} ml</dd>
            </div>
            <div>
              <dt>Temp</dt>
              <dd>{pour.tempC} °C</dd>
            </div>
            <div>
              <dt>Flow</dt>
              <dd>{pour.flowRateMlPerSec} ml/s</dd>
            </div>
            <div>
              <dt>Pause</dt>
              <dd>{pour.pauseSec} s</dd>
            </div>
          </dl>
        </li>
      ))}
    </ol>
  );
}
