/**
 * Plain help for a camera or microphone that won't start, written for the
 * browser and computer in front of the person (the meeting's video and the
 * Test video and audio page). No app imports, so the unit tests can load it.
 */

export type Browser = "chrome" | "edge" | "safari" | "firefox" | "other";
export type Platform = "mac" | "windows" | "ipad" | "iphone" | "android" | "other";
export type DeviceTrouble = "blocked" | "in-use" | "missing" | "other";

export interface DeviceHelp {
  title: string;
  steps: string[];
}

/** The browser and computer, from the browser's own description of itself. */
export function detectBrowser(userAgent: string, touchPoints = 0): { browser: Browser; platform: Platform } {
  const ua = userAgent;
  const platform: Platform = /iPhone/.test(ua)
    ? "iphone"
    : /iPad/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1)
      ? "ipad"
      : /Android/.test(ua)
        ? "android"
        : /Macintosh|Mac OS X/.test(ua)
          ? "mac"
          : /Windows/.test(ua)
            ? "windows"
            : "other";
  const browser: Browser = /Edg\//.test(ua)
    ? "edge"
    : /Firefox\/|FxiOS/.test(ua)
      ? "firefox"
      : /Chrome\/|CriOS/.test(ua)
        ? "chrome"
        : /Safari\//.test(ua)
          ? "safari"
          : "other";
  return { browser, platform };
}

/**
 * What went wrong, from the browser's error: blocked (permission refused),
 * in use (another app or tab has it), or missing (no camera or microphone).
 */
export function troubleFrom(err: unknown): DeviceTrouble {
  const e = err as { name?: string; message?: string } | undefined;
  const name = e?.name ?? "";
  if (name === "NotAllowedError" || name === "SecurityError" || /permission|denied/i.test(e?.message ?? "")) return "blocked";
  if (name === "NotReadableError" || name === "AbortError" || /in use|could not start/i.test(e?.message ?? "")) return "in-use";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "missing";
  return "other";
}

const browserNames: Record<Browser, string> = { chrome: "Chrome", edge: "Edge", safari: "Safari", firefox: "Firefox", other: "your browser" };

/** Step-by-step help for this browser and computer. */
export function deviceHelp(trouble: DeviceTrouble, browser: Browser, platform: Platform): DeviceHelp {
  const b = browserNames[browser];
  if (trouble === "in-use") {
    return {
      title: "Your camera or microphone is busy",
      steps: [
        "Another app or browser tab is using it: Zoom, Teams, FaceTime, OBS, or another meeting window.",
        "Close that app or tab (or leave its call).",
        "Then press Try again here.",
      ],
    };
  }
  if (trouble === "missing") {
    return {
      title: "No camera or microphone was found",
      steps: [
        "Check the camera or headset is plugged in and switched on.",
        "On a laptop, check the camera isn't covered or turned off with a key or switch.",
        "Then press Try again here. You can still join with sound only.",
      ],
    };
  }
  if (trouble === "other") {
    return {
      title: "The camera or microphone didn't start",
      steps: ["Close other apps that use the camera or microphone.", `Reload this page, then press Try again.`, "If it still doesn't work, try Chrome or Edge."],
    };
  }

  // Blocked: allow it in the browser, and (on a Mac or Windows) for the browser itself.
  const steps: string[] = [];
  if (platform === "ipad" || platform === "iphone") {
    steps.push(
      browser === "safari"
        ? "Tap the “aA” button at the left of the address bar, then Website Settings. Set Camera and Microphone to Allow."
        : `Open the Settings app, scroll down to ${b}, and turn on Camera and Microphone.`,
      "Come back to this page and press Try again."
    );
    return { title: "Allow the camera and microphone", steps };
  }
  if (platform === "android") {
    steps.push(
      `Tap the icon at the left of the address bar, then Permissions. Allow Camera and Microphone.`,
      "Come back to this page and press Try again."
    );
    return { title: "Allow the camera and microphone", steps };
  }
  if (browser === "safari") {
    steps.push("In the menu bar, choose Safari, then Settings for This Website (or Settings, then Websites).", "Set Camera and Microphone to Allow.");
  } else if (browser === "firefox") {
    steps.push("Click the camera icon at the left of the address bar.", "Remove the “Blocked” entries for the camera and microphone, then reload the page.");
  } else {
    steps.push(`Click the icon at the left of the address bar (it looks like two sliders or a padlock).`, "Turn on Camera and Microphone.", "Reload the page if it asks you to.");
  }
  if (platform === "mac") {
    steps.push(
      `If it still doesn't work: open the Apple menu, then System Settings, then Privacy & Security. Under Camera, and again under Microphone, turn on ${b}. Quit ${b} and open it again.`
    );
  } else if (platform === "windows") {
    steps.push(`If it still doesn't work: open Start, then Settings, then Privacy & security. Under Camera, and again under Microphone, turn on access for apps and for ${b}.`);
  }
  steps.push("Then press Try again here.");
  return { title: "Allow the camera and microphone", steps };
}
