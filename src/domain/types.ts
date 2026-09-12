/**
 * Domain model for the Accountancy Operations Command Centre.
 *
 * Every tenant-owned record carries `practiceId`. This build runs a single
 * practice, but the shape is multi-tenant from day one so that server-side
 * persistence can scope every query by tenant.
 *
 * Dates are ISO strings: `IsoDate` = YYYY-MM-DD, `IsoDateTime` = full ISO 8601.
 */

export type Id = string;
export type IsoDate = string;
export type IsoDateTime = string;

// ---------------------------------------------------------------------------
// Practice & users
// ---------------------------------------------------------------------------

export interface Practice {
  id: Id;
  name: string;
  timezone: string;
  /**
   * Configurable timing thresholds for Needs Attention and the dashboard's
   * "Due soon" view. Optional, and every field within it optional too — a
   * practice that has never touched Settings → Timing thresholds has no
   * object here at all, and one that has only ever changed some fields has
   * the rest missing; `domain/rules/thresholds.ts`'s `resolveThresholds()`
   * fills in the same defaults every rule used before this existed.
   */
  thresholds?: Partial<PracticeThresholds>;
}

/**
 * Every value is a count of days. See `domain/rules/thresholds.ts` for the
 * defaults and `domain/rules/attention.ts` for how each one is used.
 */
export interface PracticeThresholds {
  /** How far ahead of a job's deadline counts as "due soon" on the dashboard. */
  dueSoonDays: number;
  /** How far ahead of a confirmation statement's deadline an unverified director or PSC gets flagged. */
  identityVerificationWindowDays: number;
  /** How long a job can sit with no status change before it's flagged as stale. */
  staleJobDays: number;
  /** How long a job can sit in internal review with no reviewer assigned before it's flagged. */
  reviewWaitDays: number;
  /** How long a job can wait for client approval before it's flagged. */
  approvalWaitDays: number;
}

export type UserRole = 'owner' | 'manager' | 'accountant' | 'admin';

export interface User {
  id: Id;
  practiceId: Id;
  name: string;
  initials: string;
  role: UserRole;
  weeklyCapacityHours: number;
  colour: string; // tailwind colour token used for avatars
}

// ---------------------------------------------------------------------------
// Clients, contacts, identifiers, people
// ---------------------------------------------------------------------------

export type ClientType = 'limited_company' | 'sole_trader' | 'landlord' | 'partnership' | 'individual';

export type ResponsivenessBand = 'fast' | 'normal' | 'slow' | 'chronic';

export type Channel = 'email' | 'whatsapp' | 'sms' | 'phone' | 'portal';

export type ClientLifecycle = 'onboarding' | 'active' | 'dormant' | 'ceased';

export interface Client {
  id: Id;
  practiceId: Id;
  name: string;
  type: ClientType;
  lifecycle: ClientLifecycle;
  ownerUserId: Id;
  backupOwnerUserId?: Id;
  primaryContactId: Id;
  preferredChannel: Channel;
  yearEnd?: string; // e.g. "31 March"
  incorporatedOn?: IsoDate;
  sector?: string;
  notes?: string;
  /** Behaviour stat used by the responsiveness rule. */
  averageResponseDays: number;
  createdAt: IsoDateTime;
  /** Populated when the client was looked up via the Companies House integration. */
  registeredOffice?: RegisteredAddress;
  companiesHouseStatus?: string;
  sicCodes?: string[];
  /** Names this company has previously traded under, most recent first. */
  previousNames?: string[];
  /** When the Companies House fields above were last pulled. Absent means never — the client came from a spreadsheet or was typed in by hand. */
  companiesHouseSyncedAt?: IsoDateTime;
}

/** A UK registered office address, as returned by Companies House. */
export interface RegisteredAddress {
  premises?: string;
  addressLine1?: string;
  addressLine2?: string;
  locality?: string;
  region?: string;
  postalCode?: string;
  country?: string;
  /** Single-line rendering for display. */
  formatted: string;
}

export interface Contact {
  id: Id;
  practiceId: Id;
  clientId: Id;
  name: string;
  role: string;
  email?: string;
  phone?: string;
  whatsapp?: string;
  isPrimary: boolean;
}

export type IdentifierKind = 'utr' | 'nino' | 'company_number' | 'vat_number' | 'paye_reference' | 'accounts_office_ref' | 'ch_auth_code' | 'personal_code' | 'gateway_credentials';

export interface ClientIdentifier {
  id: Id;
  practiceId: Id;
  clientId: Id;
  kind: IdentifierKind;
  /** Synthetic demo value. In production this is encrypted at rest and revealed with audit. */
  value: string;
  /** Whether this identifier is sensitive and should be masked by default. */
  sensitive: boolean;
}

/** People are directors, PSCs, partners or individuals linked to a client. */
export interface Person {
  id: Id;
  practiceId: Id;
  fullName: string;
  dateOfBirth?: IsoDate;
  /** "1980-05" — the month and year Companies House publishes (never the day). Used to tell two people with the same name apart. */
  birthMonthYear?: string;
  email?: string;
}

export type PersonRoleKind = 'director' | 'psc' | 'partner' | 'proprietor';
export type IdentityVerificationStatus = 'verified' | 'in_progress' | 'not_started' | 'expired';

export interface CompaniesHouseVerification {
  checkedAt: IsoDateTime;
  /** Verified on this date (by an authorised agent, or an appointment verification statement in force); null when Companies House shows no verification. */
  verifiedOn: IsoDate | null;
  /** The date by which Companies House expects a verification statement for this appointment, when it has set one. */
  dueOn: IsoDate | null;
}

export interface PersonRole {
  id: Id;
  practiceId: Id;
  personId: Id;
  clientId: Id;
  kind: PersonRoleKind;
  identityVerification: IdentityVerificationStatus;
  /** Who last set `identityVerification`: the practice by hand, or a Companies House refresh that found them verified. */
  identityVerificationSource?: 'practice' | 'companies_house';
  /** The date Companies House records the verification against, when it was confirmed from there. */
  identityVerifiedOn?: IsoDate;
  /** What Companies House last published about this role's verification, recorded on every refresh — including that it published nothing. */
  companiesHouseVerification?: CompaniesHouseVerification;
  personalCodeCaptured: boolean;
  evidenceStatus: 'none' | 'requested' | 'received' | 'checked';
  /** How control is held — only ever populated for a 'psc' role, from Companies House. */
  naturesOfControl?: string[];
}

// ---------------------------------------------------------------------------
// Services, subscriptions, obligations
// ---------------------------------------------------------------------------

export type ServiceCode =
  | 'annual_accounts'
  | 'corporation_tax'
  | 'vat'
  | 'payroll'
  | 'self_assessment'
  | 'confirmation_statement'
  | 'mtd_income_tax'
  | 'bookkeeping_review';

export interface Service {
  code: ServiceCode;
  name: string;
  shortName: string;
  frequency: RecurrenceFrequency;
  /** Default document requirements created on each job. */
  defaultRequirements: string[];
  defaultEstimatedHours: number;
  reminderSequenceId: Id;
}

export type RecurrenceFrequency = 'annual' | 'quarterly' | 'monthly' | 'none';

export interface ServiceSubscription {
  id: Id;
  practiceId: Id;
  clientId: Id;
  serviceCode: ServiceCode;
  startedOn: IsoDate;
  active: boolean;
}

/**
 * An obligation is the recurring statutory or contractual requirement
 * (e.g. "Quarterly VAT return"). Jobs are the concrete instances.
 */
export interface Obligation {
  id: Id;
  practiceId: Id;
  clientId: Id;
  serviceCode: ServiceCode;
  name: string;
  frequency: RecurrenceFrequency;
  /** Period end of the most recently generated job. Used for deterministic next-period generation. */
  lastPeriodEnd: IsoDate;
  /** Days between period end and statutory due date. Demo approximation of statutory rules. */
  dueOffsetDays: number;
  /** Days between period start and period end for non-annual obligations. */
  periodLengthMonths: number;
}

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

export type JobStatus =
  | 'waiting_for_records'
  | 'ready_to_start'
  | 'in_progress'
  | 'internal_review'
  | 'waiting_client_approval'
  | 'ready_to_file'
  | 'filed';

export type WaitingOn =
  | 'client'
  | 'accountant'
  | 'senior_review'
  | 'hmrc'
  | 'companies_house'
  | 'approval'
  | 'payment'
  | 'nothing';

export interface Job {
  id: Id;
  practiceId: Id;
  clientId: Id;
  obligationId?: Id;
  serviceCode: ServiceCode;
  name: string;
  periodKey: string; // e.g. "2026" or "2026-Q3"
  periodStart: IsoDate;
  periodEnd: IsoDate;
  dueDate: IsoDate;
  status: JobStatus;
  waitingOn: WaitingOn;
  assigneeUserId?: Id;
  reviewerUserId?: Id;
  estimatedHours: number;
  statusChangedAt: IsoDateTime;
  createdAt: IsoDateTime;
  /** Set when the job is filed. */
  filedAt?: IsoDateTime;
  /** Set when chasing is suspended by an accountant. */
  chasingPaused?: boolean;
  nextActionOverride?: string;
}

// ---------------------------------------------------------------------------
// Information requests & documents
// ---------------------------------------------------------------------------

export type RequestItemStatus = 'missing' | 'requested' | 'received';

export interface InformationRequestItem {
  id: Id;
  practiceId: Id;
  jobId: Id;
  clientId: Id;
  label: string;
  documentType: string;
  status: RequestItemStatus;
  requestedAt?: IsoDateTime;
  receivedAt?: IsoDateTime;
  documentId?: Id;
  required: boolean;
}

export interface Document {
  id: Id;
  practiceId: Id;
  clientId: Id;
  jobId?: Id;
  fileName: string;
  documentType: string;
  receivedAt: IsoDateTime;
  source: 'inbox' | 'upload' | 'email' | 'portal';
  sizeKb: number;
  /** Set when the file itself is held by the server (a client portal upload) and can be downloaded from /api/portal/uploads/:id. */
  portalUploadId?: Id;
}

// ---------------------------------------------------------------------------
// Communications & reminders
// ---------------------------------------------------------------------------

export type CommunicationDirection = 'outbound' | 'inbound';

export interface Communication {
  id: Id;
  practiceId: Id;
  clientId: Id;
  jobId?: Id;
  direction: CommunicationDirection;
  channel: Channel;
  recipient: string;
  subject?: string;
  body: string;
  sentAt: IsoDateTime;
  sentByUserId?: Id;
  reminderStage?: string;
  documentsRequested?: string[];
  responseStatus: 'awaiting' | 'responded' | 'n/a';
  /** True when nothing left the app. Kept alongside deliveryStatus for older records. */
  simulated: boolean;
  /** How it was delivered: really sent by a provider, handed to the accountant's own app (WhatsApp), or simulated. Absent on older records (= simulated). */
  deliveryStatus?: 'sent' | 'handed_off' | 'simulated';
  providerName?: string;
  providerMessageId?: string;
}

export interface ReminderStep {
  daysBeforeDue: number;
  channels: Channel[];
  tone: 'friendly' | 'standard' | 'firm' | 'urgent';
  label: string;
}

export interface ReminderSequence {
  id: Id;
  practiceId: Id;
  name: string;
  steps: ReminderStep[];
}

// ---------------------------------------------------------------------------
// Approvals & filing
// ---------------------------------------------------------------------------

export type ApprovalKind = 'internal' | 'client';

export interface Approval {
  id: Id;
  practiceId: Id;
  jobId: Id;
  kind: ApprovalKind;
  status: 'pending' | 'approved' | 'rejected';
  requestedAt: IsoDateTime;
  decidedAt?: IsoDateTime;
  reviewerName?: string;
  note?: string;
}

export interface FilingRecord {
  id: Id;
  practiceId: Id;
  jobId: Id;
  filedAt: IsoDateTime;
  filedByUserId: Id;
  submissionReference: string;
  destination: 'HMRC' | 'Companies House';
  evidenceStatus: 'simulated' | 'pending' | 'stored';
  simulated: true;
}

// ---------------------------------------------------------------------------
// Activity, audit, inbox, notifications
// ---------------------------------------------------------------------------

export type ActivityKind =
  | 'document_received'
  | 'reminder_sent'
  | 'job_reassigned'
  | 'status_changed'
  | 'approval_recorded'
  | 'job_filed'
  | 'job_generated'
  | 'client_updated'
  | 'client_created'
  | 'inbox_processed'
  | 'onboarding_updated'
  | 'note';

export interface Activity {
  id: Id;
  practiceId: Id;
  kind: ActivityKind;
  message: string;
  clientId?: Id;
  jobId?: Id;
  actorUserId?: Id;
  occurredAt: IsoDateTime;
}

export interface AuditEvent {
  id: Id;
  practiceId: Id;
  actorUserId?: Id;
  action: string;
  entityType: string;
  entityId: Id;
  before?: unknown;
  after?: unknown;
  occurredAt: IsoDateTime;
  source: 'ui' | 'system' | 'api';
  correlationId: string;
}

export type InboxItemStatus = 'pending' | 'confirmed' | 'dismissed';

export interface InboxSuggestion {
  clientId?: Id;
  jobId?: Id;
  documentType: string;
  period?: string;
  extractedReference?: string;
  extractedDate?: IsoDate;
  confidence: number; // 0..1
  rationale: string;
}

export interface InboxItem {
  id: Id;
  practiceId: Id;
  fileName: string;
  receivedAt: IsoDateTime;
  source: 'email' | 'portal' | 'scan';
  sender?: string;
  sizeKb: number;
  suggestion: InboxSuggestion;
  status: InboxItemStatus;
  resolvedAt?: IsoDateTime;
  /** Item is only shown once the demo scenario reaches a given step. */
  hidden?: boolean;
}

export interface Notification {
  id: Id;
  practiceId: Id;
  userId?: Id;
  title: string;
  body: string;
  kind: 'document' | 'job' | 'deadline' | 'client' | 'approval';
  clientId?: Id;
  jobId?: Id;
  createdAt: IsoDateTime;
  read: boolean;
}

// ---------------------------------------------------------------------------
// Onboarding
// ---------------------------------------------------------------------------

export type OnboardingStage =
  | 'lead'
  | 'details_requested'
  | 'identity_aml'
  | 'hmrc_ch_details'
  | 'services'
  | 'engagement'
  | 'active';

export interface OnboardingChecklistItem {
  key: string;
  label: string;
  done: boolean;
  stage: OnboardingStage;
}

export interface OnboardingCase {
  id: Id;
  practiceId: Id;
  clientId: Id;
  stage: OnboardingStage;
  startedAt: IsoDateTime;
  checklist: OnboardingChecklistItem[];
}

// ---------------------------------------------------------------------------
// Readiness
// ---------------------------------------------------------------------------

export type MtdStatus = 'ready' | 'action_needed' | 'not_yet_required' | 'review';

export interface MtdReadiness {
  id: Id;
  practiceId: Id;
  clientId: Id;
  incomeBand: 'under_20k' | '20k_30k' | '30k_50k' | 'over_50k';
  startYear: string;
  signedUp: boolean;
  softwareReady: boolean;
  agentAuthorised: boolean;
  accountingBasis: 'cash' | 'accruals';
  nextQuarterlyDue?: IsoDate;
}

// ---------------------------------------------------------------------------
// Aggregate state (the shape persisted by the repository)
// ---------------------------------------------------------------------------

export interface PracticeData {
  practice: Practice;
  users: User[];
  clients: Client[];
  contacts: Contact[];
  identifiers: ClientIdentifier[];
  people: Person[];
  personRoles: PersonRole[];
  subscriptions: ServiceSubscription[];
  obligations: Obligation[];
  jobs: Job[];
  requestItems: InformationRequestItem[];
  documents: Document[];
  communications: Communication[];
  reminderSequences: ReminderSequence[];
  approvals: Approval[];
  filings: FilingRecord[];
  activities: Activity[];
  auditEvents: AuditEvent[];
  inboxItems: InboxItem[];
  notifications: Notification[];
  onboardingCases: OnboardingCase[];
  mtdReadiness: MtdReadiness[];
}
