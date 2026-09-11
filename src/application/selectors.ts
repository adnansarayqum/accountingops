import { useMemo } from 'react';
import { useAppStore } from './store';
import { daysUntil } from '../domain/dates';
import {
  assessChasing,
  computeCapacity,
  computeCompleteness,
  computeDashboardMetrics,
  evaluateAttention,
  nextActionForJob,
  responsivenessProfile,
  sequenceIdFor,
  type AttentionItem,
  type CapacitySummary,
  type CapacityWindow,
  type ChasingAssessment,
  type Completeness,
  type DashboardMetrics,
  type NextAction,
  type ResponsivenessProfile,
} from '../domain/rules';
import type { Client, Contact, Job, PracticeData, User } from '../domain/types';

export interface JobView {
  job: Job;
  client: Client;
  assignee?: User;
  reviewer?: User;
  completeness: Completeness;
  chasing: ChasingAssessment;
  nextAction: NextAction;
  daysUntilDue: number;
  attention?: AttentionItem;
}

export interface Derived {
  attention: AttentionItem[];
  attentionByJob: Map<string, AttentionItem>;
  metrics: DashboardMetrics;
  jobViews: JobView[];
  jobViewById: Map<string, JobView>;
  clientById: Map<string, Client>;
  userById: Map<string, User>;
  primaryContactByClient: Map<string, Contact>;
  responsivenessByClient: Map<string, ResponsivenessProfile>;
  capacity: Record<CapacityWindow, CapacitySummary>;
  pendingInbox: number;
  unreadNotifications: number;
}

export function computeDerived(data: PracticeData, today: string): Derived {
  const clientById = new Map(data.clients.map((c) => [c.id, c]));
  const userById = new Map(data.users.map((u) => [u.id, u]));
  const primaryContactByClient = new Map<string, Contact>();
  for (const c of data.contacts) if (c.isPrimary) primaryContactByClient.set(c.clientId, c);

  const attention = evaluateAttention({
    jobs: data.jobs,
    clients: data.clients,
    items: data.requestItems,
    comms: data.communications,
    approvals: data.approvals,
    personRoles: data.personRoles,
    sequences: data.reminderSequences,
    users: data.users,
    today,
  });
  const attentionByJob = new Map(attention.map((a) => [a.jobId, a]));

  const jobViews: JobView[] = data.jobs
    .map((job): JobView | null => {
      const client = clientById.get(job.clientId);
      if (!client) return null;
      const items = data.requestItems.filter((i) => i.jobId === job.id);
      const completeness = computeCompleteness(items);
      const sequence = data.reminderSequences.find((s) => s.id === sequenceIdFor(job.serviceCode));
      const chasing = assessChasing(job, items, data.communications, sequence, today);
      const nextAction = nextActionForJob(job, client, items, data.communications, data.reminderSequences, today);
      return {
        job,
        client,
        assignee: job.assigneeUserId ? userById.get(job.assigneeUserId) : undefined,
        reviewer: job.reviewerUserId ? userById.get(job.reviewerUserId) : undefined,
        completeness,
        chasing,
        nextAction,
        daysUntilDue: daysUntil(job.dueDate, today),
        attention: attentionByJob.get(job.id),
      };
    })
    .filter((x): x is JobView => x !== null)
    .sort((a, b) => a.job.dueDate.localeCompare(b.job.dueDate));

  const noNextAction = jobViews.filter((v) => v.job.status !== 'filed' && v.nextAction.kind === 'none').length;
  const metrics = computeDashboardMetrics(data.jobs, data.communications, attention, today, noNextAction);

  const responsivenessByClient = new Map(data.clients.map((c) => [c.id, responsivenessProfile(c, data.communications)]));

  return {
    attention,
    attentionByJob,
    metrics,
    jobViews,
    jobViewById: new Map(jobViews.map((v) => [v.job.id, v])),
    clientById,
    userById,
    primaryContactByClient,
    responsivenessByClient,
    capacity: {
      7: computeCapacity(data.users, data.jobs, 7, today),
      30: computeCapacity(data.users, data.jobs, 30, today),
      60: computeCapacity(data.users, data.jobs, 60, today),
    },
    pendingInbox: data.inboxItems.filter((i) => i.status === 'pending').length,
    unreadNotifications: data.notifications.filter((n) => !n.read).length,
  };
}

/** Memoised derived view of the whole practice. Recomputes only when data changes. */
export function useDerived(): Derived {
  const data = useAppStore((s) => s.data);
  const today = useAppStore((s) => s.today);
  return useMemo(() => computeDerived(data, today), [data, today]);
}

export function useData(): PracticeData {
  return useAppStore((s) => s.data);
}

export function useToday(): string {
  return useAppStore((s) => s.today);
}
