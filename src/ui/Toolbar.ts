import { Menu, setIcon } from 'obsidian';
import { inlineIcon } from './icons';
import type { EffortLevel, ModelInfo, PermissionMode } from '@anthropic-ai/claude-agent-sdk';

export const MODE_ORDER: PermissionMode[] = ['default', 'acceptEdits', 'plan', 'auto'];
export const EFFORT_LEVELS: EffortLevel[] = ['low', 'medium', 'high', 'xhigh', 'max'];
const MODE_LABEL: Record<string, string> = { default: '기본', acceptEdits: '편집 자동', plan: '계획', auto: 'auto', dontAsk: 'dontAsk', bypassPermissions: '전체 허용' };
const FALLBACK_MODELS = [
  { value: 'opus', label: 'Opus' },
  { value: 'sonnet', label: 'Sonnet' },
  { value: 'haiku', label: 'Haiku' },
];

export function nextMode(current: PermissionMode | null): PermissionMode {
  const i = current ? MODE_ORDER.indexOf(current) : -1;
  return MODE_ORDER[(i + 1) % MODE_ORDER.length];
}

export function effortOptions(models: ModelInfo[], model: string | null): EffortLevel[] {
  const info = model ? models.find((m) => m.value === model || m.resolvedModel === model) : undefined;
  if (info?.supportsEffort === false) return [];
  return info?.supportedEffortLevels?.length ? [...info.supportedEffortLevels] : [...EFFORT_LEVELS];
}

/** 새 모델이 이 선택값을 지원하면 그대로, 아니면 undefined(선택 해제)를 돌려준다. */
export function keepEffort(levels: EffortLevel[], selected: string): EffortLevel | undefined {
  return selected && levels.includes(selected as EffortLevel) ? (selected as EffortLevel) : undefined;
}

export function modeOptions(current: string | null): { value: string; label: string }[] {
  const values: string[] = [...MODE_ORDER];
  if (current && !values.includes(current)) values.push(current);
  const list = values.map((value) => ({ value, label: MODE_LABEL[value] ?? value }));
  return current ? list : [{ value: '', label: '권한: 설정값' }, ...list];
}

export interface ToolbarHandlers {
  onModel(value: string | undefined): void | Promise<void>;
  onEffort(value: EffortLevel | undefined): void | Promise<void>;
  onMode(mode: PermissionMode): void | Promise<void>;
  onError(message: string): void;
}

export class Toolbar {
  private readonly modelSel: HTMLButtonElement;
  private readonly effortSel: HTMLButtonElement;
  private readonly modeSel: HTMLButtonElement;
  private readonly contextEl: HTMLElement;
  private models: ModelInfo[] = [];
  private resolvedModel: string | null = null;
  private resolvedEffort: string | null = null;
  private selection = { model: '', effort: '', mode: '' };
  private epoch = 0;

  constructor(parent: HTMLElement, private readonly h: ToolbarHandlers) {
    const row = parent.createDiv({ cls: 'cp-toolbar' });
    this.modeSel = row.createEl('button', { cls: 'cp-meta-button cp-mode-button', attr: { 'aria-label': '권한 모드 (Shift+Tab)', 'aria-haspopup': 'menu' } });
    this.contextEl = row.createSpan({ cls: 'cp-context', attr: { 'aria-label': '컨텍스트 사용률', title: '대화 컨텍스트 사용률 · 계정 한도와 별개' } });
    this.modelSel = row.createEl('button', { cls: 'cp-meta-button cp-model-button', attr: { 'aria-label': '모델', 'aria-haspopup': 'menu' } });
    this.effortSel = row.createEl('button', { cls: 'cp-meta-button cp-effort-button', attr: { 'aria-label': '추론 강도', 'aria-haspopup': 'menu' } });
    this.modelSel.addEventListener('click', () => this.openChoices('model'));
    this.effortSel.addEventListener('click', () => this.openChoices('effort'));
    this.modeSel.addEventListener('click', () => this.openChoices('mode'));
    this.reset();
  }

  reset(): void {
    this.epoch++;
    this.models = [];
    this.resolvedModel = null;
    this.resolvedEffort = null;
    this.selection = { model: '', effort: '', mode: '' };
    this.setDisabled(false);
    this.render();
    this.setContext(null);
  }

  setModels(models: ModelInfo[]): void { this.models = models; this.render(); }
  setResolvedModel(model: string): void {
    if (this.resolvedModel === model) return;
    this.resolvedModel = model; this.render();
  }
  setResolvedEffort(effort: string | null): void { this.resolvedEffort = effort; this.render(); }
  setMode(mode: string | null): void { this.selection.mode = mode ?? ''; this.render(); }

  setContext(percentage: number | null): void {
    this.contextEl.empty();
    inlineIcon(this.contextEl, 'chart-pie');
    this.contextEl.createSpan({ text: percentage === null ? '—' : `${Math.round(percentage)}%` });
    this.contextEl.setAttribute('aria-label', percentage === null ? '컨텍스트 미확인' : `컨텍스트 ${Math.round(percentage)}% 사용`);
    this.contextEl.toggleClass('is-high', percentage !== null && percentage >= 80);
  }

  private async change(key: keyof typeof this.selection, value: string, apply: (value: string) => void | Promise<void>): Promise<void> {
    const epoch = this.epoch;
    const previous = { ...this.selection };
    this.setDisabled(true);
    try {
      await apply(value);
      if (this.epoch !== epoch) return;
      this.selection[key] = value;
      if (key === 'model') {
        this.resolvedModel = null;
        this.resolvedEffort = null;
        const kept = keepEffort(effortOptions(this.models, value), this.selection.effort);
        if (this.selection.effort && !kept) {
          try {
            await this.h.onEffort(undefined);
            if (this.epoch === epoch) this.selection.effort = '';
          } catch (error) {
            if (this.epoch === epoch) this.h.onError(`모델은 변경됐지만 추론 기본값 적용에 실패했습니다: ${String(error)}`);
          }
        }
      }
    } catch (e) {
      if (this.epoch !== epoch) return;
      this.selection = previous;
      this.h.onError(`설정을 적용하지 못했습니다: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      if (this.epoch === epoch) { this.setDisabled(false); this.render(); }
    }
  }

  private setDisabled(disabled: boolean): void {
    for (const el of [this.modelSel, this.effortSel, this.modeSel]) el.disabled = disabled;
  }

  private modelOptions(): { value: string; label: string }[] {
    const list = this.models.length ? this.models.map(m => ({ value: m.value, label: m.displayName })) : [...FALLBACK_MODELS];
    const selected = this.selection.model;
    if (selected && !list.some(m => m.value === selected)) list.push({ value: selected, label: selected });
    return [{ value: '', label: '기본 모델 (설정값)' }, ...list.filter(m => m.value && m.value !== 'default')];
  }

  private openChoices(key: keyof typeof this.selection): void {
    const button = { model: this.modelSel, effort: this.effortSel, mode: this.modeSel }[key];
    if (button.disabled) return;
    const levels = effortOptions(this.models, this.selection.model || this.resolvedModel);
    if (this.selection.effort && !levels.includes(this.selection.effort as EffortLevel)) levels.push(this.selection.effort as EffortLevel);
    const options = key === 'model' ? this.modelOptions() : key === 'effort'
      ? [{ value: '', label: '기본 추론 강도' }, ...levels.map(value => ({ value, label: value }))]
      : modeOptions(this.selection.mode || null);
    const menu = new Menu();
    for (const option of options) menu.addItem(item => item.setTitle(option.label)
      .setChecked(option.value === this.selection[key])
      .onClick(() => void this.change(key, option.value, value => key === 'model' ? this.h.onModel(value || undefined)
        : key === 'effort' ? this.h.onEffort((value || undefined) as EffortLevel | undefined)
        : value ? this.h.onMode(value as PermissionMode) : undefined)));
    const rect = button.getBoundingClientRect();
    menu.showAtPosition({ x: rect.left, y: rect.top });
  }

  private render(): void {
    const selected = this.selection.model;
    const display = this.models.find(m => m.resolvedModel === this.resolvedModel || m.value === this.resolvedModel)?.displayName ?? this.resolvedModel;
    const label = selected ? this.modelOptions().find(m => m.value === selected)?.label ?? selected : display ?? '기본 모델';
    this.modelSel.setText(label.replace(/^Claude\s+/i, ''));
    this.modelSel.title = `모델 선택 · ${label} · ${this.resolvedModel ? `현재 응답 모델: ${this.resolvedModel}` : '응답이 시작되면 실제 모델을 확인합니다.'}`;
    this.modelSel.setAttribute('aria-label', this.modelSel.title);
    const levels = effortOptions(this.models, selected || this.resolvedModel);
    this.effortSel.setText(this.selection.effort || this.resolvedEffort || '기본');
    this.effortSel.hidden = levels.length === 0;
    this.effortSel.title = `추론 강도: ${this.selection.effort || this.resolvedEffort || '기본값'}`;
    this.effortSel.setAttribute('aria-label', this.effortSel.title);
    setIcon(this.modeSel, this.selection.mode === 'plan' ? 'list-todo' : this.selection.mode === 'acceptEdits' ? 'file-check' : this.selection.mode === 'auto' ? 'zap' : 'shield');
    this.modeSel.title = `권한 모드: ${MODE_LABEL[this.selection.mode] ?? '설정값'} (Shift+Tab)`;
    this.modeSel.setAttribute('aria-label', this.modeSel.title);
    this.modeSel.toggleClass('is-active', !!this.selection.mode && this.selection.mode !== 'default');
  }
}
