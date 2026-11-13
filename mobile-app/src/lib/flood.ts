import raw from '../data/floodScenarios.json';

export type Forecast = { by_lead: Record<string, (number | null)[]> };

export type Scenario = {
  id: string;
  title: string;
  event: string;
  event_id: string;
  gauge_id: string;
  gauge_name: string;
  hours: string[];
  stage_ft: (number | null)[];
  rain_mm: number[];
  baseline_ft: number;
  peak_ft: number;
  gauge_lost_at?: string | null;
  images: { image_id: string; url: string; date: string; locality: string; source: string }[];
  forecast?: Forecast | null;
};

export type ModelInfo = {
  trained: boolean;
  name: string | null;
  note?: string;
  quick?: boolean;
  future_rain_assumed?: boolean;
  events_rmse_ft?: Record<string, number>;
  events_rmse_persistence_ft?: Record<string, number>;
};

type Payload = { model: ModelInfo; scenarios: Scenario[] };
const data = raw as unknown as Payload;
export const scenarios: Scenario[] = data.scenarios;
export const model: ModelInfo = data.model;

export const FT_PER_M = 3.28084;

/** Depth markers people can feel. Moving-water figures follow NWS "Turn Around Don't Drown". */
export const THRESHOLDS = [
  { ft: 0.5, short: '6 in', label: 'Moving water can knock an adult down' },
  { ft: 1, short: '1 ft', label: 'Most cars can be swept away' },
  { ft: 1.7, short: 'Knee', label: 'Knee deep on an adult' },
  { ft: 2, short: '2 ft', label: 'SUVs and pickups float' },
  { ft: 3.3, short: 'Waist', label: 'Waist deep. Walking is no longer possible in a current' },
  { ft: 5.7, short: 'Head', label: 'Over an adult’s head' },
];

/** Fill nulls by holding the last reading (a gauge that was destroyed keeps its last value). */
export function series(sc: Scenario, source: 'observed' | 'forecast', lead: number): (number | null)[] {
  if (source === 'forecast') {
    const f = sc.forecast?.by_lead?.[String(lead)];
    if (f) return f.slice(0, sc.hours.length);
  }
  return sc.stage_ft;
}

export function stageAt(values: (number | null)[], tRaw: number): number | null {
  if (!values.length || !Number.isFinite(tRaw)) return null;
  const t = Math.max(0, Math.min(values.length - 1, tRaw)); // hold the ends, never extrapolate
  const i = Math.floor(t);
  const j = Math.min(values.length - 1, i + 1);
  let a = values[i];
  let b = values[j];
  if (a == null) {
    for (let k = i; k >= 0 && a == null; k--) a = values[k];
  }
  if (a == null) return null;
  if (b == null) b = a;
  return a + (b - a) * (t - i);
}

export function depthFt(stage: number | null, sc: Scenario, groundFt: number): number {
  if (stage == null) return 0;
  return Math.max(0, stage - (sc.baseline_ft + groundFt));
}

/** First fractional hour at which depth reaches `ft`, or null. */
export function crossing(values: (number | null)[], sc: Scenario, groundFt: number, ft: number): number | null {
  const level = sc.baseline_ft + groundFt + ft;
  for (let i = 0; i < values.length - 1; i++) {
    const a = values[i];
    const b = values[i + 1];
    if (a == null || b == null) continue;
    if (a >= level) return i;
    if (b >= level) return i + (level - a) / (b - a);
  }
  return null;
}

export function formatDepth(ft: number): string {
  if (ft <= 0.01) return 'Dry';
  const totalIn = Math.round(ft * 12);
  const f = Math.floor(totalIn / 12);
  const i = totalIn % 12;
  if (f === 0) return `${i} in`;
  return i ? `${f} ft ${i} in` : `${f} ft`;
}

export function formatDuration(hours: number): string {
  const mins = Math.round(hours * 60);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** All replayed events happened during US Central Daylight Time (UTC-5). */
export function localClock(sc: Scenario, t: number): { time: string; day: string } {
  const start = Date.parse(sc.hours[0]);
  const d = new Date(start + t * 3600_000 - 5 * 3600_000);
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  const time = `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
  return { time, day: `${DAYS[d.getUTCDay()]} ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}` };
}

export function hourOf(sc: Scenario, iso?: string | null): number | null {
  if (!iso) return null;
  return (Date.parse(iso) - Date.parse(sc.hours[0])) / 3600_000;
}
