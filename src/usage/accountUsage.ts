export interface LimitRow {
  label: string;
  percent: number | null;
  resetsAt: number | null;
  severity: string;
  active: boolean;
}
export interface AccountUsage {
  available: boolean;
  rows: LimitRow[];
  extraUsage: boolean | null;
}
export interface LimitAlert {
  status: 'allowed' | 'allowed_warning' | 'rejected';
  label: string;
  resetsAt: number | null;
}
type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => v !== null && typeof v === 'object' ? v as Obj : {};
const percent = (v: unknown): number | null => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100 ? v : null;
const date = (v: unknown): number | null => typeof v === 'string' && Number.isFinite(Date.parse(v)) ? Date.parse(v) : null;
const labels: Record<string, string> = {
  session: '5시간', five_hour: '5시간', weekly_all: '주간', seven_day: '주간',
  weekly_scoped: '모델별 주간', seven_day_opus: 'Opus 주간', seven_day_sonnet: 'Sonnet 주간',
  seven_day_oauth_apps: '앱 주간', seven_day_overage_included: '추가 사용 포함 주간', overage: '추가 사용',
};

/** Only the compatibility boundary reads experimental SDK response fields. */
export function parseAccountUsage(raw: unknown): AccountUsage {
  const r = obj(raw);
  if (r.rate_limits_available === false) return { available: false, rows: [], extraUsage: null };
  if (r.rate_limits_available !== true || !r.rate_limits || typeof r.rate_limits !== 'object') {
    throw new Error('계정 한도 응답을 확인할 수 없습니다.');
  }
  const limits = obj(r.rate_limits);
  const rows: LimitRow[] = [];
  if (Array.isArray(limits.limits)) {
    for (const rawRow of limits.limits) {
      const row = obj(rawRow);
      if (typeof row.kind !== 'string') continue;
      const scope = obj(row.scope);
      const name = obj(scope.model).display_name ?? obj(scope.surface).display_name;
      rows.push({
        label: `${labels[row.kind] ?? row.kind}${typeof name === 'string' ? ` · ${name}` : ''}`,
        percent: percent(row.percent), resetsAt: date(row.resets_at),
        severity: typeof row.severity === 'string' ? row.severity : 'normal', active: row.is_active === true,
      });
    }
  } else {
    // Older CLIs return named windows instead of the server's ordered limits[].
    for (const key of ['five_hour', 'seven_day', 'seven_day_opus', 'seven_day_sonnet', 'seven_day_oauth_apps']) {
      if (!limits[key]) continue;
      const row = obj(limits[key]);
      rows.push({ label: labels[key], percent: percent(row.utilization), resetsAt: date(row.resets_at), severity: 'normal', active: key === 'five_hour' });
    }
  }
  const enabled = obj(limits.extra_usage).is_enabled;
  return { available: true, rows, extraUsage: typeof enabled === 'boolean' ? enabled : null };
}

export function parseLimitAlert(raw: unknown): LimitAlert | null {
  const r = obj(raw);
  if (!['allowed', 'allowed_warning', 'rejected'].includes(String(r.status))) return null;
  return {
    status: r.status as LimitAlert['status'],
    label: typeof r.rateLimitType === 'string' ? labels[r.rateLimitType] ?? r.rateLimitType : '계정',
    resetsAt: typeof r.resetsAt === 'number' && Number.isFinite(r.resetsAt) && r.resetsAt > 0 ? r.resetsAt * 1000 : null,
  };
}

export function resetText(ms: number | null, now = Date.now()): string {
  if (ms === null) return '초기화 시각 미제공';
  const formatted = new Date(ms).toLocaleString(undefined, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  return ms <= now ? `${formatted} 초기화 예정 시각 경과 · 재확인 필요` : `${formatted} 초기화`;
}
