import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceLeaf } from 'obsidian';
import type ClaudePanelPlugin from '../../src/main';

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: vi.fn() }));
vi.mock('obsidian', async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return {
    ...original,
    ItemView: class {
      // Obsidian creates these elements before the subclass fields initialize.
      headerEl = { role: 'view-header' };
      titleEl = { role: 'view-header-title' };
    },
  };
});

import { ChatView } from '../../src/ui/ChatView';

describe('ChatView construction', () => {
  it('preserves the Obsidian header and title required to open the view', () => {
    const view = new ChatView({} as WorkspaceLeaf, {} as ClaudePanelPlugin);
    const base = view as unknown as { headerEl: unknown; titleEl: unknown };
    expect(base.headerEl).toEqual({ role: 'view-header' });
    expect(base.titleEl).toEqual({ role: 'view-header-title' });
  });
});
