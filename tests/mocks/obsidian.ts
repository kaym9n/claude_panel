export class Notice { constructor(public message: string) {} }
export class Plugin {}
export class ItemView {}
export class Modal {}
export class FuzzySuggestModal<T> { declare readonly _t: T; }
export class PluginSettingTab {}
export class Setting {}
export class MarkdownView {}
export class FileSystemAdapter {}
export class Component {
  addChild<T>(c: T): T { return c; }
  removeChild<T>(c: T): T { return c; }
}
export const MarkdownRenderer = { render: async (): Promise<void> => undefined };
export const Keymap = { isModEvent: (): boolean => false };
export function setIcon(): void {}
