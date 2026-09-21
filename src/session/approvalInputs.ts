export interface AskOption {
  label: string;
  description: string;
}

export interface AskQuestion {
  question: string;
  header: string;
  options: AskOption[];
  multiSelect: boolean;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** AskUserQuestion 입력을 방어적으로 읽는다. */
export function parseQuestions(input: Record<string, unknown>): AskQuestion[] {
  if (!Array.isArray(input.questions)) return [];
  return input.questions.filter(isRecord).flatMap((q) => {
    const question = typeof q.question === 'string' ? q.question : '';
    if (!question) return [];
    const options = Array.isArray(q.options)
      ? q.options.filter(isRecord).map((o) => ({ label: String(o.label ?? ''), description: String(o.description ?? '') }))
      : [];
    return [{ question, header: String(q.header ?? ''), options, multiSelect: q.multiSelect === true }];
  });
}

/** 질문 텍스트를 키로 한 답. 답이 없는 질문이 하나라도 있으면 null. */
export function buildAnswers(questions: AskQuestion[], picked: Map<number, Set<string>>, other: Map<number, string>): Record<string, string> | null {
  const answers: Record<string, string> = {};
  for (const [i, q] of questions.entries()) {
    const chosen = q.options.map((o) => o.label).filter((label) => picked.get(i)?.has(label));
    const extra = other.get(i)?.trim();
    const values = extra ? [...chosen, extra] : chosen;
    if (values.length === 0) return null;
    answers[q.question] = values.join(', ');
  }
  return answers;
}

export function extractPlan(input: Record<string, unknown>): string {
  if (typeof input.plan === 'string' && input.plan.trim()) return input.plan;
  if (typeof input.planFilePath === 'string') return `계획 파일: ${input.planFilePath}`;
  return '(계획 본문 없음)';
}
