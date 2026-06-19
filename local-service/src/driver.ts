import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { remote } from "webdriverio";
import { ErrorCode, ServiceError } from "./errors.js";
import { log } from "./logger.js";

export type Driver = Awaited<ReturnType<typeof remote>>;

const APP_PACKAGE = "com.xbloom.tbdx";
const APP_ACTIVITY = "com.chisalsoft.andite.uicontroller.activity.Activity_Splash";
const WAIT_ACTIVITY = "com.xbloom.view.activity.MainActivity";
const DEVICE_NAME = "emulator-5554";
const EXPECTED_VERSION_CODE = 2002033;

const execFileAsync = promisify(execFile);

export interface DriverOptions {
  appiumUrl: string;
  elementTimeoutMs: number;
  skipVersionCheck: boolean;
  expectedAppVersion: string;
  jobId: string;
}

function findAdb(): string | null {
  const roots: string[] = [
    process.env.ANDROID_SDK_ROOT ?? "",
    path.join(os.homedir(), "Library", "Android", "sdk"),
  ].filter((v) => v.length > 0);

  for (const root of roots) {
    const candidate = path.join(root, "platform-tools", "adb");
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

async function checkAppVersionViaAdb(jobId: string, expectedVersionName: string): Promise<void> {
  const adbPath = findAdb();
  if (!adbPath) {
    throw new ServiceError(
      ErrorCode.APP_VERSION_CHECK_FAILED,
      "adb executable not found; set ANDROID_SDK_ROOT or ensure the Android SDK is installed at ~/Library/Android/sdk",
      503,
    );
  }

  let stdout: string;
  try {
    const result = await execFileAsync(
      adbPath,
      ["-s", DEVICE_NAME, "shell", "dumpsys", "package", APP_PACKAGE],
      { timeout: 15000 },
    );
    stdout = result.stdout;
  } catch {
    throw new ServiceError(
      ErrorCode.APP_VERSION_CHECK_FAILED,
      "Failed to query app version from device; is the emulator running?",
      503,
    );
  }

  const versionNameMatch = /versionName=(\S+)/.exec(stdout);
  const versionCodeMatch = /versionCode=(\d+)/.exec(stdout);

  if (!versionNameMatch || !versionCodeMatch) {
    throw new ServiceError(
      ErrorCode.APP_VERSION_CHECK_FAILED,
      "Could not determine app version; is the device connected and app installed?",
      503,
    );
  }

  const versionName = versionNameMatch.at(1);
  const versionCodeText = versionCodeMatch.at(1);

  if (!versionName || !versionCodeText) {
    throw new ServiceError(
      ErrorCode.APP_VERSION_CHECK_FAILED,
      "Could not parse app version returned by the device.",
      503,
    );
  }

  const versionCode = Number.parseInt(versionCodeText, 10);

  log.info("App version detected", { jobId, stage: "version_check", versionName, versionCode });

  if (versionName !== expectedVersionName || versionCode !== EXPECTED_VERSION_CODE) {
    throw new ServiceError(
      ErrorCode.APP_VERSION_UNSUPPORTED,
      `App version is not supported. Expected ${expectedVersionName} (${EXPECTED_VERSION_CODE}). Set SKIP_VERSION_CHECK=true to override.`,
      409,
    );
  }
}

export async function createDriver(opts: DriverOptions): Promise<Driver> {
  if (!opts.skipVersionCheck) {
    await checkAppVersionViaAdb(opts.jobId, opts.expectedAppVersion);
  }

  const url = new URL(opts.appiumUrl);
  log.info("Creating Appium session", { jobId: opts.jobId, stage: "driver_init" });

  let driver: Driver;
  try {
    driver = await remote({
      hostname: url.hostname,
      port: Number(url.port) || 4723,
      protocol: url.protocol.replace(":", "") as "http" | "https",
      path: "/",
      connectionRetryCount: 1,
      connectionRetryTimeout: 30000,
      capabilities: {
        platformName: "Android",
        "appium:automationName": "UiAutomator2",
        "appium:deviceName": DEVICE_NAME,
        "appium:appPackage": APP_PACKAGE,
        "appium:appActivity": APP_ACTIVITY,
        "appium:appWaitActivity": WAIT_ACTIVITY,
        "appium:noReset": true,
        "appium:fullReset": false,
        "appium:newCommandTimeout": 300,
      },
    });
  } catch (err) {
    throw new ServiceError(ErrorCode.APPIUM_SESSION_ERROR, "Failed to create Appium session", 503);
  }

  return driver;
}

export async function closeDriver(driver: Driver, jobId: string): Promise<void> {
  try {
    await driver.deleteSession();
    log.info("Appium session closed", { jobId, stage: "driver_close" });
  } catch (err) {
    log.warn("Failed to close Appium session", { jobId, stage: "driver_close_warn" });
  }
}

export function id(resourceId: string): string {
  return `android=new UiSelector().resourceId("${APP_PACKAGE}:id/${resourceId}")`;
}

export function idText(resourceId: string, text: string): string {
  return `android=new UiSelector().resourceId("${APP_PACKAGE}:id/${resourceId}").text("${text}")`;
}

export function contentDesc(desc: string): string {
  return `android=new UiSelector().description("${desc}")`;
}
