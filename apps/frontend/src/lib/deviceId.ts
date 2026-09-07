// A stable id for this browser/profile, persisted across reloads — used by watch parties to mint
// a per-device LiveKit identity (`${role}-${userId}-${deviceId}`, see
// apps/backend/src/routes/watchParties.ts) instead of a fixed-per-host or fresh-per-request one.
// Without this, the same user opening the same party from two tabs/devices would collide on a
// single reused identity and LiveKit would silently disconnect whichever connection held it first.
const DEVICE_ID_KEY = "campfire_device_id";

export function getDeviceId(): string {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

// Shown to the user in the "join from this device too?" / main-vs-companion prompts — not a
// precise UA parse, just enough to tell two of your own devices apart at a glance.
export function getDeviceLabel(): string {
  const ua = navigator.userAgent;
  const os = ua.includes("Windows") ? "Windows" : ua.includes("Mac") ? "Mac" : ua.includes("Linux") ? "Linux" : "this device";
  const browser = ua.includes("Edg/") ? "Edge" : ua.includes("Chrome/") ? "Chrome" : ua.includes("Firefox/") ? "Firefox" : ua.includes("Safari/") ? "Safari" : "Browser";
  return `${browser} on ${os}`;
}
