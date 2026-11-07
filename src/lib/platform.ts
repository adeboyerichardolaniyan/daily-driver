import { isTauri } from "@tauri-apps/api/core";
export async function openFocusWindow() {
  if (isTauri()) {
    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    const existing = await WebviewWindow.getByLabel("focus");
    if (existing) {
      await existing.setFocus();
      return;
    }
    const window = new WebviewWindow("focus", {
      url: "/?view=focus",
      title: "Focus · Daily Driver",
      width: 680,
      height: 620,
      minWidth: 380,
      minHeight: 500,
    });
    await new Promise<void>((resolve, reject) => {
      window.once("tauri://created", () => resolve());
      window.once("tauri://error", (event) =>
        reject(new Error(String(event.payload))),
      );
    });
  } else {
    const popup = window.open(
      "/?view=focus",
      "daily-driver-focus",
      "popup,width=680,height=620",
    );
    if (!popup)
      throw new Error("Allow pop-up windows to open a separate focus view.");
    popup.focus();
  }
}
