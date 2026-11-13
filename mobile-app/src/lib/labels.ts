import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchWithTimeout } from './net';

export type FloodLabel = 'flooded' | 'dry' | 'unsure';
export type LabelRecord = { after_id: string; before_id: string; label: FloodLabel; labeler: string; at: string };

const KEY = 'flood.labels.v1';
const NAME_KEY = 'flood.labeler.v1';

export async function loadLabels(): Promise<Record<string, LabelRecord>> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Record<string, LabelRecord>) : {};
  } catch {
    return {};
  }
}

export async function saveLabels(labels: Record<string, LabelRecord>): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(labels));
  } catch {
    // storage full or unavailable; labels stay in memory for this session
  }
}

export async function loadLabeler(): Promise<string> {
  try {
    return (await AsyncStorage.getItem(NAME_KEY)) ?? '';
  } catch {
    return '';
  }
}

export async function saveLabeler(name: string): Promise<void> {
  try {
    await AsyncStorage.setItem(NAME_KEY, name);
  } catch {}
}

/** Send one label to mobile_server.py (appends to reviews/flood_labels.jsonl). */
export async function postLabel(apiBase: string, record: LabelRecord): Promise<boolean> {
  if (!apiBase) return false;
  try {
    const r = await fetchWithTimeout(`${apiBase}/api/label`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(record),
    });
    return r.ok;
  } catch {
    return false;
  }
}

/** Small deterministic hash so every phone gets the same photo order. */
export function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
