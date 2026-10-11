// The app's iOS menus (a task's menu, the timer lengths), opened through one
// place so the rest of the app can tell that one is up: iOS drops a sheet
// presented over a menu without saying so.
import { ActionSheetIOS, type ActionSheetIOSOptions } from "react-native";

let open = 0;

/** `ActionSheetIOS.showActionSheetWithOptions`, counted as open until it is answered. */
export function showActionSheet(options: ActionSheetIOSOptions, callback: (buttonIndex: number) => void): void {
  open += 1;
  let answered = false;
  ActionSheetIOS.showActionSheetWithOptions(options, (buttonIndex) => {
    if (!answered) {
      answered = true;
      open = Math.max(0, open - 1);
    }
    callback(buttonIndex);
  });
}

/** One of the app's menus is on screen. */
export function actionSheetOpen(): boolean {
  return open > 0;
}

/** Test-only: no menu is open. */
export function __resetActionSheetForTests(): void {
  open = 0;
}
