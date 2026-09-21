import { diffLines } from 'diff';

export type DiffLine = { type: 'add' | 'del' | 'same'; text: string };
export type ToolDetail = { kind: 'diff'; lines: DiffLine[] } | { kind: 'text'; label: string; text: string };

const MAX_DETAIL = 4000;

export function relativePath(path: string, vaultPath: string): string {
  const prefix = vaultPath.endsWith('/') ? vaultPath : `${vaultPath}/`;
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

export function oneLine(text: string, max: number): string {
  const s = text.replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}… (${text.length - max}자 생략)` : text;
}

function str(input: Record<string, unknown>, key: string): string {
  const v = input[key];
  return typeof v === 'string' ? v : '';
}

/** 도구 카드 한 줄 요약 */
export function toolSummary(name: string, input: Record<string, unknown>, vaultPath: string): string {
  let s: string;
  switch (name) {
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
      s = relativePath(str(input, 'file_path'), vaultPath);
      break;
    case 'NotebookEdit':
      s = relativePath(str(input, 'notebook_path'), vaultPath);
      break;
    case 'Bash':
      s = str(input, 'description') || str(input, 'command');
      break;
    case 'Glob':
    case 'Grep':
      s = str(input, 'pattern');
      break;
    case 'WebFetch':
      s = str(input, 'url');
      break;
    case 'WebSearch':
      s = str(input, 'query');
      break;
    case 'Skill':
      s = str(input, 'skill');
      break;
    case 'Agent':
    case 'Task':
      s = str(input, 'description');
      break;
    default:
      s = '';
  }
  return oneLine(s, 80);
}

function diffDetail(before: string, after: string): ToolDetail {
  const lines: DiffLine[] = [];
  for (const part of diffLines(before, after)) {
    const type = part.added ? 'add' : part.removed ? 'del' : 'same';
    for (const line of part.value.replace(/\n$/, '').split('\n')) lines.push({ type, text: line });
  }
  return { kind: 'diff', lines };
}

/** 도구 카드를 펼쳤을 때 보일 내용 */
export function toolDetails(name: string, input: Record<string, unknown>, output: string | null): ToolDetail[] {
  const details: ToolDetail[] = [];
  if (name === 'Edit') {
    details.push(diffDetail(str(input, 'old_string'), str(input, 'new_string')));
  } else if (name === 'MultiEdit' && Array.isArray(input.edits)) {
    for (const edit of input.edits as Record<string, unknown>[]) details.push(diffDetail(str(edit, 'old_string'), str(edit, 'new_string')));
  } else if (name === 'Write') {
    details.push({ kind: 'text', label: '내용', text: truncate(str(input, 'content'), MAX_DETAIL) });
  } else if (name === 'Bash') {
    details.push({ kind: 'text', label: '명령', text: str(input, 'command') });
  } else {
    details.push({ kind: 'text', label: '입력', text: truncate(JSON.stringify(input, null, 2), MAX_DETAIL) });
  }
  if (output) details.push({ kind: 'text', label: '출력', text: truncate(output, MAX_DETAIL) });
  return details;
}
