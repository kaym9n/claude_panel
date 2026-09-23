import { setIcon } from 'obsidian';

/** Native buttons retain keyboard operation and a label even without visible text. */
export function buttonIcon(button: HTMLButtonElement, icon: string, label: string): void {
  button.addClass('cp-icon-action');
  button.setAttribute('aria-label', label);
  button.title = label;
  setIcon(button, icon);
  button.querySelector('svg')?.setAttribute('aria-hidden', 'true');
}

export function inlineIcon(parent: HTMLElement, icon: string): HTMLElement {
  const el = parent.createSpan({ cls: 'cp-inline-icon', attr: { 'aria-hidden': 'true' } });
  setIcon(el, icon);
  return el;
}
