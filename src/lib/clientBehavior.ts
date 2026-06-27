export type ClientBehaviorSettings = {
  launchOnStartup: boolean;
  keepActiveOnClose: boolean;
};

export const behaviorStorageKey = "immobil-ia-client-behavior";

export function loadBehaviorSettings(): ClientBehaviorSettings {
  try {
    return JSON.parse(localStorage.getItem(behaviorStorageKey) || "") as ClientBehaviorSettings;
  } catch {
    return {
      launchOnStartup: false,
      keepActiveOnClose: true,
    };
  }
}

export function saveBehaviorSettings(settings: ClientBehaviorSettings) {
  localStorage.setItem(behaviorStorageKey, JSON.stringify(settings));
}

export async function applyStartupPreference(enabled: boolean) {
  if (!("__TAURI_INTERNALS__" in window)) return;
  const autostart = await import("@tauri-apps/plugin-autostart");
  if (enabled) {
    await autostart.enable();
  } else {
    await autostart.disable();
  }
}
