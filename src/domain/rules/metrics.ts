import { daysSince, daysUntil } from '../dates';
import type { Communication, Job } from '../types';
import type { AttentionItem } from './attention';

export interface DashboardMetrics {
  dueIn30: number;
  overdue: number;
  waitingOnClient: number;
  readyToFile: number;
  onTimePercent: number | null;
  completedOnTime: number;
  completedLate: number;
  clientBlocked: number;
  averageClientWaitDays: number | null;
  remindersThisMonth: number;
  readyBeforeDeadline: number;
  jobsWithNoNextAction: number;
  highRisk: number;
  openJobs: number;
}

export function computeDashboardMetrics(jobs: Job[], comms: Communication[], attention: AttentionItem[], today: string, noNextActionCount: number, timeZone?: string): DashboardMetrics {
  const open = jobs.filter((j) => j.status !== 'filed');
  const filed = jobs.filter((j) => j.status === 'filed');
  const dueIn30 = open.filter((j) => {
    const d = daysUntil(j.dueDate, today);
    return d >= 0 && d <= 30;
  }).length;
  const overdue = open.filter((j) => daysUntil(j.dueDate, today) < 0).length;
  const waitingOnClient = open.filter((j) => j.waitingOn === 'client').length;
  const readyToFile = open.filter((j) => j.status === 'ready_to_file').length;
  const completedOnTime = filed.filter((j) => j.filedAt && daysSince(j.filedAt, j.dueDate, timeZone) >= 0).length;
  const completedLate = filed.length - completedOnTime;
  const onTimePercent = filed.length === 0 ? null : Math.round((completedOnTime / filed.length) * 100);
  const clientBlockedJobs = open.filter((j) => j.waitingOn === 'client');
  const waits = clientBlockedJobs.map((j) => daysSince(j.statusChangedAt, today, timeZone));
  const averageClientWaitDays = waits.length === 0 ? null : Math.round(waits.reduce((a, b) => a + b, 0) / waits.length);
  const remindersThisMonth = comms.filter((c) => c.direction === 'outbound' && c.reminderStage && daysSince(c.sentAt, today, timeZone) >= 0 && daysSince(c.sentAt, `${today.slice(0, 7)}-01`, timeZone) <= 0).length;
  const readyBeforeDeadline = open.filter((j) => j.status === 'ready_to_file' && daysUntil(j.dueDate, today) >= 0).length;
  return {
    dueIn30,
    overdue,
    waitingOnClient,
    readyToFile,
    onTimePercent,
    completedOnTime,
    completedLate,
    clientBlocked: clientBlockedJobs.length,
    averageClientWaitDays,
    remindersThisMonth,
    readyBeforeDeadline,
    jobsWithNoNextAction: noNextActionCount,
    highRisk: attention.filter((a) => a.severity === 'red').length,
    openJobs: open.length,
  };
}
