import { create } from 'zustand';
import { buildEmptyPracticeData, OWNER_USER_ID } from './emptyState';
import { buildImportedClientRecords, type ClientRosterRow } from './clientImport';
import type { AuthUser } from './auth';
import { nowIso, todayIso } from '../domain/dates';
import { CHANNEL_LABELS, JOB_STATUS_LABELS, SERVICES, FILING_DESTINATION } from '../domain/catalog';
import {
  canTransition,
  computeCompleteness,
  DEFAULT_WAITING_ON,
  generateNextJob,
  itemsForJob,
  suggestedTransitionOnCompleteness,
} from '../domain/rules';
import type {
  Activity,
  ActivityKind,
  ApprovalKind,
  AuditEvent,
  Channel,
  Client,
  ClientIdentifier,
  ClientType,
  Contact,
  Document,
  IdentityVerificationStatus,
  IsoDate,
  Job,
  JobStatus,
  Notification,
  OnboardingStage,
  PracticeData,
  RegisteredAddress,
  ServiceCode,
  WaitingOn,
} from '../domain/types';
import { newId } from './ids';
import { LocalStorageRepository } from './persistence/localStorageRepository';
import type { PracticeRepository } from './persistence/repository';

export interface Toast {
  id: string;
  title: string;
  description?: string;
  tone: 'success' | 'info' | 'error';
}

export interface AppState {
  data: PracticeData;
  today: string;
  ready: boolean;
  currentUserId: string;
  toasts: Toast[];
  /** 'server' once a real signed-in session exists; 'local' is the original browser-only mode (no DATABASE_URL configured). */
  authMode: 'local' | 'server';
  authUser: AuthUser | null;

  // lifecycle
  init(): Promise<void>;

  // feedback
  toast(t: Omit<Toast, 'id'>): void;
  dismissToast(id: string): void;

  // jobs
  transitionJob(jobId: string, to: JobStatus, opts?: { waitingOn?: WaitingOn; note?: string }): void;
  setWaitingOn(jobId: string, waitingOn: WaitingOn): void;
  reassignJob(jobId: string, userId: string | undefined): void;
  assignReviewer(jobId: string, userId: string | undefined): void;
  setChasingPaused(jobId: string, paused: boolean): void;
  recordApproval(jobId: string, kind: ApprovalKind, decision: 'approved' | 'rejected', reviewerName: string, note?: string): void;
  requestClientApproval(jobId: string): void;
  fileJob(jobId: string): { nextJob?: Job };

  // information requests & documents
  markItemReceived(itemId: string, opts?: { fileName?: string; source?: Document['source'] }): void;
  markItemMissing(itemId: string): void;
  addRequestItem(jobId: string, label: string): void;

  // reminders
  sendReminder(input: {
    jobId: string;
    channel: Channel;
    recipient: string;
    subject?: string;
    body: string;
    documentsRequested: string[];
    stage: string;
  }): void;

  // inbox
  confirmInboxItem(itemId: string): void;
  dismissInboxItem(itemId: string): void;
  updateInboxSuggestion(itemId: string, patch: { clientId?: string; jobId?: string; documentType?: string }): void;

  // clients & people
  updateClient(clientId: string, patch: Partial<Client>): void;
  createClient(input: {
    name: string;
    type: ClientType;
    ownerUserId: string;
    contactName: string;
    email?: string;
    phone?: string;
    preferredChannel: Channel;
    services: ServiceCode[];
    identifiers: Partial<Record<ClientIdentifier['kind'], string>>;
    yearEnd?: string;
    /** Populated when the client was found via the Companies House lookup. */
    registeredOffice?: RegisteredAddress;
    companiesHouseStatus?: string;
    sicCodes?: string[];
    incorporatedOn?: IsoDate;
  }): Client;
  /** Bulk-add clients from an existing roster (e.g. an imported spreadsheet). Skips rows whose company number is already on file. */
  importClients(rows: ClientRosterRow[]): { created: number; skipped: string[] };
  updateIdentifier(clientId: string, kind: ClientIdentifier['kind'], value: string): void;
  recordIdentifierReveal(clientId: string, kind: ClientIdentifier['kind']): void;
  updatePersonRoleVerification(roleId: string, status: IdentityVerificationStatus, personalCodeCaptured?: boolean): void;

  // onboarding
  toggleOnboardingItem(caseId: string, key: string): void;
  setOnboardingStage(caseId: string, stage: OnboardingStage): void;

  // notifications
  markNotificationRead(id: string): void;
  markAllNotificationsRead(): void;

  // notes
  addNote(clientId: string, message: string, jobId?: string): void;
}

let repository: PracticeRepository = new LocalStorageRepository();

export function configureRepository(repo: PracticeRepository): void {
  repository = repo;
}

/**
 * Persist immediately after every mutation. The localStorage adapter writes
 * synchronously, so a navigation straight after an action can never lose it.
 * Failures are surfaced, never swallowed silently.
 */
function persist(get: () => AppState): void {
  repository.save(get().data).catch((err: unknown) => {
    console.error('Persist failed', err);
    get().toast({ title: "We couldn't save that change", description: 'It is still on screen. Try the action again.', tone: 'error' });
  });
}

/** Retries a transient load failure (e.g. a momentary network or server hiccup) before giving up. */
async function loadWithRetry(attempts = 3): Promise<PracticeData | null> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await repository.load();
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) await new Promise((resolve) => setTimeout(resolve, 300 * (i + 1)));
    }
  }
  throw lastErr;
}

export const useAppStore = create<AppState>((set, get) => {
  /** Apply a data mutation, persist, and return the new data. */
  const mutate = (fn: (d: PracticeData, ctx: MutationContext) => PracticeData | void): void => {
    const state = get();
    const ctx = new MutationContext(state.currentUserId, state.data.practice.id);
    const draft = structuredClone(state.data);
    const result = fn(draft, ctx) ?? draft;
    result.activities = [...ctx.activities, ...result.activities];
    result.auditEvents = [...ctx.audits, ...result.auditEvents].slice(0, 2000);
    result.notifications = [...ctx.notifications, ...result.notifications];
    set({ data: result });
    persist(get);
  };

  return {
    data: buildEmptyPracticeData(),
    today: todayIso(),
    ready: false,
    currentUserId: OWNER_USER_ID,
    toasts: [],
    authMode: 'local',
    authUser: null,

    async init() {
      const today = todayIso();
      try {
        const loaded = await loadWithRetry();
        if (loaded) {
          set({ data: loaded, today, ready: true });
        } else {
          const data = buildEmptyPracticeData();
          await repository.save(data);
          set({ data, today, ready: true });
        }
      } catch (err) {
        // A transient failure here must never leave the app stuck on the
        // splash screen forever — fall back to an empty view and let the
        // user retry, the same way persist() surfaces a save failure.
        console.error('Failed to load practice data', err);
        set({ data: buildEmptyPracticeData(), today, ready: true });
        get().toast({ title: "Couldn't load practice data", description: 'Showing an empty view — reload the page to try again.', tone: 'error' });
      }
    },

    toast(t) {
      const id = newId('toast');
      set({ toasts: [...get().toasts, { ...t, id }] });
      setTimeout(() => get().dismissToast(id), 4200);
    },
    dismissToast(id) {
      set({ toasts: get().toasts.filter((t) => t.id !== id) });
    },

    transitionJob(jobId, to, opts) {
      mutate((d, ctx) => {
        const job = d.jobs.find((j) => j.id === jobId);
        if (!job) return;
        if (!canTransition(job.status, to)) {
          throw new Error(`Cannot move a job from "${JOB_STATUS_LABELS[job.status]}" to "${JOB_STATUS_LABELS[to]}".`);
        }
        const before = { status: job.status, waitingOn: job.waitingOn };
        job.status = to;
        job.waitingOn = opts?.waitingOn ?? DEFAULT_WAITING_ON[to];
        job.statusChangedAt = nowIso();
        if (to === 'waiting_client_approval') {
          const existing = d.approvals.find((a) => a.jobId === jobId && a.kind === 'client' && a.status === 'pending');
          if (!existing) d.approvals.push({ id: newId('ap'), practiceId: d.practice.id, jobId, kind: 'client', status: 'pending', requestedAt: nowIso() });
        }
        const client = d.clients.find((c) => c.id === job.clientId);
        ctx.activity('status_changed', `${client?.name} ${job.name} moved to ${JOB_STATUS_LABELS[to]}.${opts?.note ? ` ${opts.note}` : ''}`, job);
        ctx.audit('job.transition', 'job', jobId, before, { status: to, waitingOn: job.waitingOn });
        if (to === 'ready_to_file') ctx.notify('job', 'Job now ready to file', `${client?.name} ${job.name} is ready to file.`, job);
      });
    },

    setWaitingOn(jobId, waitingOn) {
      mutate((d, ctx) => {
        const job = d.jobs.find((j) => j.id === jobId);
        if (!job) return;
        const before = job.waitingOn;
        job.waitingOn = waitingOn;
        ctx.audit('job.waitingOn', 'job', jobId, { waitingOn: before }, { waitingOn });
      });
    },

    reassignJob(jobId, userId) {
      mutate((d, ctx) => {
        const job = d.jobs.find((j) => j.id === jobId);
        if (!job) return;
        const before = job.assigneeUserId;
        job.assigneeUserId = userId;
        const client = d.clients.find((c) => c.id === job.clientId);
        const actor = d.users.find((u) => u.id === ctx.actorUserId);
        const target = d.users.find((u) => u.id === userId);
        ctx.activity('job_reassigned', `${actor?.name} ${userId ? `reassigned ${client?.name} ${job.name} to ${target?.name}` : `unassigned ${client?.name} ${job.name}`}.`, job);
        ctx.audit('job.reassign', 'job', jobId, { assigneeUserId: before }, { assigneeUserId: userId });
        if (userId && userId !== ctx.actorUserId) ctx.notify('job', 'Job reassigned', `${client?.name} ${job.name} was assigned to ${target?.name}.`, job, userId);
      });
    },

    assignReviewer(jobId, userId) {
      mutate((d, ctx) => {
        const job = d.jobs.find((j) => j.id === jobId);
        if (!job) return;
        const before = job.reviewerUserId;
        job.reviewerUserId = userId;
        const client = d.clients.find((c) => c.id === job.clientId);
        const target = d.users.find((u) => u.id === userId);
        if (userId) ctx.activity('job_reassigned', `${target?.name} assigned as reviewer on ${client?.name} ${job.name}.`, job);
        ctx.audit('job.reviewer', 'job', jobId, { reviewerUserId: before }, { reviewerUserId: userId });
      });
    },

    setChasingPaused(jobId, paused) {
      mutate((d, ctx) => {
        const job = d.jobs.find((j) => j.id === jobId);
        if (!job) return;
        job.chasingPaused = paused;
        ctx.audit('job.chasingPaused', 'job', jobId, { chasingPaused: !paused }, { chasingPaused: paused });
      });
    },

    recordApproval(jobId, kind, decision, reviewerName, note) {
      mutate((d, ctx) => {
        const job = d.jobs.find((j) => j.id === jobId);
        if (!job) return;
        let approval = d.approvals.find((a) => a.jobId === jobId && a.kind === kind && a.status === 'pending');
        if (!approval) {
          approval = { id: newId('ap'), practiceId: d.practice.id, jobId, kind, status: 'pending', requestedAt: nowIso() };
          d.approvals.push(approval);
        }
        approval.status = decision;
        approval.decidedAt = nowIso();
        approval.reviewerName = reviewerName;
        approval.note = note;
        const client = d.clients.find((c) => c.id === job.clientId);
        ctx.activity('approval_recorded', `${kind === 'client' ? 'Client' : 'Internal'} approval ${decision} for ${client?.name} ${job.name} (${reviewerName}).`, job);
        ctx.audit('approval.decide', 'approval', approval.id, { status: 'pending' }, { status: decision, reviewerName });
        if (decision === 'approved') {
          if (kind === 'internal' && job.status === 'internal_review') {
            job.status = 'waiting_client_approval';
            job.waitingOn = 'client';
            job.statusChangedAt = nowIso();
            if (!d.approvals.some((a) => a.jobId === jobId && a.kind === 'client' && a.status === 'pending')) {
              d.approvals.push({ id: newId('ap'), practiceId: d.practice.id, jobId, kind: 'client', status: 'pending', requestedAt: nowIso() });
            }
            ctx.activity('status_changed', `${client?.name} ${job.name} sent to client for approval.`, job);
          } else if (kind === 'client' && job.status === 'waiting_client_approval') {
            job.status = 'ready_to_file';
            job.waitingOn = 'nothing';
            job.statusChangedAt = nowIso();
            ctx.activity('status_changed', `${client?.name} ${job.name} is now ready to file.`, job);
            ctx.notify('approval', 'Approval received', `${client?.name} approved ${job.name}. Ready to file.`, job);
            const comm = d.communications.find((c) => c.jobId === jobId && c.direction === 'outbound' && c.responseStatus === 'awaiting');
            if (comm) comm.responseStatus = 'responded';
          }
        } else if (kind === 'client' && job.status === 'waiting_client_approval') {
          job.status = 'in_progress';
          job.waitingOn = 'accountant';
          job.statusChangedAt = nowIso();
        } else if (kind === 'internal' && job.status === 'internal_review') {
          job.status = 'in_progress';
          job.waitingOn = 'accountant';
          job.statusChangedAt = nowIso();
        }
      });
    },

    requestClientApproval(jobId) {
      get().transitionJob(jobId, 'waiting_client_approval');
    },

    fileJob(jobId) {
      let nextJob: Job | undefined;
      mutate((d, ctx) => {
        const job = d.jobs.find((j) => j.id === jobId);
        if (!job) return;
        if (!canTransition(job.status, 'filed')) throw new Error('Only jobs that are ready to file can be marked as filed.');
        const client = d.clients.find((c) => c.id === job.clientId);
        job.status = 'filed';
        job.waitingOn = 'nothing';
        job.statusChangedAt = nowIso();
        job.filedAt = nowIso();
        const ref = `SIM-${Math.floor(100000 + Math.random() * 899999)}`;
        d.filings.push({
          id: newId('fil'),
          practiceId: d.practice.id,
          jobId,
          filedAt: job.filedAt,
          filedByUserId: ctx.actorUserId,
          submissionReference: ref,
          destination: FILING_DESTINATION[job.serviceCode] ?? 'HMRC',
          evidenceStatus: 'simulated',
          simulated: true,
        });
        ctx.activity('job_filed', `${client?.name} ${job.name} marked as filed (simulated submission ${ref}).`, job);
        ctx.audit('job.file', 'job', jobId, { status: 'ready_to_file' }, { status: 'filed', submissionReference: ref });

        // Recurrence: generate the next job exactly once.
        if (job.obligationId) {
          const ob = d.obligations.find((o) => o.id === job.obligationId);
          if (ob) {
            const generated = generateNextJob(ob, d.jobs, () => newId('job'));
            if (generated) {
              d.jobs.push(generated.job);
              Object.assign(ob, generated.obligation);
              const service = SERVICES[ob.serviceCode];
              for (const label of service.defaultRequirements) {
                d.requestItems.push({ id: newId('req'), practiceId: d.practice.id, jobId: generated.job.id, clientId: job.clientId, label, documentType: label, status: 'missing', required: true });
              }
              nextJob = generated.job;
              ctx.activity('job_generated', `Next job created: ${client?.name} ${generated.job.name}.`, generated.job);
              ctx.audit('job.generate', 'job', generated.job.id, undefined, { obligationId: ob.id, periodKey: generated.job.periodKey });
            }
          }
        }
      });
      return { nextJob };
    },

    markItemReceived(itemId, opts) {
      mutate((d, ctx) => {
        const item = d.requestItems.find((i) => i.id === itemId);
        if (!item || item.status === 'received') return;
        const job = d.jobs.find((j) => j.id === item.jobId);
        const client = d.clients.find((c) => c.id === item.clientId);
        const doc: Document = {
          id: newId('doc'),
          practiceId: d.practice.id,
          clientId: item.clientId,
          jobId: item.jobId,
          fileName: opts?.fileName ?? `${(client?.name ?? 'client').replace(/[^a-z0-9]+/gi, '-')}-${item.label.replace(/[^a-z0-9]+/gi, '-')}.pdf`,
          documentType: item.documentType,
          receivedAt: nowIso(),
          source: opts?.source ?? 'upload',
          sizeKb: 240,
        };
        d.documents.push(doc);
        item.status = 'received';
        item.receivedAt = nowIso();
        item.documentId = doc.id;
        ctx.activity('document_received', `${item.label} received from ${client?.name}${job ? ` for ${job.name}` : ''}.`, job);
        ctx.audit('request_item.receive', 'information_request_item', itemId, { status: 'requested' }, { status: 'received', documentId: doc.id });
        if (job) applyCompletenessEffects(d, ctx, job);
      });
    },

    markItemMissing(itemId) {
      mutate((d, ctx) => {
        const item = d.requestItems.find((i) => i.id === itemId);
        if (!item) return;
        const before = item.status;
        item.status = 'missing';
        item.receivedAt = undefined;
        if (item.documentId) {
          d.documents = d.documents.filter((doc) => doc.id !== item.documentId);
          item.documentId = undefined;
        }
        ctx.audit('request_item.reset', 'information_request_item', itemId, { status: before }, { status: 'missing' });
        const job = d.jobs.find((j) => j.id === item.jobId);
        if (job) applyCompletenessEffects(d, ctx, job);
      });
    },

    addRequestItem(jobId, label) {
      mutate((d, ctx) => {
        const job = d.jobs.find((j) => j.id === jobId);
        if (!job) return;
        d.requestItems.push({ id: newId('req'), practiceId: d.practice.id, jobId, clientId: job.clientId, label, documentType: label, status: 'missing', required: true });
        ctx.audit('request_item.add', 'information_request_item', jobId, undefined, { label });
        applyCompletenessEffects(d, ctx, job);
      });
    },

    sendReminder(input) {
      mutate((d, ctx) => {
        const job = d.jobs.find((j) => j.id === input.jobId);
        if (!job) return;
        const client = d.clients.find((c) => c.id === job.clientId);
        d.communications.push({
          id: newId('cm'),
          practiceId: d.practice.id,
          clientId: job.clientId,
          jobId: job.id,
          direction: 'outbound',
          channel: input.channel,
          recipient: input.recipient,
          subject: input.subject,
          body: input.body,
          sentAt: nowIso(),
          sentByUserId: ctx.actorUserId,
          reminderStage: input.stage,
          documentsRequested: input.documentsRequested,
          responseStatus: 'awaiting',
          simulated: true,
        });
        for (const item of d.requestItems.filter((i) => i.jobId === job.id && i.status === 'missing')) {
          item.status = 'requested';
          item.requestedAt = nowIso();
        }
        const what = input.documentsRequested.length > 0 ? ` (${input.documentsRequested.map((s) => s.toLowerCase()).join(', ')})` : '';
        ctx.activity('reminder_sent', `${CHANNEL_LABELS[input.channel]} reminder sent to ${client?.name} for ${job.name}${what}.`, job);
        ctx.audit('communication.send', 'communication', job.id, undefined, { channel: input.channel, stage: input.stage, simulated: true });
      });
    },

    confirmInboxItem(itemId) {
      mutate((d, ctx) => {
        const item = d.inboxItems.find((i) => i.id === itemId);
        if (!item || item.status !== 'pending') return;
        const { clientId, jobId, documentType } = item.suggestion;
        if (!clientId) throw new Error('Choose a client before confirming.');
        const client = d.clients.find((c) => c.id === clientId);
        const job = jobId ? d.jobs.find((j) => j.id === jobId) : undefined;
        const doc: Document = {
          id: newId('doc'),
          practiceId: d.practice.id,
          clientId,
          jobId: job?.id,
          fileName: item.fileName,
          documentType,
          receivedAt: nowIso(),
          source: 'inbox',
          sizeKb: item.sizeKb,
        };
        d.documents.push(doc);
        item.status = 'confirmed';
        item.resolvedAt = nowIso();
        // Match the request item on the job by document type (case-insensitive), else by label prefix.
        let matched = false;
        if (job) {
          const target = d.requestItems.find((r) => r.jobId === job.id && r.status !== 'received' && r.documentType.toLowerCase() === documentType.toLowerCase())
            ?? d.requestItems.find((r) => r.jobId === job.id && r.status !== 'received' && (documentType.toLowerCase().includes(r.label.toLowerCase()) || r.label.toLowerCase().includes(documentType.toLowerCase())));
          if (target) {
            target.status = 'received';
            target.receivedAt = nowIso();
            target.documentId = doc.id;
            matched = true;
          }
        }
        d.communications.push({
          id: newId('cm'),
          practiceId: d.practice.id,
          clientId,
          jobId: job?.id,
          direction: 'inbound',
          channel: item.source === 'portal' ? 'portal' : 'email',
          recipient: item.sender ?? 'inbox',
          subject: item.fileName,
          body: `${documentType} received via Smart Inbox (${item.fileName}).`,
          sentAt: nowIso(),
          responseStatus: 'n/a',
          simulated: true,
        });
        for (const c of d.communications.filter((c) => c.jobId === job?.id && c.direction === 'outbound' && c.responseStatus === 'awaiting')) c.responseStatus = 'responded';
        ctx.activity('inbox_processed', `${documentType} (${item.fileName}) attached to ${client?.name}${job ? ` — ${job.name}` : ''}${matched ? ' and checklist updated' : ''}.`, job);
        ctx.audit('inbox.confirm', 'inbox_item', itemId, { status: 'pending' }, { status: 'confirmed', clientId, jobId: job?.id, documentId: doc.id });
        ctx.notify('document', 'Document attached', `${documentType} attached to ${client?.name}.`, job);
        if (job && matched) applyCompletenessEffects(d, ctx, job);
      });
    },

    dismissInboxItem(itemId) {
      mutate((d, ctx) => {
        const item = d.inboxItems.find((i) => i.id === itemId);
        if (!item) return;
        item.status = 'dismissed';
        item.resolvedAt = nowIso();
        ctx.audit('inbox.dismiss', 'inbox_item', itemId, { status: 'pending' }, { status: 'dismissed' });
      });
    },

    updateInboxSuggestion(itemId, patch) {
      mutate((d, ctx) => {
        const item = d.inboxItems.find((i) => i.id === itemId);
        if (!item) return;
        const before = { ...item.suggestion };
        if (patch.clientId !== undefined && patch.clientId !== item.suggestion.clientId) {
          item.suggestion.clientId = patch.clientId;
          item.suggestion.jobId = undefined;
        }
        if (patch.jobId !== undefined) item.suggestion.jobId = patch.jobId || undefined;
        if (patch.documentType !== undefined) item.suggestion.documentType = patch.documentType;
        item.suggestion.confidence = 1;
        item.suggestion.rationale = 'Confirmed manually by the practice.';
        ctx.audit('inbox.reclassify', 'inbox_item', itemId, before, { ...item.suggestion });
      });
    },

    updateClient(clientId, patch) {
      mutate((d, ctx) => {
        const client = d.clients.find((c) => c.id === clientId);
        if (!client) return;
        const before = { ...client };
        Object.assign(client, patch);
        ctx.activity('client_updated', `${client.name} details updated.`, undefined, clientId);
        ctx.audit('client.update', 'client', clientId, before, { ...client });
      });
    },

    createClient(input) {
      const id = newId('cl');
      const contactId = newId('ct');
      const created: Client = {
        id,
        practiceId: get().data.practice.id,
        name: input.name,
        type: input.type,
        lifecycle: 'onboarding',
        ownerUserId: input.ownerUserId,
        primaryContactId: contactId,
        preferredChannel: input.preferredChannel,
        yearEnd: input.yearEnd,
        averageResponseDays: 4,
        createdAt: nowIso(),
        registeredOffice: input.registeredOffice,
        companiesHouseStatus: input.companiesHouseStatus,
        sicCodes: input.sicCodes,
        incorporatedOn: input.incorporatedOn,
      };
      mutate((d, ctx) => {
        d.clients.push(created);
        const contact: Contact = { id: contactId, practiceId: d.practice.id, clientId: id, name: input.contactName, role: input.type === 'limited_company' ? 'Director' : 'Client', email: input.email, phone: input.phone, whatsapp: input.phone, isPrimary: true };
        d.contacts.push(contact);
        for (const [kind, value] of Object.entries(input.identifiers) as [ClientIdentifier['kind'], string][]) {
          if (value) d.identifiers.push({ id: newId('idf'), practiceId: d.practice.id, clientId: id, kind, value, sensitive: kind !== 'company_number' });
        }
        for (const code of input.services) {
          d.subscriptions.push({ id: newId('sub'), practiceId: d.practice.id, clientId: id, serviceCode: code, startedOn: get().today, active: true });
        }
        const filled = Object.keys(input.identifiers).filter((k) => input.identifiers[k as ClientIdentifier['kind']]);
        d.onboardingCases.push({
          id: newId('ob'),
          practiceId: d.practice.id,
          clientId: id,
          stage: 'details_requested',
          startedAt: nowIso(),
          checklist: [
            { key: 'contact', label: 'Client contact information', done: true, stage: 'details_requested' },
            { key: 'utr', label: 'UTR', done: filled.includes('utr'), stage: 'hmrc_ch_details' },
            { key: 'nino', label: 'NI number (directors)', done: filled.includes('nino'), stage: 'hmrc_ch_details' },
            { key: 'company_number', label: 'Company number', done: filled.includes('company_number') || input.type !== 'limited_company', stage: 'hmrc_ch_details' },
            { key: 'vat', label: 'VAT number', done: filled.includes('vat_number') || !input.services.includes('vat'), stage: 'hmrc_ch_details' },
            { key: 'paye', label: 'PAYE reference', done: filled.includes('paye_reference') || !input.services.includes('payroll'), stage: 'hmrc_ch_details' },
            { key: 'year_end', label: 'Accounting year end', done: !!input.yearEnd, stage: 'hmrc_ch_details' },
            { key: 'services', label: 'Services agreed', done: input.services.length > 0, stage: 'services' },
            { key: 'id_docs', label: 'ID documents', done: false, stage: 'identity_aml' },
            { key: 'aml', label: 'AML risk assessment', done: false, stage: 'identity_aml' },
            { key: 'engagement', label: 'Engagement letter signed', done: false, stage: 'engagement' },
            { key: 'agent_auth', label: 'Agent authorisation (64-8)', done: false, stage: 'engagement' },
            { key: 'ch_identity', label: 'Companies House identity verification', done: input.type !== 'limited_company', stage: 'identity_aml' },
          ],
        });
        ctx.activity('client_created', `${input.name} added as a new client (onboarding started).`, undefined, id);
        ctx.audit('client.create', 'client', id, undefined, { name: input.name, type: input.type });
      });
      return created;
    },

    importClients(rows) {
      let created = 0;
      const skipped: string[] = [];
      mutate((d, ctx) => {
        const existingNumbers = new Set(d.identifiers.filter((i) => i.kind === 'company_number').map((i) => i.value.replace(/\s/g, '').toUpperCase()));
        const toImport = rows.filter((r) => {
          const key = r.companyNumber.replace(/\s/g, '').toUpperCase();
          if (existingNumbers.has(key)) {
            skipped.push(`${r.name} (${r.companyNumber}) — already on file`);
            return false;
          }
          existingNumbers.add(key);
          return true;
        });
        if (toImport.length === 0) return;
        const built = buildImportedClientRecords(toImport, d.practice.id, get().currentUserId, get().today);
        d.clients.push(...built.clients);
        d.contacts.push(...built.contacts);
        d.identifiers.push(...built.identifiers);
        d.subscriptions.push(...built.subscriptions);
        d.obligations.push(...built.obligations);
        d.jobs.push(...built.jobs);
        d.requestItems.push(...built.requestItems);
        d.people.push(...built.people);
        d.personRoles.push(...built.personRoles);
        created = built.clients.length;
        ctx.activity('client_created', `${created} client${created === 1 ? '' : 's'} imported from a spreadsheet.`);
        ctx.audit('client.import', 'client', 'bulk', undefined, { count: created, names: built.clients.map((c) => c.name) });
      });
      return { created, skipped };
    },

    updateIdentifier(clientId, kind, value) {
      mutate((d, ctx) => {
        const existing = d.identifiers.find((i) => i.clientId === clientId && i.kind === kind);
        if (existing) {
          ctx.audit('identifier.update', 'client_identifier', existing.id, { value: '[redacted]' }, { value: '[redacted]' });
          existing.value = value;
        } else {
          const rec: ClientIdentifier = { id: newId('idf'), practiceId: d.practice.id, clientId, kind, value, sensitive: kind !== 'company_number' };
          d.identifiers.push(rec);
          ctx.audit('identifier.create', 'client_identifier', rec.id, undefined, { kind });
        }
        const client = d.clients.find((c) => c.id === clientId);
        ctx.activity('client_updated', `${client?.name} ${kind.replace(/_/g, ' ')} updated.`, undefined, clientId);
      });
    },

    recordIdentifierReveal(clientId, kind) {
      mutate((d, ctx) => {
        const rec = d.identifiers.find((i) => i.clientId === clientId && i.kind === kind);
        if (!rec) return;
        ctx.audit('identifier.reveal', 'client_identifier', rec.id, undefined, { kind });
      });
    },

    updatePersonRoleVerification(roleId, status, personalCodeCaptured) {
      mutate((d, ctx) => {
        const role = d.personRoles.find((r) => r.id === roleId);
        if (!role) return;
        const before = { identityVerification: role.identityVerification, personalCodeCaptured: role.personalCodeCaptured };
        role.identityVerification = status;
        if (personalCodeCaptured !== undefined) role.personalCodeCaptured = personalCodeCaptured;
        if (status === 'verified') {
          role.personalCodeCaptured = true;
          role.evidenceStatus = 'checked';
        }
        const person = d.people.find((p) => p.id === role.personId);
        const client = d.clients.find((c) => c.id === role.clientId);
        ctx.activity('client_updated', `${person?.fullName} (${role.kind === 'psc' ? 'PSC' : role.kind}) identity verification marked ${status.replace(/_/g, ' ')} for ${client?.name}.`, undefined, role.clientId);
        ctx.audit('person_role.verification', 'person_role', roleId, before, { identityVerification: status, personalCodeCaptured: role.personalCodeCaptured });
      });
    },

    toggleOnboardingItem(caseId, key) {
      mutate((d, ctx) => {
        const oc = d.onboardingCases.find((c) => c.id === caseId);
        if (!oc) return;
        const item = oc.checklist.find((i) => i.key === key);
        if (!item) return;
        item.done = !item.done;
        ctx.audit('onboarding.item', 'onboarding_case', caseId, { [key]: !item.done }, { [key]: item.done });
        const client = d.clients.find((c) => c.id === oc.clientId);
        if (oc.checklist.every((i) => i.done) && oc.stage !== 'active') {
          oc.stage = 'active';
          if (client) client.lifecycle = 'active';
          ctx.activity('onboarding_updated', `${client?.name} onboarding complete — client is now active.`, undefined, oc.clientId);
        }
      });
    },

    setOnboardingStage(caseId, stage) {
      mutate((d, ctx) => {
        const oc = d.onboardingCases.find((c) => c.id === caseId);
        if (!oc) return;
        const before = oc.stage;
        oc.stage = stage;
        const client = d.clients.find((c) => c.id === oc.clientId);
        if (client) client.lifecycle = stage === 'active' ? 'active' : 'onboarding';
        ctx.activity('onboarding_updated', `${client?.name} moved to ${stage.replace(/_/g, ' ')} stage.`, undefined, oc.clientId);
        ctx.audit('onboarding.stage', 'onboarding_case', caseId, { stage: before }, { stage });
      });
    },

    markNotificationRead(id) {
      mutate((d) => {
        const n = d.notifications.find((x) => x.id === id);
        if (n) n.read = true;
      });
    },
    markAllNotificationsRead() {
      mutate((d) => {
        d.notifications.forEach((n) => (n.read = true));
      });
    },

    addNote(clientId, message, jobId) {
      mutate((d, ctx) => {
        const job = jobId ? d.jobs.find((j) => j.id === jobId) : undefined;
        ctx.activity('note', message, job, clientId);
      });
    },
  };
});

/**
 * Collects side-effect records (activity, audit, notifications) during a mutation.
 */
class MutationContext {
  activities: Activity[] = [];
  audits: AuditEvent[] = [];
  notifications: Notification[] = [];
  readonly correlationId = newId('corr');
  constructor(
    readonly actorUserId: string,
    readonly practiceId: string,
  ) {}

  activity(kind: ActivityKind, message: string, job?: Job, clientId?: string): void {
    this.activities.unshift({
      id: newId('act'),
      practiceId: job?.practiceId ?? this.practiceId,
      kind,
      message,
      clientId: clientId ?? job?.clientId,
      jobId: job?.id,
      actorUserId: this.actorUserId,
      occurredAt: nowIso(),
    });
  }

  audit(action: string, entityType: string, entityId: string, before?: unknown, after?: unknown): void {
    this.audits.unshift({
      id: newId('aud'),
      practiceId: this.practiceId,
      actorUserId: this.actorUserId,
      action,
      entityType,
      entityId,
      before,
      after,
      occurredAt: nowIso(),
      source: 'ui',
      correlationId: this.correlationId,
    });
  }

  notify(kind: Notification['kind'], title: string, body: string, job?: Job, userId?: string): void {
    this.notifications.unshift({
      id: newId('ntf'),
      practiceId: this.practiceId,
      userId,
      title,
      body,
      kind,
      clientId: job?.clientId,
      jobId: job?.id,
      createdAt: nowIso(),
      read: false,
    });
  }
}

/**
 * When completeness changes, apply the domain rule for status transitions and
 * record the outcome so every screen reflects it immediately.
 */
function applyCompletenessEffects(d: PracticeData, ctx: MutationContext, job: Job): void {
  const completeness = computeCompleteness(itemsForJob(d.requestItems, job.id));
  const suggested = suggestedTransitionOnCompleteness(job, completeness);
  const client = d.clients.find((c) => c.id === job.clientId);
  if (suggested === 'ready_to_start') {
    job.status = 'ready_to_start';
    job.waitingOn = 'accountant';
    job.statusChangedAt = nowIso();
    for (const c of d.communications.filter((c) => c.jobId === job.id && c.direction === 'outbound' && c.responseStatus === 'awaiting')) c.responseStatus = 'responded';
    ctx.activity('status_changed', `All documents received for ${client?.name} ${job.name}. Chasing stopped — job is ready to start.`, job);
    ctx.audit('job.transition.auto', 'job', job.id, { status: 'waiting_for_records' }, { status: 'ready_to_start', reason: 'completeness' });
    ctx.notify('job', 'Job now ready', `${client?.name} ${job.name} has everything it needs. No further chasing required.`, job);
  } else if (suggested === 'waiting_for_records') {
    job.status = 'waiting_for_records';
    job.waitingOn = 'client';
    job.statusChangedAt = nowIso();
    ctx.audit('job.transition.auto', 'job', job.id, { status: 'ready_to_start' }, { status: 'waiting_for_records', reason: 'completeness' });
  }
}
