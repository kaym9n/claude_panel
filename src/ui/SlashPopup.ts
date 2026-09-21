import type { CommandItem } from './commandMatch';

export class SlashPopup {
  private readonly el: HTMLElement;
  private items: CommandItem[] = [];
  private index = 0;

  constructor(parent: HTMLElement, private readonly onPick: (item: CommandItem) => void) {
    this.el = parent.createDiv({ cls: 'cp-slash-popup' });
    this.el.hide();
  }

  get isOpen(): boolean {
    return this.el.isShown();
  }

  show(items: CommandItem[]): void {
    this.items = items;
    this.index = 0;
    if (items.length === 0) {
      this.hide();
      return;
    }
    this.render();
    this.el.show();
  }

  hide(): void {
    this.el.hide();
  }

  /** 팝업이 처리한 키면 true */
  handleKey(evt: KeyboardEvent): boolean {
    if (!this.isOpen) return false;
    if (evt.key === 'ArrowDown' || evt.key === 'ArrowUp') {
      const step = evt.key === 'ArrowDown' ? 1 : -1;
      this.index = (this.index + step + this.items.length) % this.items.length;
      this.render();
    } else if (evt.key === 'Enter' || evt.key === 'Tab') {
      this.onPick(this.items[this.index]);
      this.hide();
    } else if (evt.key === 'Escape') {
      this.hide();
    } else {
      return false;
    }
    evt.preventDefault();
    return true;
  }

  private render(): void {
    this.el.empty();
    this.items.forEach((item, i) => {
      const row = this.el.createDiv({ cls: 'cp-slash-item' });
      row.toggleClass('is-selected', i === this.index);
      row.createSpan({ cls: 'cp-slash-name', text: `/${item.name}` });
      if (item.argumentHint) row.createSpan({ cls: 'cp-slash-hint', text: item.argumentHint });
      if (item.description) row.createDiv({ cls: 'cp-slash-desc', text: item.description });
      row.addEventListener('mousedown', (evt) => {
        evt.preventDefault(); // 입력창 포커스 유지
        this.onPick(item);
        this.hide();
      });
    });
    this.el.querySelector('.is-selected')?.scrollIntoView({ block: 'nearest' });
  }
}
