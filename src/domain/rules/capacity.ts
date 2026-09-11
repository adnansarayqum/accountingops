import { daysUntil } from '../dates';
import type { Job, JobStatus, User } from '../types';

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

/** Share of a job's estimate still to be spent, by status. Transparent weighting. */
export const REMAINING_EFFORT: Record<JobStatus, number> = {
  waiting_for_records: 1,
  ready_to_start: 1,
  in_progress: 0.6,
  internal_review: 0.25,
  waiting_client_approval: 0.1,
  ready_to_file: 0.05,
  filed: 0,
};

/** Share of contracted hours realistically available for job work (the rest is admin, calls, meetings). */
export const CHARGEABLE_SHARE = 0.6;

/**
 * Simple load view: open jobs due inside the window plus work already in
 * progress, weighted by remaining effort, against chargeable hours scaled to
 * the window. Deterministic and explainable.
 */
export function computeCapacity(users: User[], jobs: Job[], window: CapacityWindow, today: string): CapacitySummary {
  const inWindow = jobs.filter((j) => j.status !== 'filed' && (daysUntil(j.dueDate, today) <= window || j.status === 'in_progress' || j.status === 'internal_review'));
  const rows = users
    .filter((u) => u.role !== 'admin')
    .map((user) => {
      const own = inWindow.filter((j) => j.assigneeUserId === user.id);
      const estimatedHours = round1(own.reduce((s, j) => s + j.estimatedHours * REMAINING_EFFORT[j.status], 0));
      const availableHours = round1((user.weeklyCapacityHours / 7) * window * CHARGEABLE_SHARE);
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
