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
  return info?.supportedEffortLevels?.length ? info.supportedEffortLevels : EFFORT_LEVELS;
}

export function modeOptions(current: string | null): { value: string; label: string }[] {
  const values: string[] = [...MODE_ORDER];
  if (current && !values.includes(current)) values.push(current);
  const list = values.map((value) => ({ value, label: MODE_LABEL[value] ?? value }));
  return current ? list : [{ value: '', label: '권한: 설정값' }, ...list];
}

export interface ToolbarHandlers {
  onModel(value: string | undefined): void;
  onEffort(value: EffortLevel | undefined): void;
  onMode(mode: PermissionMode): void;
}

export class Toolbar {
  private readonly modelSel: HTMLSelectElement;
  private readonly effortSel: HTMLSelectElement;
  private readonly modeSel: HTMLSelectElement;
  private readonly contextEl: HTMLElement;
  private models: ModelInfo[] = [];
  private resolvedModel: string | null = null;

  constructor(parent: HTMLElement, h: ToolbarHandlers) {
    const row = parent.createDiv({ cls: 'cp-toolbar' });
    this.modelSel = row.createEl('select', { cls: 'dropdown cp-select', attr: { 'aria-label': '모델' } });
    this.effortSel = row.createEl('select', { cls: 'dropdown cp-select', attr: { 'aria-label': '추론 강도' } });
    this.modeSel = row.createEl('select', { cls: 'dropdown cp-select', attr: { 'aria-label': '권한 모드 (Shift+Tab)' } });
    this.contextEl = row.createSpan({ cls: 'cp-context', attr: { 'aria-label': '컨텍스트 사용률' } });
    this.modelSel.addEventListener('change', () => {
      h.onModel(this.modelSel.value || undefined);
      this.renderEfforts(this.effortSel.value);
    });
    this.effortSel.addEventListener('change', () => h.onEffort((this.effortSel.value || undefined) as EffortLevel | undefined));
    this.modeSel.addEventListener('change', () => {
      if (this.modeSel.value) h.onMode(this.modeSel.value as PermissionMode);
    });
    this.reset();
  }

  /** 새 대화: 패널에서 바꾼 값 없이 설정값을 따르는 상태로 되돌린다. */
  reset(): void {
    this.models = [];
    this.resolvedModel = null;
    this.renderModels('');
    this.renderEfforts('');
    this.setMode(null);
    this.setContext(null);
  }

  setModels(models: ModelInfo[]): void {
    this.models = models;
    this.renderModels(this.modelSel.value);
    this.renderEfforts(this.effortSel.value);
  }

  /** init이 알려 준 실제 모델 id */
  setResolvedModel(model: string): void {
    this.resolvedModel = model;
    this.modelSel.title = `현재 모델: ${model}`;
    this.renderEfforts(this.effortSel.value);
  }

  setMode(mode: string | null): void {
    this.modeSel.empty();
    for (const o of modeOptions(mode)) this.modeSel.createEl('option', { value: o.value, text: o.label });
    this.modeSel.value = mode ?? '';
  }

  setContext(percentage: number | null): void {
    this.contextEl.setText(percentage === null ? '' : `◔ ${Math.round(percentage)}%`);
    this.contextEl.toggleClass('is-high', percentage !== null && percentage >= 80);
  }

  private renderModels(selected: string): void {
    const sel = this.modelSel;
    sel.empty();
    sel.createEl('option', { value: '', text: '기본 모델' });
    const list = this.models.length > 0 ? this.models.map((m) => ({ value: m.value, label: m.displayName })) : FALLBACK_MODELS;
    for (const m of list) {
      if (m.value && m.value !== 'default') sel.createEl('option', { value: m.value, text: m.label });
    }
    if (selected && !list.some((m) => m.value === selected)) sel.createEl('option', { value: selected, text: selected });
    sel.value = selected;
  }

  private renderEfforts(selected: string): void {
    const levels = effortOptions(this.models, this.modelSel.value || this.resolvedModel);
    const sel = this.effortSel;
    sel.empty();
    sel.createEl('option', { value: '', text: '추론 기본' });
    for (const level of levels) sel.createEl('option', { value: level, text: `추론 ${level}` });
    sel.value = levels.includes(selected as EffortLevel) ? selected : '';
    sel.toggle(levels.length > 0);
  }
}
