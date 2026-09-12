import { useState } from 'react';
import { ShieldCheck, TrendingUp } from 'lucide-react';
import { Card, CardBody, CardHeader } from './Card';
import { Button } from './Button';
import { Badge } from './Badge';
import { Input, Select } from './Form';
import { useAppStore } from '../../application/store';
import { useData, useToday } from '../../application/selectors';
import { AML_RATING_LABELS, AML_REVIEW_MONTHS, amlReviewStatus, formatPounds, VAT_REGISTRATION_THRESHOLD, vatThresholdStatus, type AmlReviewState, type VatThresholdState } from '../../domain/rules';
import { formatDate } from '../../domain/dates';
import type { AmlRiskRating, Client } from '../../domain/types';

const AML_STATE: Record<AmlReviewState, { label: string; tone: 'red' | 'amber' | 'green' | 'neutral' }> = {
  never_reviewed: { label: 'Never reviewed', tone: 'red' },
  overdue: { label: 'Review overdue', tone: 'red' },
  due_soon: { label: 'Review due soon', tone: 'amber' },
  current: { label: 'Current', tone: 'green' },
};

/**
 * The client's AML position and the form to record a review. The
 * regulations want ongoing monitoring with an evidence trail; recording a
 * review here dates it, rates it, and writes the audit entry a supervisor
 * asks for.
 */
export function AmlReviewCard({ client }: { client: Client }) {
  const today = useToday();
  const record = useAppStore((s) => s.recordAmlReview);
  const toast = useAppStore((s) => s.toast);
  const status = amlReviewStatus(client, today);
  const [rating, setRating] = useState<AmlRiskRating>(client.amlRiskRating ?? 'standard');
  const [note, setNote] = useState('');
  const [open, setOpen] = useState(false);
  const state = AML_STATE[status.state];

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    record(client.id, { rating, note });
    setNote('');
    setOpen(false);
    toast({ title: 'AML review recorded', description: `${AML_RATING_LABELS[rating]} — next review in ${AML_REVIEW_MONTHS[rating]} months.`, tone: 'success' });
  };

  return (
    <Card data-testid="aml-review-card">
      <CardHeader
        title="AML review"
        icon={<ShieldCheck />}
        description={
          status.state === 'never_reviewed'
            ? 'No risk rating on file. The regulations expect one, and periodic re-review after it.'
            : `${AML_RATING_LABELS[status.rating!]} · last reviewed ${formatDate(status.lastReviewedOn!, { year: true })} · next due ${formatDate(status.nextDueOn!, { year: true })}`
        }
        action={<Badge tone={state.tone} dot>{state.label}</Badge>}
      />
      <CardBody className="pt-0">
        {client.amlReviewNote && !open && <p className="text-[13px] text-slate-600 mb-2">“{client.amlReviewNote}”</p>}
        {open ? (
          <form onSubmit={submit} noValidate className="space-y-2">
            <Select value={rating} onChange={(e) => setRating(e.target.value as AmlRiskRating)} aria-label="Risk rating" data-testid="aml-rating">
              {(Object.keys(AML_RATING_LABELS) as AmlRiskRating[]).map((r) => (
                <option key={r} value={r}>
                  {AML_RATING_LABELS[r]} — review every {AML_REVIEW_MONTHS[r]} months
                </option>
              ))}
            </Select>
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Basis for the rating (optional)" aria-label="Review note" data-testid="aml-note" />
            <div className="flex gap-2">
              <Button type="submit" size="sm" data-testid="aml-record">
                Record review
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <Button size="sm" variant="secondary" onClick={() => setOpen(true)} data-testid="aml-open">
            {status.state === 'never_reviewed' ? 'Record first review' : 'Record a review'}
          </Button>
        )}
      </CardBody>
    </Card>
  );
}

const VAT_STATE: Record<VatThresholdState, { label: string; tone: 'red' | 'amber' | 'green' | 'neutral' }> = {
  registered: { label: 'VAT registered', tone: 'neutral' },
  no_figure: { label: 'No turnover on file', tone: 'neutral' },
  clear: { label: 'Clear of the threshold', tone: 'green' },
  approaching: { label: 'Approaching threshold', tone: 'amber' },
  over: { label: 'Over the threshold', tone: 'red' },
};

/**
 * Rolling twelve-month turnover against the VAT registration threshold.
 * Entered by hand until a bookkeeping integration exists, and dated so a
 * stale figure reads as stale rather than reassuring.
 */
export function TurnoverCard({ client }: { client: Client }) {
  const data = useData();
  const today = useToday();
  const record = useAppStore((s) => s.recordTurnover);
  const toast = useAppStore((s) => s.toast);
  const status = vatThresholdStatus(client, data.identifiers, today);
  const [value, setValue] = useState(client.rolling12MonthTurnover?.toString() ?? '');
  const state = VAT_STATE[status.state];

  if (status.state === 'registered') return null;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const amount = value.trim() === '' ? null : Number(value.replace(/[£,\s]/g, ''));
    if (amount !== null && (!Number.isFinite(amount) || amount < 0)) {
      toast({ title: 'Enter a turnover in pounds', tone: 'error' });
      return;
    }
    record(client.id, amount);
    toast({ title: amount === null ? 'Turnover cleared' : 'Turnover recorded', description: amount === null ? undefined : `${formatPounds(Math.round(amount))} in the last twelve months.`, tone: 'success' });
  };

  return (
    <Card data-testid="turnover-card">
      <CardHeader
        title="VAT threshold watch"
        icon={<TrendingUp />}
        description={
          status.state === 'no_figure'
            ? `Not VAT registered. Record rolling twelve-month turnover to watch the ${formatPounds(VAT_REGISTRATION_THRESHOLD)} threshold.`
            : `${formatPounds(status.turnover!)} in the last twelve months · ${status.headroom! >= 0 ? `${formatPounds(status.headroom!)} below` : `${formatPounds(-status.headroom!)} over`} the ${formatPounds(VAT_REGISTRATION_THRESHOLD)} threshold${status.stale ? ` · recorded ${status.recordedOn ? formatDate(status.recordedOn, { year: true }) : 'undated'}, worth refreshing` : ''}`
        }
        action={<Badge tone={state.tone} dot>{state.label}</Badge>}
      />
      <CardBody className="pt-0">
        {status.state === 'over' && <p className="text-[13px] text-red-700 mb-2">Must register: turnover has passed the threshold, and registration is due within 30 days of the month it happened.</p>}
        <form onSubmit={submit} noValidate className="flex gap-2">
          <Input value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" placeholder="Turnover, last 12 months (£)" aria-label="Rolling twelve-month turnover" data-testid="turnover-input" />
          <Button type="submit" size="md" data-testid="turnover-save">
            Save
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}
