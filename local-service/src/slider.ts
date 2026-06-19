import type { Driver } from "./driver.js";
import { ErrorCode, ServiceError } from "./errors.js";
import { log } from "./logger.js";

const THUMB_PADDING = 18; // px from track edge to effective range

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
  const baseTargetX = calcTargetX(bounds, targetValue, min, max);

  let tapX = baseTargetX;
  let prevActual: number | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0 && prevActual !== undefined) {
      // Bounded correction: if actual mapped to prevActualX but we need baseTargetX,
      // apply the observed drift beyond the intended position, clamped to track edges.
      const prevActualX = calcTargetX(bounds, prevActual, min, max);
      const drift = baseTargetX - prevActualX;
      tapX = Math.max(trackLeft, Math.min(trackRight, baseTargetX + drift));
    }

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
    const actual = parseValue(actualText);

    if (actual === targetValue) {
      log.debug("Slider set ok", { jobId, stage, targetValue, actual, attempt });
      return;
    }

    log.debug("Slider retry", { jobId, stage, targetValue, actual, attempt });
    prevActual = actual;

    if (attempt === maxRetries) {
      throw new ServiceError(
        ErrorCode.SLIDER_SET_FAILED,
        `Slider ${stage} stuck at ${actual} after ${maxRetries} retries; target was ${targetValue}`,
        500,
      );
    }
  }
}

const PKG = "com.xbloom.tbdx";
const s = (resourceId: string) => `android=new UiSelector().resourceId("${PKG}:id/${resourceId}")`;

export async function setSliderDose(
  driver: Driver,
  target: number,
  maxRetries: number,
  jobId: string,
): Promise<void> {
  await setSlider(
    driver,
    s("doseSb"),
    s("doseTv"),
    target,
    5,
    18,
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
