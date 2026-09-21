export interface CommandItem {
  name: string;
  description: string;
  argumentHint: string;
}

export function toCommandItems(commands: { name: string; description: string; argumentHint: string }[]): CommandItem[] {
  const seen = new Set<string>();
  const items: CommandItem[] = [];
  for (const c of commands) {
    const name = c.name.replace(/^\//, '');
    if (!name || seen.has(name)) continue;
    seen.add(name);
    items.push({ name, description: c.description, argumentHint: c.argumentHint });
  }
  return items;
}

/** 입력 맨 앞의 `/토큰` 안에 커서가 있으면 토큰(슬래시 제외)을, 아니면 null. */
export function slashToken(value: string, cursor: number): string | null {
  const m = /^\/(\S*)$/.exec(value.slice(0, cursor));
  return m ? m[1] : null;
}

export function matchCommands(query: string, commands: CommandItem[], limit = 20): CommandItem[] {
  const q = query.toLowerCase();
  const prefix: CommandItem[] = [];
  const contains: CommandItem[] = [];
  for (const c of commands) {
    const name = c.name.toLowerCase();
    if (name.startsWith(q)) prefix.push(c);
    else if (name.includes(q)) contains.push(c);
  }
  const byName = (a: CommandItem, b: CommandItem) => a.name.localeCompare(b.name);
  return [...prefix.sort(byName), ...contains.sort(byName)].slice(0, limit);
}

export function applyCommand(value: string, cursor: number, name: string): { value: string; cursor: number } {
  const rest = value.slice(cursor).replace(/^\S*/, '').replace(/^\s+/, '');
  const head = `/${name} `;
  return { value: head + rest, cursor: head.length };
}
