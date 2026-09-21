import { PluginSettingTab, Setting, type App } from 'obsidian';
import type ClaudePanelPlugin from './main';

export interface ClaudePanelSettings {
  claudePath: string;
  defaultModel: string;
  attachActiveNote: boolean;
  sendKey: 'enter' | 'mod-enter';
  useHooks: boolean;
}

export const DEFAULT_SETTINGS: ClaudePanelSettings = {
  claudePath: 'claude',
  defaultModel: '',
  attachActiveNote: true,
  sendKey: 'enter',
  useHooks: true,
};

export class ClaudePanelSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: ClaudePanelPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    const s = this.plugin.settings;
    containerEl.empty();

    new Setting(containerEl)
      .setName('Claude 실행 파일 경로')
      .setDesc('이름만 쓰면 PATH(~/.local/bin 등 보강)에서 찾습니다. 찾지 못하면 절대 경로를 지정하세요.')
      .addText((t) =>
        t.setPlaceholder('claude').setValue(s.claudePath).onChange(async (v) => {
          s.claudePath = v.trim() || 'claude';
          await this.plugin.saveSettings();
        }),
      )
      .addButton((b) =>
        b.setButtonText('자동 찾기').onClick(async () => {
          await this.plugin.autoFindClaude();
          this.display();
        }),
      );

    new Setting(containerEl)
      .setName('기본 모델')
      .setDesc('비우면 Claude Code 설정을 따릅니다. 예: opus, sonnet, haiku')
      .addText((t) =>
        t.setValue(s.defaultModel).onChange(async (v) => {
          s.defaultModel = v.trim();
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName('현재 노트 자동 첨부')
      .setDesc('전송할 때 활성 노트 경로를 컨텍스트로 붙입니다.')
      .addToggle((t) =>
        t.setValue(s.attachActiveNote).onChange(async (v) => {
          s.attachActiveNote = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName('전송 단축키')
      .setDesc('Shift+Enter는 항상 줄바꿈, Ctrl/Cmd+Enter는 항상 전송입니다.')
      .addDropdown((d) =>
        d
          .addOption('enter', 'Enter')
          .addOption('mod-enter', 'Ctrl/Cmd+Enter')
          .setValue(s.sendKey)
          .onChange(async (v) => {
            s.sendKey = v === 'mod-enter' ? 'mod-enter' : 'enter';
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('사용자 hook 사용')
      .setDesc('끄면 패널 세션에서 settings.json의 hook을 실행하지 않습니다. 새 대화부터 적용됩니다.')
      .addToggle((t) =>
        t.setValue(s.useHooks).onChange(async (v) => {
          s.useHooks = v;
          await this.plugin.saveSettings();
        }),
      );
  }
}
