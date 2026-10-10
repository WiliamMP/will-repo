import { ask } from "@tauri-apps/plugin-dialog";

/** Native "are you sure?" dialog (like MessageDlg with mtWarning in Delphi) */
export const confirm = (message: string, title: string, okLabel: string) =>
  ask(message, { title, kind: "warning", okLabel, cancelLabel: "Cancelar" });
