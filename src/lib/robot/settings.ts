/**
 * Robot Companion — persisted settings (localStorage, not app data).
 *
 * The robot's on/off state is a device-level preference, deliberately kept
 * OUT of the Dexie backup: it controls the shell of THIS device, not the
 * user's data. A tiny pub/sub keeps every mounted robot component in sync
 * without React context plumbing.
 */

import { DEFAULT_ROBOT_SETTINGS, type RobotSettings } from "./types";

export type { RobotSettings };

const KEY = "robot.settings.v1";
const listeners = new Set<() => void>();
let cached: RobotSettings | null = null;

function read(): RobotSettings {
  if (cached) return cached;
  try {
    const raw = localStorage.getItem(KEY);
    cached = raw
      ? { ...DEFAULT_ROBOT_SETTINGS, ...(JSON.parse(raw) as Partial<RobotSettings>) }
      : { ...DEFAULT_ROBOT_SETTINGS };
  } catch {
    cached = { ...DEFAULT_ROBOT_SETTINGS };
  }
  return cached;
}

export function getRobotSettings(): RobotSettings {
  return read();
}

export function updateRobotSettings(patch: Partial<RobotSettings>): RobotSettings {
  const next = { ...read(), ...patch };
  cached = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* private mode / quota — settings stay for this session only */
  }
  listeners.forEach((l) => l());
  return next;
}

export function subscribeRobotSettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
