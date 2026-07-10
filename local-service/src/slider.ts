import type { Driver } from "./driver.js";
import { ErrorCode, ServiceError } from "./errors.js";
import { log } from "./logger.js";

const THUMB_PADDING = 18; // px from track edge to effective range
const FINE_SCAN_PIXEL_OFFSETS = [1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24, 32];

interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function getElementBounds(driver: Driver, selector: string): Promise<Bounds> {
  const el = await driver.$(selector);
  await el.waitForExist({ timeout: 6000 });
  const location = await el.getLocation();
  const size = await el.getSize();
  return { x: location.x, y: location.y, width: size.width, height: size.height };
}

function calcTargetX(bounds: Bounds, value: number, min: number, max: number): number {
  const trackLeft = bounds.x + THUMB_PADDING;
  const trackRight = bounds.x + bounds.width - THUMB_PADDING;
  const ratio = (value - min) / (max - min);
  return Math.round(trackLeft + ratio * (trackRight - trackLeft));
}

function clampTapX(value: number, trackLeft: number, trackRight: number): number {
  return Math.round(Math.max(trackLeft, Math.min(trackRight, value)));
}

async function tapSliderAndRead(
  driver: Driver,
  tapX: number,
  centerY: number,
  valueSelector: string,
  parseValue: (text: string) => number,
): Promise<number> {
  await driver
    .action("pointer", {
      id: "touch0",
      parameters: { pointerType: "touch" },
    })
    .move({ x: tapX, y: centerY, origin: "viewport" })
    .down({ button: 0 })
    .pause(50)
    .up({ button: 0 })
    .perform();

  await driver.pause(180);

  const tvEl = await driver.$(valueSelector);
  const actualText = await tvEl.getText();
  return parseValue(actualText);
}

function fineScanCandidates(
  centerTapXs: number[],
  trackLeft: number,
  trackRight: number,
  preferredDirection: "left" | "right" | "both",
): number[] {
  const candidates: number[] = [];
  const seen = new Set<number>();
  const add = (value: number) => {
    const x = clampTapX(value, trackLeft, trackRight);
    if (!seen.has(x)) {
      seen.add(x);
      candidates.push(x);
    }
  };

  for (const centerTapX of centerTapXs) {
    for (const offset of FINE_SCAN_PIXEL_OFFSETS) {
      if (preferredDirection === "left") {
        add(centerTapX - offset);
        add(centerTapX + offset);
      } else if (preferredDirection === "right") {
        add(centerTapX + offset);
        add(centerTapX - offset);
      } else {
        add(centerTapX - offset);
        add(centerTapX + offset);
      }
    }
  }

  return candidates;
}

export async function setSlider(
  driver: Driver,
  sliderSelector: string,
  valueSelector: string,
  targetValue: number,
  min: number,
  max: number,
  parseValue: (text: string) => number,
  maxRetries: number,
  jobId: string,
  stage: string,
): Promise<void> {
  const bounds = await getElementBounds(driver, sliderSelector);
  const centerY = Math.round(bounds.y + bounds.height / 2);
  const trackLeft = bounds.x + THUMB_PADDING;
  const trackRight = bounds.x + bounds.width - THUMB_PADDING;
  const pxPerValue = (trackRight - trackLeft) / (max - min);
  const baseTargetX = calcTargetX(bounds, targetValue, min, max);

  let tapX = baseTargetX;
  let prevActual: number | undefined;
  let lowerTapX: number | undefined;
  let upperTapX: number | undefined;
  let lastActual: number | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0 && lowerTapX !== undefined && upperTapX !== undefined) {
      // The slider can quantize a calculated position to the values immediately
      // below and above the target. Bisect the observed tap coordinates instead
      // of applying another full-value correction and oscillating forever.
      tapX = clampTapX((lowerTapX + upperTapX) / 2, trackLeft, trackRight);
    } else if (attempt > 0 && prevActual !== undefined) {
      // Accumulate the observed error from the previous tap so retries converge
      // toward the reachable coordinate rather than oscillating around it.
      tapX = clampTapX(tapX + (targetValue - prevActual) * pxPerValue, trackLeft, trackRight);
    }

    const actual = await tapSliderAndRead(driver, tapX, centerY, valueSelector, parseValue);
    lastActual = actual;

    if (actual === targetValue) {
      log.debug("Slider set ok", { jobId, stage, targetValue, actual, attempt });
      return;
    }

    log.debug("Slider retry", { jobId, stage, targetValue, actual, attempt });
    if (actual < targetValue) {
      lowerTapX = lowerTapX === undefined ? tapX : Math.max(lowerTapX, tapX);
    } else if (actual > targetValue) {
      upperTapX = upperTapX === undefined ? tapX : Math.min(upperTapX, tapX);
    }
    prevActual = actual;
  }

  const preferredDirection =
    lastActual === undefined ? "both" : lastActual > targetValue ? "left" : "right";
  const candidates = fineScanCandidates(
    [tapX, baseTargetX],
    trackLeft,
    trackRight,
    preferredDirection,
  );
  const fineScanTrace: string[] = [];
  for (let scanAttempt = 0; scanAttempt < candidates.length; scanAttempt++) {
    const scanTapX = candidates[scanAttempt] ?? tapX;
    const actual = await tapSliderAndRead(driver, scanTapX, centerY, valueSelector, parseValue);
    lastActual = actual;
    fineScanTrace.push(`${scanTapX}:${actual}`);

    if (actual === targetValue) {
      log.debug("Slider fine scan set ok", {
        jobId,
        stage,
        targetValue,
        actual,
        scanAttempt,
      });
      return;
    }

    log.debug("Slider fine scan retry", {
      jobId,
      stage,
      targetValue,
      actual,
      scanAttempt,
    });
  }

  throw new ServiceError(
    ErrorCode.SLIDER_SET_FAILED,
    `Slider ${stage} stuck at ${lastActual ?? "unknown"} after ${maxRetries} retries; target was ${targetValue}; fine scan returned ${fineScanTrace.join(",")}`,
    500,
  );
}

const PKG = "com.xbloom.tbdx";
const s = (resourceId: string) => `android=new UiSelector().resourceId("${PKG}:id/${resourceId}")`;

export async function setSliderDose(
  driver: Driver,
  target: number,
  maxRetries: number,
  jobId: string,
  dripper: "Omni" | "Other" = "Other",
): Promise<void> {
  const maxDoseG = dripper === "Other" ? 25 : 18;
  await setSlider(
    driver,
    s("doseSb"),
    s("doseTv"),
    target,
    5,
    maxDoseG,
    Number.parseInt,
    maxRetries,
    jobId,
    "dose",
  );
}

export async function setSliderRatio(
  driver: Driver,
  denominator: number,
  maxRetries: number,
  jobId: string,
): Promise<void> {
  const parseRatio = (text: string): number => {
    const m = /^1:(\d+)$/.exec(text.trim());
    return m ? Number.parseInt(m[1] ?? "0", 10) : 0;
  };
  await setSlider(
    driver,
    s("coffeeWaterSb"),
    s("coffeeWaterTv"),
    denominator,
    5,
    25,
    parseRatio,
    maxRetries,
    jobId,
    "ratio",
  );
}

export async function setSliderGrind(
  driver: Driver,
  target: number,
  maxRetries: number,
  jobId: string,
): Promise<void> {
  await setSlider(
    driver,
    s("grindSizeSb"),
    s("grindSizeTv"),
    target,
    1,
    80,
    Number.parseInt,
    maxRetries,
    jobId,
    "grindSize",
  );
}

export async function setSliderRpm(
  driver: Driver,
  target: number,
  maxRetries: number,
  jobId: string,
): Promise<void> {
  await setSlider(
    driver,
    s("rotatingSpeedSb"),
    s("rotatingSpeedTv"),
    target,
    60,
    120,
    Number.parseInt,
    maxRetries,
    jobId,
    "rpm",
  );
}
