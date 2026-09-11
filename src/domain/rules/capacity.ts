import { daysUntil } from '../dates';
import type { Job, User } from '../types';

export type CapacityWindow = 7 | 30 | 60;
export type LoadBand = 'overloaded' | 'balanced' | 'under';

export interface CapacityRow {
  user: User;
  jobs: Job[];
  jobCount: number;
  estimatedHours: number;
  availableHours: number;
  utilisation: number; // 0..n
  band: LoadBand;
}

export interface CapacitySummary {
  window: CapacityWindow;
  rows: CapacityRow[];
  unassigned: Job[];
}

/**
 * Simple load view: open jobs due inside the window, hours vs. weekly capacity
 * scaled to the window. Deterministic and explainable.
 */
export function computeCapacity(users: User[], jobs: Job[], window: CapacityWindow, today: string): CapacitySummary {
  const inWindow = jobs.filter((j) => j.status !== 'filed' && daysUntil(j.dueDate, today) <= window);
  const rows = users
    .filter((u) => u.role !== 'admin')
    .map((user) => {
      const own = inWindow.filter((j) => j.assigneeUserId === user.id);
      const estimatedHours = round1(own.reduce((s, j) => s + j.estimatedHours, 0));
      const availableHours = round1((user.weeklyCapacityHours / 7) * window);
      const utilisation = availableHours === 0 ? 0 : estimatedHours / availableHours;
      return { user, jobs: own, jobCount: own.length, estimatedHours, availableHours, utilisation, band: bandFor(utilisation) };
    });
  return { window, rows, unassigned: inWindow.filter((j) => !j.assigneeUserId) };
}

export function bandFor(utilisation: number): LoadBand {
  if (utilisation > 0.9) return 'overloaded';
  if (utilisation < 0.45) return 'under';
  return 'balanced';
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
