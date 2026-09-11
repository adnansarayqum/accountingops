import type {
  Channel,
  ClientType,
  Id,
  IdentifierKind,
  JobStatus,
  OnboardingStage,
  ReminderSequence,
  ResponsivenessBand,
  Service,
  ServiceCode,
  WaitingOn,
} from './types';

export const SERVICES: Record<ServiceCode, Service> = {
  annual_accounts: {
    code: 'annual_accounts',
    name: 'Annual Accounts',
    shortName: 'Accounts',
    frequency: 'annual',
    defaultRequirements: ['Bank statements', 'Sales invoices', 'Purchase invoices', 'Payroll records', 'Loan statement', 'Director expenses'],
    defaultEstimatedHours: 12,
    reminderSequenceId: 'seq_accounts',
  },
  corporation_tax: {
    code: 'corporation_tax',
    name: 'Corporation Tax',
    shortName: 'CT600',
    frequency: 'annual',
    defaultRequirements: ['Approved accounts', 'Capital allowances schedule', 'R&D summary'],
    defaultEstimatedHours: 4,
    reminderSequenceId: 'seq_accounts',
  },
  vat: {
    code: 'vat',
    name: 'VAT Return',
    shortName: 'VAT',
    frequency: 'quarterly',
    defaultRequirements: ['Sales invoices', 'Purchase invoices', 'Bank statements'],
    defaultEstimatedHours: 3,
    reminderSequenceId: 'seq_vat',
  },
  payroll: {
    code: 'payroll',
    name: 'Payroll',
    shortName: 'Payroll',
    frequency: 'monthly',
    defaultRequirements: ['Timesheets', 'Starter/leaver forms'],
    defaultEstimatedHours: 3,
    reminderSequenceId: 'seq_payroll',
  },
  self_assessment: {
    code: 'self_assessment',
    name: 'Self Assessment',
    shortName: 'SA',
    frequency: 'annual',
    defaultRequirements: ['P60 / P45', 'Dividend vouchers', 'Bank interest', 'Rental income schedule', 'Pension contributions'],
    defaultEstimatedHours: 5,
    reminderSequenceId: 'seq_sa',
  },
  confirmation_statement: {
    code: 'confirmation_statement',
    name: 'Confirmation Statement',
    shortName: 'CS01',
    frequency: 'annual',
    defaultRequirements: ['Director confirmation', 'PSC confirmation', 'Registered office check'],
    defaultEstimatedHours: 1,
    reminderSequenceId: 'seq_cs',
  },
  mtd_income_tax: {
    code: 'mtd_income_tax',
    name: 'MTD Income Tax',
    shortName: 'MTD IT',
    frequency: 'quarterly',
    defaultRequirements: ['Income summary', 'Expense summary', 'Bank statements'],
    defaultEstimatedHours: 2,
    reminderSequenceId: 'seq_vat',
  },
  bookkeeping_review: {
    code: 'bookkeeping_review',
    name: 'Bookkeeping Review',
    shortName: 'Bookkeeping',
    frequency: 'monthly',
    defaultRequirements: ['Bank statements', 'Receipts bundle'],
    defaultEstimatedHours: 2,
    reminderSequenceId: 'seq_payroll',
  },
};

export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  waiting_for_records: 'Waiting for records',
  ready_to_start: 'Ready to start',
  in_progress: 'In progress',
  internal_review: 'Internal review',
  waiting_client_approval: 'Waiting for client approval',
  ready_to_file: 'Ready to file',
  filed: 'Filed',
};

export const JOB_STATUS_ORDER: JobStatus[] = [
  'waiting_for_records',
  'ready_to_start',
  'in_progress',
  'internal_review',
  'waiting_client_approval',
  'ready_to_file',
  'filed',
];

export const WAITING_ON_LABELS: Record<WaitingOn, string> = {
  client: 'Client',
  accountant: 'Accountant',
  senior_review: 'Senior review',
  hmrc: 'HMRC',
  companies_house: 'Companies House',
  approval: 'Approval',
  payment: 'Payment',
  nothing: 'Nothing — ready',
};

export const CLIENT_TYPE_LABELS: Record<ClientType, string> = {
  limited_company: 'Limited company',
  sole_trader: 'Sole trader',
  landlord: 'Landlord',
  partnership: 'Partnership',
  individual: 'Individual',
};

export const IDENTIFIER_LABELS: Record<IdentifierKind, string> = {
  utr: 'UTR',
  nino: 'National Insurance number',
  company_number: 'Company number',
  vat_number: 'VAT number',
  paye_reference: 'PAYE reference',
  accounts_office_ref: 'Accounts Office reference',
  ch_auth_code: 'Companies House authentication code',
  personal_code: 'Personal code',
  gateway_credentials: 'Government Gateway credentials',
};

export const CHANNEL_LABELS: Record<Channel, string> = {
  email: 'Email',
  whatsapp: 'WhatsApp',
  sms: 'SMS',
  phone: 'Phone',
  portal: 'Portal',
};

export const RESPONSIVENESS_LABELS: Record<ResponsivenessBand, string> = {
  fast: 'Fast responder',
  normal: 'Normal responder',
  slow: 'Slow responder',
  chronic: 'Chronic chaser',
};

export const ONBOARDING_STAGES: { key: OnboardingStage; label: string }[] = [
  { key: 'lead', label: 'Lead' },
  { key: 'details_requested', label: 'Details requested' },
  { key: 'identity_aml', label: 'Identity / AML' },
  { key: 'hmrc_ch_details', label: 'HMRC / Companies House' },
  { key: 'services', label: 'Services' },
  { key: 'engagement', label: 'Engagement' },
  { key: 'active', label: 'Active' },
];

export const FILING_DESTINATION: Partial<Record<ServiceCode, 'HMRC' | 'Companies House'>> = {
  annual_accounts: 'Companies House',
  corporation_tax: 'HMRC',
  vat: 'HMRC',
  payroll: 'HMRC',
  self_assessment: 'HMRC',
  confirmation_statement: 'Companies House',
  mtd_income_tax: 'HMRC',
};

/**
 * Standard chasing-sequence templates, one per service family. Every
 * practice starts with these — they are reference configuration, not
 * client- or practice-specific data, so a brand-new (empty) practice gets
 * a working Chasing screen from day one.
 */
export function buildReminderSequences(practiceId: Id): ReminderSequence[] {
  return [
    {
      id: 'seq_accounts',
      practiceId,
      name: 'Annual Accounts Standard Sequence',
      steps: [
        { daysBeforeDue: 90, channels: ['email'], tone: 'friendly', label: 'Friendly email (90 days)' },
        { daysBeforeDue: 30, channels: ['email'], tone: 'standard', label: 'Email (30 days)' },
        { daysBeforeDue: 14, channels: ['email', 'whatsapp'], tone: 'firm', label: 'Email + WhatsApp (14 days)' },
        { daysBeforeDue: 3, channels: ['whatsapp', 'sms'], tone: 'urgent', label: 'Urgent reminder (3 days)' },
      ],
    },
    {
      id: 'seq_vat',
      practiceId,
      name: 'Quarterly Return Sequence',
      steps: [
        { daysBeforeDue: 21, channels: ['email'], tone: 'friendly', label: 'Friendly email (21 days)' },
        { daysBeforeDue: 10, channels: ['email', 'whatsapp'], tone: 'standard', label: 'Email + WhatsApp (10 days)' },
        { daysBeforeDue: 3, channels: ['whatsapp', 'sms'], tone: 'urgent', label: 'Urgent reminder (3 days)' },
      ],
    },
    {
      id: 'seq_payroll',
      practiceId,
      name: 'Monthly Sequence',
      steps: [
        { daysBeforeDue: 7, channels: ['email'], tone: 'friendly', label: 'Email (7 days)' },
        { daysBeforeDue: 2, channels: ['whatsapp', 'sms'], tone: 'urgent', label: 'Urgent reminder (2 days)' },
      ],
    },
    {
      id: 'seq_sa',
      practiceId,
      name: 'Self Assessment Sequence',
      steps: [
        { daysBeforeDue: 120, channels: ['email'], tone: 'friendly', label: 'Friendly email (120 days)' },
        { daysBeforeDue: 60, channels: ['email'], tone: 'standard', label: 'Email (60 days)' },
        { daysBeforeDue: 21, channels: ['email', 'whatsapp'], tone: 'firm', label: 'Email + WhatsApp (21 days)' },
        { daysBeforeDue: 5, channels: ['whatsapp', 'sms'], tone: 'urgent', label: 'Urgent reminder (5 days)' },
      ],
    },
    {
      id: 'seq_cs',
      practiceId,
      name: 'Confirmation Statement Sequence',
      steps: [
        { daysBeforeDue: 30, channels: ['email'], tone: 'friendly', label: 'Email (30 days)' },
        { daysBeforeDue: 7, channels: ['email', 'whatsapp'], tone: 'firm', label: 'Email + WhatsApp (7 days)' },
      ],
    },
  ];
}
