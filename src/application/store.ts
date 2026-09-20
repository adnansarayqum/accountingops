import { create } from 'zustand';
import { buildEmptyPracticeData, OWNER_USER_ID } from './emptyState';
import { buildImportedClientRecords, PLACEHOLDER_CONTACT_NAME, type ClientRosterRow } from './clientImport';
import type { AuthUser } from './auth';
import type { CompanyPeopleResponse, CompanyProfile } from '../integrations/companiesHouseTypes';
import type { PortalActivity } from '../integrations/portal';
import { AML_RATING_LABELS, AML_REVIEW_MONTHS } from '../domain/rules/aml';
import { nowIso, todayIso } from '../domain/dates';
import { normaliseCompanyNumber } from '../domain/companyNumber';
import { birthMonthYearOf, isSamePerson, normalisePersonName, personNameKey } from '../domain/personNames';
import { applyRetention } from '../domain/retention';
import { applyPeopleMerge, findDuplicatePeople, type PeopleMergeSummary } from '../domain/peopleMerge';
import { applyCorporationTaxBackfill, findMissingCorporationTax, type CorporationTaxBackfillSummary } from '../domain/corporationTax';
import { CHANNEL_LABELS, JOB_STATUS_LABELS, SERVICES, FILING_DESTINATION } from '../domain/catalog';
import {
  canTransition,
  computeCompleteness,
  DEFAULT_WAITING_ON,
  generateNextJob,
  itemsForJob,
  sanitizeThresholdPatch,
  suggestedTransitionOnCompleteness,
} from '../domain/rules';
import type { AmlRiskRating,
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
  CompaniesHouseVerification,
  PersonRole,
  PersonRoleKind,
  PracticeData,
  PracticeThresholds,
  RegisteredAddress,
  ServiceCode,
  TimeEntry,
  WaitingOn,
  WipEntry,
} from '../domain/types';
import { newId } from './ids';
import { LocalStorageRepository } from './persistence/localStorageRepository';
import { peekSnapshot, type PeekedSnapshot, type PracticeRepository } from './persistence/repository';
import { SnapshotConflictError } from './persistence/httpRepository';

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
  /**
   * True when the last load failed and the data on screen is an empty
   * stand-in, not the practice. Every mutation is refused while this is set
   * — saving would overwrite the real snapshot with the stand-in.
   */
  loadFailed: boolean;
  /** True from a mutation until the save that carries it has completed. */
  unsaved: boolean;

  // lifecycle
  init(): Promise<void>;
  /**
   * Re-reads the stored snapshot and adopts it if this tab has nothing
   * unsaved. Resolves true when the data on screen was replaced. Called on
   * tab focus and before a background write, so a tab that has sat idle
   * doesn't carry on from a copy the other users have since moved past.
   */
  refresh(): Promise<boolean>;

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
  markItemReceived(itemId: string, opts?: { fileName?: string; source?: Document['source']; sizeKb?: number; portalUploadId?: string }): void;
  /**
   * Applies what clients did through the portal — uploads and approval
   * decisions — through the same actions an accountant would use, so every
   * rule (completeness, auto-transitions, an approval moving the job on)
   * runs exactly once, where it is defined. Returns the ids it handled so
   * the caller can acknowledge them; anything it could not match (a job
   * since deleted, say) is returned too, so it is not offered forever.
   */
  applyPortalActivity(activity: PortalActivity[]): { applied: string[]; skipped: string[] };
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
    /** How the message actually left (or didn't). Omitted = simulated, the original behaviour. */
    delivery?: { status: 'sent' | 'handed_off' | 'simulated'; providerName: string; providerMessageId?: string };
  }): void;

  // inbox
  confirmInboxItem(itemId: string): void;
  dismissInboxItem(itemId: string): void;
  updateInboxSuggestion(itemId: string, patch: { clientId?: string; jobId?: string; documentType?: string }): void;

  // clients & people
  updateClient(clientId: string, patch: Partial<Client>): void;
  /** Records an AML review: the risk rating decided today and an optional note. Audited, since the trail is the point. */
  recordAmlReview(clientId: string, input: { rating: AmlRiskRating; note?: string }): void;
  /** Records the client's rolling twelve-month turnover, dated today, for the VAT threshold watch. */
  recordTurnover(clientId: string, amount: number | null): void;
  /** Logs extra work done for a client that hasn't been billed yet — dated today unless a date is given, credited to the signed-in user. */
  addWipEntry(clientId: string, input: { description: string; amount: number; jobId?: string; performedOn?: IsoDate }): WipEntry;
  /** Marks a work-in-progress entry invoiced or written off. Once resolved it stays as a record, not deleted. */
  resolveWipEntry(entryId: string, status: 'invoiced' | 'written_off', note?: string): void;
  /** Removes a work-in-progress entry entered by mistake — only while it is still unbilled. */
  deleteWipEntry(entryId: string): void;
  /** Logs time spent on a client, credited to the signed-in user, dated today unless a date is given. */
  logTime(clientId: string, input: { minutes: number; jobId?: string; note?: string; loggedOn?: IsoDate }): TimeEntry;
  /** Removes a time entry logged by mistake. */
  deleteTimeEntry(entryId: string): void;
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
  /** Re-pulls a client's Companies House data. Updates company fields and adds any director/PSC not already linked — never removes an existing role. */
  refreshClientFromCompaniesHouse(clientId: string, profile: CompanyProfile | null, people: CompanyPeopleResponse | null): { peopleAdded: number; verificationsConfirmed: number };
  /** Same, for a batch — applied as a single change so the background sync doesn't fire one whole-snapshot save per client. */
  refreshClientsFromCompaniesHouse(
    updates: { clientId: string; profile: CompanyProfile | null; people: CompanyPeopleResponse | null }[],
  ): { clientsUpdated: number; peopleAdded: number; verificationsConfirmed: number };
  /** Merges every group Settings → Duplicate people lists (see domain/peopleMerge.ts). Does nothing, and saves nothing, when there are none. */
  mergeDuplicatePeople(): PeopleMergeSummary;
  /** Creates the corporation tax obligation and first job for every limited company Settings → Corporation tax lists (see domain/corporationTax.ts). Does nothing, and saves nothing, when there are none. */
  generateCorporationTaxObligations(): CorporationTaxBackfillSummary;
  /** Edits a contact's details (name, role, email, phone, WhatsApp). */
  updateContact(contactId: string, patch: Partial<Pick<Contact, 'name' | 'role' | 'email' | 'phone' | 'whatsapp'>>): void;
  /** Adds another contact to a client. The first contact added to a client with none becomes its primary. */
  addContact(clientId: string, input: { name: string; role?: string; email?: string; phone?: string; whatsapp?: string }): Contact;
  /** Removes a contact. A client's last remaining contact can't be removed — something has to be there to chase. */
  removeContact(contactId: string): void;
  /** Makes an existing contact the one reminders go to. */
  setPrimaryContact(clientId: string, contactId: string): void;
  updateIdentifier(clientId: string, kind: ClientIdentifier['kind'], value: string): void;
  recordIdentifierReveal(clientId: string, kind: ClientIdentifier['kind']): void;
  updatePersonRoleVerification(roleId: string, status: IdentityVerificationStatus, personalCodeCaptured?: boolean): void;

  // team
  /** Corrects a team member's display name (e.g. a typo from initial setup) — shown everywhere in the app, including Settings' "Signed in as" line. */
  renameUser(userId: string, name: string): void;

  // practice configuration
  /** Merges into the practice's timing thresholds (Settings → Timing thresholds) — only the fields present in `patch` change. */
  updatePracticeThresholds(patch: Partial<PracticeThresholds>): void;

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

type Mutation = (d: PracticeData, ctx: MutationContext) => PracticeData | void;

// One save in flight at a time, and at most one waiting behind it. Two
// quick actions used to fire two independent PUTs, and nothing stopped the
// first from landing after the second — persisting the older snapshot over
// the newer one. Now the second waits, and because every snapshot is the
// whole practice, only the newest waiting one needs sending.
let saveInFlight = false;
let queued: PracticeData | null = null;

// The mutations behind every snapshot not yet confirmed saved. When the
// server refuses a save because someone else saved first, these are
// replayed on top of what they saved, so neither person's work is lost.
let unsavedMutations: Mutation[] = [];

/**
 * Counts every local mutation. A background refresh notes it before it reads
 * and drops what it read if it has moved — including a mutation that was
 * saved (so `unsaved` is false again) before the read came back.
 */
let mutationEpoch = 0;

/** How many times one save may lose the race before we stop replaying and take the server's copy. */
const MAX_CONFLICT_REPLAYS = 3;

/**
 * Client fields that must only ever change through their own recording
 * action (recordAmlReview, recordTurnover) so the audit trail names the
 * change correctly. updateClient's generic patch strips these out.
 */
const COMPLIANCE_ONLY_FIELDS: (keyof Client)[] = ['amlRiskRating', 'amlLastReviewedOn', 'amlReviewNote', 'rolling12MonthTurnover', 'turnoverRecordedOn'];

export function configureRepository(repo: PracticeRepository): void {
  repository = repo;
  saveInFlight = false;
  queued = null;
  unsavedMutations = [];
}

/** Runs one mutation against a copy of `base` and returns the result — the pure half of mutate(). */
function applyMutation(base: PracticeData, fn: Mutation, currentUserId: string): PracticeData {
  const ctx = new MutationContext(currentUserId, base.practice.id);
  const draft = structuredClone(base);
  const result = fn(draft, ctx) ?? draft;
  result.activities = [...ctx.activities, ...result.activities];
  result.auditEvents = [...ctx.audits, ...result.auditEvents];
  result.notifications = [...ctx.notifications, ...result.notifications];
  return applyRetention(result);
}

/**
 * Persist after every mutation. The first save starts synchronously (the
 * localStorage adapter writes before yielding, so a navigation straight
 * after an action can never lose it); later ones are chained behind it.
 * Failures are surfaced, never swallowed silently.
 */
function persist(get: () => AppState, set: (patch: Partial<AppState>) => void): void {
  queued = get().data;
  if (saveInFlight) return;
  void drainSaves(get, set);
}

async function drainSaves(get: () => AppState, set: (patch: Partial<AppState>) => void): Promise<void> {
  saveInFlight = true;
  let replays = 0;
  try {
    while (queued) {
      const data = queued;
      queued = null;
      // The mutations this snapshot carries — everything unsaved so far.
      const carried = unsavedMutations.length;
      try {
        await repository.save(data);
        unsavedMutations = unsavedMutations.slice(carried);
        if (!queued) set({ unsaved: false });
      } catch (err) {
        if (err instanceof SnapshotConflictError && replays < MAX_CONFLICT_REPLAYS) {
          // Someone else saved first. Rebuild our change on top of theirs and
          // try again — the mutations are pure, so replaying them onto the
          // newer snapshot gives the result the user would have got had they
          // started from it.
          replays += 1;
          try {
            let rebased = err.current;
            for (const fn of unsavedMutations) rebased = applyMutation(rebased, fn, get().currentUserId);
            set({ data: rebased });
            queued = rebased;
            continue;
          } catch (replayErr) {
            console.error('Could not replay a change onto the newer snapshot', replayErr);
          }
        }
        if (err instanceof SnapshotConflictError) {
          // Replay isn't possible (or keeps losing the race): take the server's
          // copy and tell the user exactly what happened, rather than either
          // overwriting the other person's work or pretending ours saved.
          unsavedMutations = [];
          queued = null;
          set({ data: applyRetention(err.current), unsaved: false });
          get().toast({ title: "Someone else changed this first", description: 'Their version has been loaded. Your last change was not saved — please make it again.', tone: 'error' });
          continue;
        }
        console.error('Persist failed', err);
        get().toast({ title: "We couldn't save that change", description: "It's still on screen but not saved. Try the action again, and keep this tab open until it saves.", tone: 'error' });
      }
    }
  } finally {
    saveInFlight = false;
  }
}

/**
 * Merges one client's Companies House lookup into the practice data, and
 * returns how many directors/PSCs were newly linked. Shared by the single
 * (manual Refresh button) and batch (background sync) entry points so both
 * behave identically.
 */
interface RefreshOutcome {
  peopleAdded: number;
  verificationsConfirmed: number;
}

/**
 * Companies House says this person has verified their identity: record it
 * on the role, unless the practice already has. Only ever upgrades — a
 * status the practice set by hand is never overwritten, and Companies
 * House saying nothing is never read as "not verified".
 */
function confirmVerificationFromCompaniesHouse(d: PracticeData, ctx: MutationContext, role: PersonRole, verifiedOn: string | null | undefined, client: Client): boolean {
  if (!verifiedOn || role.identityVerification === 'verified') return false;
  const before = { identityVerification: role.identityVerification, personalCodeCaptured: role.personalCodeCaptured };
  role.identityVerification = 'verified';
  role.identityVerificationSource = 'companies_house';
  role.identityVerifiedOn = verifiedOn;
  const person = d.people.find((p) => p.id === role.personId);
  ctx.activity('client_updated', `${person ? normalisePersonName(person.fullName) : 'A person'} (${role.kind === 'psc' ? 'PSC' : role.kind}) identity verification confirmed by Companies House for ${client.name}.`, undefined, client.id);
  ctx.audit('person_role.verification', 'person_role', role.id, before, { identityVerification: 'verified', personalCodeCaptured: role.personalCodeCaptured, source: 'companies_house', verifiedOn });
  return true;
}

function applyCompaniesHouseRefresh(
  d: PracticeData,
  ctx: MutationContext,
  clientId: string,
  profile: CompanyProfile | null,
  people: CompanyPeopleResponse | null,
): RefreshOutcome {
  const client = d.clients.find((c) => c.id === clientId);
  if (!client) return { peopleAdded: 0, verificationsConfirmed: 0 };
  let peopleAdded = 0;
  let verificationsConfirmed = 0;

  if (profile) {
    client.registeredOffice = profile.registeredOfficeAddress ?? client.registeredOffice;
    client.companiesHouseStatus = profile.companyStatus ?? client.companiesHouseStatus;
    client.sicCodes = profile.sicCodes.length > 0 ? profile.sicCodes : client.sicCodes;
    client.incorporatedOn = profile.dateOfCreation ?? client.incorporatedOn;
    client.previousNames = profile.previousNames && profile.previousNames.length > 0 ? profile.previousNames : client.previousNames;
    client.companiesHouseSyncedAt = nowIso();
  }

  if (people) {
    // Only ever additive: a director/PSC Companies House no longer lists (resigned,
    // ceased) keeps their existing role here rather than being silently removed — the
    // practice's own identity-verification history on that role shouldn't just vanish.
    //
    // Matching is by normalised name (Companies House writes "SMITH, Jane" in one
    // list and "Mrs Jane Smith" in the other) with birth month/year as the
    // tie-breaker. Names already on file are left as they were stored — only new
    // records get the normalised form — so nothing the practice has typed changes.
    const existingRoleKeys = new Set(
      d.personRoles
        .filter((r) => r.clientId === clientId)
        .map((r) => `${personNameKey(d.people.find((p) => p.id === r.personId)?.fullName ?? '')}|${r.kind}`),
    );
    const seenAt = nowIso();
    const seen = (p: { identityVerification?: { verifiedOn: string | null; statementDueOn: string | null } | null }): CompaniesHouseVerification => ({
      checkedAt: seenAt,
      verifiedOn: p.identityVerification?.verifiedOn ?? null,
      dueOn: p.identityVerification?.statementDueOn ?? null,
    });
    const entries: { name: string; birthMonthYear?: string; kind: PersonRoleKind; naturesOfControl?: string[]; verifiedOn?: string | null; seen: CompaniesHouseVerification }[] = [
      ...people.directors.map((p) => ({ name: p.name, birthMonthYear: birthMonthYearOf(p.dateOfBirth), kind: 'director' as const, verifiedOn: p.identityVerification?.verifiedOn, seen: seen(p) })),
      ...people.pscs.map((p) => ({ name: p.name, birthMonthYear: birthMonthYearOf(p.dateOfBirth), kind: 'psc' as const, naturesOfControl: p.naturesOfControl, verifiedOn: p.identityVerification?.verifiedOn, seen: seen(p) })),
    ];
    for (const entry of entries) {
      const key = personNameKey(entry.name);
      const existingPerson = d.people.find((p) => isSamePerson({ name: p.fullName, birthMonthYear: p.birthMonthYear }, entry));
      // A person on file without a recorded birth month learns it now — even when
      // their role is already linked — so a later namesake with a different one
      // is kept apart.
      if (existingPerson && !existingPerson.birthMonthYear && entry.birthMonthYear) existingPerson.birthMonthYear = entry.birthMonthYear;
      if (existingRoleKeys.has(`${key}|${entry.kind}`)) {
        // Already linked — but Companies House may now say they've verified.
        const existingRole = d.personRoles.find((r) => r.clientId === clientId && r.kind === entry.kind && personNameKey(d.people.find((p) => p.id === r.personId)?.fullName ?? '') === key);
        if (existingRole) {
          existingRole.companiesHouseVerification = entry.seen;
          if (confirmVerificationFromCompaniesHouse(d, ctx, existingRole, entry.verifiedOn, client)) verificationsConfirmed += 1;
        }
        continue;
      }
      existingRoleKeys.add(`${key}|${entry.kind}`);
      const personId = existingPerson?.id ?? newId('p');
      if (!existingPerson) d.people.push({ id: personId, practiceId: d.practice.id, fullName: normalisePersonName(entry.name), birthMonthYear: entry.birthMonthYear });
      const role: PersonRole = {
        id: newId('pr'),
        practiceId: d.practice.id,
        personId,
        clientId,
        kind: entry.kind,
        identityVerification: 'not_started',
        personalCodeCaptured: false,
        evidenceStatus: 'none',
        naturesOfControl: entry.naturesOfControl,
        companiesHouseVerification: entry.seen,
      };
      d.personRoles.push(role);
      peopleAdded += 1;
      if (confirmVerificationFromCompaniesHouse(d, ctx, role, entry.verifiedOn, client)) verificationsConfirmed += 1;
    }
    // A client imported before any director data was available gets a placeholder
    // primary contact name — replace it now that a real director's name is known.
    if (people.directors.length > 0) {
      const contact = d.contacts.find((c) => c.id === client.primaryContactId);
      if (contact && contact.name === PLACEHOLDER_CONTACT_NAME) contact.name = normalisePersonName(people.directors[0].name);
    }
  }

  const notes = [
    peopleAdded > 0 ? `${peopleAdded} new ${peopleAdded === 1 ? 'person' : 'people'} added` : null,
    verificationsConfirmed > 0 ? `${verificationsConfirmed} identity ${verificationsConfirmed === 1 ? 'verification' : 'verifications'} confirmed` : null,
  ].filter(Boolean);
  ctx.activity('client_updated', `${client.name} refreshed from Companies House${notes.length > 0 ? ` — ${notes.join(', ')}` : ''}.`, undefined, clientId);
  ctx.audit('client.companies_house_refresh', 'client', clientId, undefined, { peopleAdded, verificationsConfirmed });
  return { peopleAdded, verificationsConfirmed };
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
    if (state.loadFailed) {
      state.toast({ title: 'Changes are paused', description: "Practice data didn't load, so nothing can be changed until it does. Use Try again at the top of the page.", tone: 'error' });
      return;
    }
    const result = applyMutation(state.data, fn, state.currentUserId);
    mutationEpoch += 1;
    unsavedMutations.push(fn);
    set({ data: result, unsaved: true });
    persist(get, set);
  };

  return {
    data: buildEmptyPracticeData(),
    today: todayIso(),
    ready: false,
    currentUserId: OWNER_USER_ID,
    toasts: [],
    authMode: 'local',
    authUser: null,
    loadFailed: false,
    unsaved: false,

    async init() {
      const today = todayIso();
      try {
        const loaded = await loadWithRetry();
        // A load never writes. An empty practice is only ever saved once
        // something is actually added to it — a "nothing stored yet" answer
        // that was wrong (a misrouted request, say) must not become a real
        // empty snapshot on top of the one the practice actually has.
        unsavedMutations = [];
        // Feeds are capped on the way in as well as on every change, so a
        // snapshot saved before the caps existed shrinks on its next save.
        set({ data: loaded ? applyRetention(loaded) : buildEmptyPracticeData(), today, ready: true, loadFailed: false, unsaved: false });
      } catch (err) {
        // A transient failure here must never leave the app stuck on the
        // splash screen forever — show the shell with an empty, read-only
        // stand-in and a way to retry. Read-only matters: the first save
        // from a writable empty practice would replace the real one.
        console.error('Failed to load practice data', err);
        set({ data: buildEmptyPracticeData(), today, ready: true, loadFailed: true, unsaved: false });
        get().toast({ title: "Couldn't load practice data", description: 'Changes are paused until it loads. Use Try again at the top of the page.', tone: 'error' });
      }
    },

    async refresh() {
      const state = get();
      if (!state.ready || state.loadFailed || state.unsaved || saveInFlight) return false;
      // Bound to the repository the read started on: a repository swap
      // mid-flight (sign-in completing) makes this read someone else's.
      const readFrom = repository;
      const epoch = mutationEpoch;
      let peeked: PeekedSnapshot;
      try {
        peeked = await peekSnapshot(readFrom);
      } catch {
        return false;
      }
      // A mutation that started while the read was in flight is newer than
      // what was read — keep it, and do NOT adopt the read's version: the
      // repository would otherwise base the next save on a version whose
      // data this client threw away, letting that save overwrite the very
      // changes it never saw without the server's conflict check firing.
      if (!peeked.data || readFrom !== repository || epoch !== mutationEpoch || get().unsaved || saveInFlight) return false;
      const loaded = applyRetention(peeked.data);
      // Adopting the version is what makes the read "ours"; refused when the
      // repository moved on (a save landed) while the read was in flight.
      if (!peeked.adopt()) return false;
      if (JSON.stringify(loaded) === JSON.stringify(get().data)) return false;
      set({ data: loaded });
      return true;
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
          sizeKb: opts?.sizeKb ?? 240,
          portalUploadId: opts?.portalUploadId,
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

    applyPortalActivity(activity) {
      const applied: string[] = [];
      const skipped: string[] = [];
      for (const entry of activity) {
        const d = get().data;
        const job = d.jobs.find((j) => j.id === entry.jobId && j.clientId === entry.clientId);
        if (!job) {
          skipped.push(entry.id);
          continue;
        }
        if (entry.kind === 'upload') {
          const item = entry.requestItemId ? d.requestItems.find((i) => i.id === entry.requestItemId && i.jobId === job.id) : undefined;
          if (item) {
            if (item.status !== 'received') get().markItemReceived(item.id, { fileName: entry.fileName ?? undefined, source: 'portal', sizeKb: entry.sizeKb ?? undefined, portalUploadId: entry.uploadId ?? undefined });
          } else {
            // A file sent against no particular request still belongs on the
            // job — it is recorded as a document, and the accountant decides
            // what it satisfies.
            mutate((data, ctx) => {
              const client = data.clients.find((c) => c.id === job.clientId);
              data.documents.push({ id: newId('doc'), practiceId: data.practice.id, clientId: job.clientId, jobId: job.id, fileName: entry.fileName ?? 'document', documentType: 'Other', receivedAt: nowIso(), source: 'portal', sizeKb: entry.sizeKb ?? 1, portalUploadId: entry.uploadId ?? undefined });
              ctx.activity('document_received', `${entry.fileName ?? 'A file'} uploaded by ${client?.name} through the portal for ${job.name}.`, job);
            });
          }
          applied.push(entry.id);
        } else if (entry.kind === 'approval' && (entry.decision === 'approved' || entry.decision === 'rejected')) {
          get().recordApproval(job.id, 'client', entry.decision, `${entry.actorName ?? 'Client'} (via portal)`, entry.note ?? undefined);
          applied.push(entry.id);
        } else {
          skipped.push(entry.id);
        }
      }
      return { applied, skipped };
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
      const delivery = input.delivery ?? { status: 'simulated' as const, providerName: 'simulated' };
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
          simulated: delivery.status === 'simulated',
          deliveryStatus: delivery.status,
          providerName: delivery.providerName,
          providerMessageId: delivery.providerMessageId,
        });
        for (const item of d.requestItems.filter((i) => i.jobId === job.id && i.status === 'missing')) {
          item.status = 'requested';
          item.requestedAt = nowIso();
        }
        const what = input.documentsRequested.length > 0 ? ` (${input.documentsRequested.map((s) => s.toLowerCase()).join(', ')})` : '';
        ctx.activity('reminder_sent', `${CHANNEL_LABELS[input.channel]} reminder sent to ${client?.name} for ${job.name}${what}.`, job);
        ctx.audit('communication.send', 'communication', job.id, undefined, { channel: input.channel, stage: input.stage, delivery: delivery.status, provider: delivery.providerName });
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

    recordAmlReview(clientId, input) {
      mutate((d, ctx) => {
        const client = d.clients.find((c) => c.id === clientId);
        if (!client) return;
        // input.rating is typed as AmlRiskRating, but that's compile-time
        // only — guard against a caller outside the UI (a devtools call, a
        // future bulk-import path) passing something outside the known
        // set, which would otherwise write a rating the AML rule can't
        // recognise into the client record.
        if (!(input.rating in AML_REVIEW_MONTHS)) return;
        const before = { amlRiskRating: client.amlRiskRating, amlLastReviewedOn: client.amlLastReviewedOn, amlReviewNote: client.amlReviewNote };
        client.amlRiskRating = input.rating;
        client.amlLastReviewedOn = get().today;
        client.amlReviewNote = input.note?.trim() || undefined;
        ctx.activity('client_updated', `AML review recorded for ${client.name}: ${AML_RATING_LABELS[input.rating].toLowerCase()}.`, undefined, clientId);
        ctx.audit('client.aml_review', 'client', clientId, before, { amlRiskRating: client.amlRiskRating, amlLastReviewedOn: client.amlLastReviewedOn, amlReviewNote: client.amlReviewNote });
      });
    },

    recordTurnover(clientId, amount) {
      mutate((d, ctx) => {
        const client = d.clients.find((c) => c.id === clientId);
        if (!client) return;
        const before = { rolling12MonthTurnover: client.rolling12MonthTurnover, turnoverRecordedOn: client.turnoverRecordedOn };
        if (amount === null || !Number.isFinite(amount) || amount < 0) {
          client.rolling12MonthTurnover = undefined;
          client.turnoverRecordedOn = undefined;
        } else {
          client.rolling12MonthTurnover = Math.round(amount);
          client.turnoverRecordedOn = get().today;
        }
        ctx.audit('client.turnover', 'client', clientId, before, { rolling12MonthTurnover: client.rolling12MonthTurnover, turnoverRecordedOn: client.turnoverRecordedOn });
      });
    },

    addWipEntry(clientId, input) {
      const created: WipEntry = {
        id: newId('wip'),
        practiceId: get().data.practice.id,
        clientId,
        jobId: input.jobId,
        description: input.description.trim(),
        amount: Math.max(0, Math.round(input.amount)),
        performedOn: input.performedOn ?? get().today,
        performedByUserId: get().currentUserId,
        status: 'unbilled',
        createdAt: nowIso(),
      };
      mutate((d, ctx) => {
        const client = d.clients.find((c) => c.id === clientId);
        if (!client) return;
        d.wipEntries.push(created);
        ctx.activity('client_updated', `Unbilled work recorded for ${client.name}: ${created.description} (£${created.amount}).`, undefined, clientId);
        ctx.audit('wip.create', 'wip_entry', created.id, undefined, { clientId, description: created.description, amount: created.amount });
      });
      return created;
    },

    resolveWipEntry(entryId, status, note) {
      mutate((d, ctx) => {
        const entry = d.wipEntries.find((w) => w.id === entryId);
        if (!entry || entry.status !== 'unbilled') return;
        const before = { status: entry.status, resolvedAt: entry.resolvedAt, resolutionNote: entry.resolutionNote };
        entry.status = status;
        entry.resolvedAt = nowIso();
        entry.resolutionNote = note?.trim() || undefined;
        const client = d.clients.find((c) => c.id === entry.clientId);
        ctx.activity('client_updated', `${status === 'invoiced' ? 'Invoiced' : 'Written off'}: ${entry.description}${client ? ` for ${client.name}` : ''}.`, undefined, entry.clientId);
        ctx.audit('wip.resolve', 'wip_entry', entryId, before, { status: entry.status, resolvedAt: entry.resolvedAt, resolutionNote: entry.resolutionNote });
      });
    },

    deleteWipEntry(entryId) {
      mutate((d, ctx) => {
        const entry = d.wipEntries.find((w) => w.id === entryId);
        // Only ever a correction of an entry that hasn't gone anywhere yet —
        // once invoiced or written off it stays as the record it is.
        if (!entry || entry.status !== 'unbilled') return;
        d.wipEntries = d.wipEntries.filter((w) => w.id !== entryId);
        ctx.audit('wip.delete', 'wip_entry', entryId, { clientId: entry.clientId, description: entry.description, amount: entry.amount }, undefined);
      });
    },

    logTime(clientId, input) {
      const created: TimeEntry = {
        id: newId('time'),
        practiceId: get().data.practice.id,
        clientId,
        jobId: input.jobId,
        userId: get().currentUserId,
        loggedOn: input.loggedOn ?? get().today,
        minutes: Math.max(1, Math.round(input.minutes)),
        note: input.note?.trim() || undefined,
        createdAt: nowIso(),
      };
      mutate((d, ctx) => {
        const client = d.clients.find((c) => c.id === clientId);
        if (!client) return;
        d.timeEntries.push(created);
        ctx.audit('time.create', 'time_entry', created.id, undefined, { clientId, minutes: created.minutes });
      });
      return created;
    },

    deleteTimeEntry(entryId) {
      mutate((d, ctx) => {
        const entry = d.timeEntries.find((t) => t.id === entryId);
        if (!entry) return;
        d.timeEntries = d.timeEntries.filter((t) => t.id !== entryId);
        ctx.audit('time.delete', 'time_entry', entryId, { clientId: entry.clientId, minutes: entry.minutes }, undefined);
      });
    },

    updateClient(clientId, patch) {
      mutate((d, ctx) => {
        const client = d.clients.find((c) => c.id === clientId);
        if (!client) return;
        const before = { ...client };
        // AML and turnover fields are excluded from this generic patch:
        // they have their own recording actions (recordAmlReview,
        // recordTurnover) that date the change and audit it under its own
        // action name. Letting them through here too would mean the same
        // data could change two ways, one of them unaudited by name — a
        // supervisor pulling "every AML rating change" from the audit log
        // by action type would miss it.
        const safePatch = { ...patch };
        for (const field of COMPLIANCE_ONLY_FIELDS) delete safePatch[field];
        Object.assign(client, safePatch);
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
        const existingNumbers = new Set(d.identifiers.filter((i) => i.kind === 'company_number').map((i) => normaliseCompanyNumber(i.value)));
        const toImport = rows.filter((r) => {
          const key = normaliseCompanyNumber(r.companyNumber);
          if (existingNumbers.has(key)) {
            skipped.push(`${r.name} (${r.companyNumber}) — already on file`);
            return false;
          }
          existingNumbers.add(key);
          return true;
        });
        if (toImport.length === 0) return;
        // Stored in the one canonical spelling, so a later lookup or re-import matches.
        const normalised = toImport.map((r) => ({ ...r, companyNumber: normaliseCompanyNumber(r.companyNumber) }));
        const built = buildImportedClientRecords(normalised, d.practice.id, get().currentUserId, get().today);
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
        // A few names for the log, not the whole roster: this entry is
        // saved with every snapshot from now on.
        ctx.audit('client.import', 'client', 'bulk', undefined, { count: created, names: built.clients.slice(0, 20).map((c) => c.name) });
      });
      return { created, skipped };
    },

    refreshClientFromCompaniesHouse(clientId, profile, people) {
      let outcome: RefreshOutcome = { peopleAdded: 0, verificationsConfirmed: 0 };
      mutate((d, ctx) => {
        outcome = applyCompaniesHouseRefresh(d, ctx, clientId, profile, people);
      });
      return outcome;
    },

    refreshClientsFromCompaniesHouse(updates) {
      let clientsUpdated = 0;
      let peopleAdded = 0;
      let verificationsConfirmed = 0;
      // One mutation for the whole batch: each mutation persists the entire practice
      // snapshot, so applying these one at a time would fire a burst of overlapping
      // whole-document saves that can land out of order and lose each other's writes.
      mutate((d, ctx) => {
        for (const update of updates) {
          if (!d.clients.some((c) => c.id === update.clientId)) continue;
          const outcome = applyCompaniesHouseRefresh(d, ctx, update.clientId, update.profile, update.people);
          peopleAdded += outcome.peopleAdded;
          verificationsConfirmed += outcome.verificationsConfirmed;
          clientsUpdated += 1;
        }
      });
      return { clientsUpdated, peopleAdded, verificationsConfirmed };
    },

    mergeDuplicatePeople() {
      let summary: PeopleMergeSummary = { peopleRemoved: 0, rolesMoved: 0, rolesCombined: 0 };
      if (findDuplicatePeople(get().data).length === 0) return summary;
      mutate((d, ctx) => {
        const groups = findDuplicatePeople(d);
        summary = applyPeopleMerge(d, groups);
        const n = summary.peopleRemoved;
        ctx.activity('client_updated', `${n} duplicate ${n === 1 ? 'person' : 'people'} merged${groups.length > 0 ? ` (${groups.map((g) => normalisePersonName(g.keep.fullName)).join(', ')})` : ''}.`);
        ctx.audit('people.merge', 'person', 'bulk', undefined, {
          ...summary,
          groups: groups.map((g) => ({ kept: g.keep.id, removed: g.duplicates.map((p) => p.id), clientIds: g.clientIds })),
        });
      });
      return summary;
    },
    generateCorporationTaxObligations() {
      let summary: CorporationTaxBackfillSummary = { clientsUpdated: 0, jobsCreated: 0, overdueCreated: 0 };
      const today = nowIso().slice(0, 10);
      if (findMissingCorporationTax(get().data, today).length === 0) return summary;
      mutate((d, ctx) => {
        const rows = findMissingCorporationTax(d, today);
        summary = applyCorporationTaxBackfill(d, rows, newId);
        const n = summary.jobsCreated;
        ctx.activity('note', `Corporation tax added for ${n} ${n === 1 ? 'client' : 'clients'}.`);
        ctx.audit('obligations.corporation_tax', 'job', 'bulk', undefined, {
          ...summary,
          clients: rows.map((r) => ({ clientId: r.clientId, periodEnd: r.periodEnd, dueDate: r.dueDate })),
        });
      });
      return summary;
    },
    updateContact(contactId, patch) {
      mutate((d, ctx) => {
        const contact = d.contacts.find((c) => c.id === contactId);
        if (!contact) return;
        const before = { ...contact };
        // Name and role always hold a value, so a blank one leaves them as they were.
        // Email, phone and WhatsApp are optional, so clearing the field clears the value.
        if (patch.name?.trim()) contact.name = patch.name.trim();
        if (patch.role?.trim()) contact.role = patch.role.trim();
        for (const key of ['email', 'phone', 'whatsapp'] as const) {
          if (key in patch) contact[key] = patch[key]?.trim() || undefined;
        }
        const client = d.clients.find((c) => c.id === contact.clientId);
        ctx.activity('client_updated', `${contact.name}'s contact details updated for ${client?.name}.`, undefined, contact.clientId);
        ctx.audit('contact.update', 'contact', contactId, before, { ...contact });
      });
    },

    addContact(clientId, input) {
      const created: Contact = {
        id: newId('ct'),
        practiceId: get().data.practice.id,
        clientId,
        name: input.name.trim(),
        role: input.role?.trim() || 'Contact',
        email: input.email?.trim() || undefined,
        phone: input.phone?.trim() || undefined,
        whatsapp: input.whatsapp?.trim() || undefined,
        isPrimary: false,
      };
      mutate((d, ctx) => {
        const client = d.clients.find((c) => c.id === clientId);
        if (!client) return;
        const hasPrimary = d.contacts.some((c) => c.clientId === clientId && c.isPrimary);
        created.isPrimary = !hasPrimary;
        d.contacts.push(created);
        if (created.isPrimary) client.primaryContactId = created.id;
        ctx.activity('client_updated', `${created.name} added as a contact for ${client.name}.`, undefined, clientId);
        ctx.audit('contact.create', 'contact', created.id, undefined, { name: created.name, role: created.role });
      });
      return created;
    },

    removeContact(contactId) {
      mutate((d, ctx) => {
        const contact = d.contacts.find((c) => c.id === contactId);
        if (!contact) return;
        const siblings = d.contacts.filter((c) => c.clientId === contact.clientId && c.id !== contactId);
        if (siblings.length === 0) return;
        d.contacts = d.contacts.filter((c) => c.id !== contactId);
        const client = d.clients.find((c) => c.id === contact.clientId);
        // Removing the primary promotes the next contact rather than leaving the client with none.
        if (client && client.primaryContactId === contactId) {
          siblings[0].isPrimary = true;
          client.primaryContactId = siblings[0].id;
        }
        ctx.activity('client_updated', `${contact.name} removed as a contact for ${client?.name}.`, undefined, contact.clientId);
        ctx.audit('contact.delete', 'contact', contactId, { name: contact.name }, undefined);
      });
    },

    setPrimaryContact(clientId, contactId) {
      mutate((d, ctx) => {
        const client = d.clients.find((c) => c.id === clientId);
        const contact = d.contacts.find((c) => c.id === contactId && c.clientId === clientId);
        if (!client || !contact) return;
        for (const c of d.contacts.filter((x) => x.clientId === clientId)) c.isPrimary = c.id === contactId;
        const before = client.primaryContactId;
        client.primaryContactId = contactId;
        ctx.activity('client_updated', `${contact.name} is now the main contact for ${client.name}.`, undefined, clientId);
        ctx.audit('contact.set_primary', 'client', clientId, { primaryContactId: before }, { primaryContactId: contactId });
      });
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
        role.identityVerificationSource = 'practice';
        delete role.identityVerifiedOn;
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

    renameUser(userId, name) {
      mutate((d, ctx) => {
        const user = d.users.find((u) => u.id === userId);
        if (!user || !name.trim()) return;
        const before = user.name;
        user.name = name.trim();
        ctx.activity('note', `${before} renamed to ${user.name}.`);
        ctx.audit('user.rename', 'user', userId, { name: before }, { name: user.name });
      });
    },

    updatePracticeThresholds(patch) {
      const clean = sanitizeThresholdPatch(patch);
      if (Object.keys(clean).length === 0) return;
      mutate((d, ctx) => {
        const before = { ...d.practice.thresholds };
        d.practice.thresholds = { ...d.practice.thresholds, ...clean };
        ctx.activity('note', 'Timing thresholds updated.');
        ctx.audit('practice.thresholds', 'practice', d.practice.id, before, { ...d.practice.thresholds });
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
