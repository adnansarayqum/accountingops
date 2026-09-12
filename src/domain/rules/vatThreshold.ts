import type { Client, ClientIdentifier, IsoDate } from '../types';

/**
 * VAT registration threshold watch.
 *
 * A business must register for VAT once its taxable turnover for the last
 * twelve months goes over the threshold, or when it expects to go over it
 * in the next thirty days (gov.uk/vat-registration/when-to-register,
 * checked 12 Sep 2026: £90,000). Spotting a client approaching that line
 * *before* they cross it is advisory work clients pay for — and missing
 * it means a late-registration penalty and back-dated VAT they never
 * charged.
 *
 * Turnover isn't something this app can know on its own until a
 * bookkeeping integration exists, so it is recorded by hand on the client
 * (with the date it was recorded, so a stale figure reads as stale). The
 * rule only ever watches clients with no VAT number on file: a registered
 * client has nothing to approach.
 */

export const VAT_REGISTRATION_THRESHOLD = 90_000;

/** Flag from this share of the threshold — far enough out to plan, close enough to matter. */
export const VAT_APPROACHING_SHARE = 0.85;

/** A turnover figure older than this is shown as stale rather than trusted. */
export const TURNOVER_STALE_DAYS = 120;

export type VatThresholdState = 'registered' | 'no_figure' | 'clear' | 'approaching' | 'over';

export interface VatThresholdStatus {
  clientId: string;
  state: VatThresholdState;
  turnover: number | null;
  recordedOn: IsoDate | null;
  /** How much of the threshold the recorded turnover is, 0–1+; null without a figure. */
  share: number | null;
  /** Pounds of headroom left; negative once over. */
  headroom: number | null;
  stale: boolean;
}

function daysBetween(from: IsoDate, to: IsoDate): number {
  const a = Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 1, Number(from.slice(8, 10)));
  const b = Date.UTC(Number(to.slice(0, 4)), Number(to.slice(5, 7)) - 1, Number(to.slice(8, 10)));
  return Math.round((b - a) / 86_400_000);
}

export function vatThresholdStatus(client: Client, identifiers: ClientIdentifier[], today: IsoDate): VatThresholdStatus {
  const registered = identifiers.some((i) => i.clientId === client.id && i.kind === 'vat_number' && i.value.trim() !== '');
  const base = { clientId: client.id, turnover: client.rolling12MonthTurnover ?? null, recordedOn: client.turnoverRecordedOn ?? null };
  if (registered) return { ...base, state: 'registered', share: null, headroom: null, stale: false };
  const turnover = client.rolling12MonthTurnover;
  if (typeof turnover !== 'number' || !Number.isFinite(turnover) || turnover < 0) return { ...base, state: 'no_figure', share: null, headroom: null, stale: false };
  const share = turnover / VAT_REGISTRATION_THRESHOLD;
  const stale = client.turnoverRecordedOn ? daysBetween(client.turnoverRecordedOn, today) > TURNOVER_STALE_DAYS : true;
  return {
    ...base,
    state: share >= 1 ? 'over' : share >= VAT_APPROACHING_SHARE ? 'approaching' : 'clear',
    share,
    headroom: VAT_REGISTRATION_THRESHOLD - turnover,
    stale,
  };
}

export interface VatThresholdSummary {
  over: VatThresholdStatus[];
  approaching: VatThresholdStatus[];
  /** Unregistered clients with no turnover on file — the watch can't see them. */
  noFigure: number;
  clear: number;
  registered: number;
}

/** Every active client's position; the ones over first, then closest to the line. */
export function vatThresholdSummary(clients: Client[], identifiers: ClientIdentifier[], today: IsoDate): VatThresholdSummary {
  const statuses = clients.filter((c) => c.lifecycle !== 'ceased').map((c) => vatThresholdStatus(c, identifiers, today));
  const byShare = (a: VatThresholdStatus, b: VatThresholdStatus) => (b.share ?? 0) - (a.share ?? 0);
  return {
    over: statuses.filter((s) => s.state === 'over').sort(byShare),
    approaching: statuses.filter((s) => s.state === 'approaching').sort(byShare),
    noFigure: statuses.filter((s) => s.state === 'no_figure').length,
    clear: statuses.filter((s) => s.state === 'clear').length,
    registered: statuses.filter((s) => s.state === 'registered').length,
  };
}
