import { useMemo } from 'react';
import { Receipt } from 'lucide-react';
import { Card, CardBody, CardHeader } from './Card';
import { Button } from './Button';
import { useAppStore } from '../../application/store';
import { useData } from '../../application/selectors';
import { findMissingCorporationTax } from '../../domain/corporationTax';
import { formatDate, todayIso } from '../../domain/dates';

/**
 * Corporation tax work a client roster import never created. A spreadsheet
 * roster carries accounts and confirmation statement dates but no CT600
 * date, so limited companies imported that way have no corporation tax on
 * file at all — nothing in the pipeline, and an empty tile on the dashboard.
 *
 * The deadline is derivable from the accounting period end already on file
 * (12 months after it), so this lists exactly what it would create, deadline
 * by deadline, and creates it only on confirmation as one ordinary saved
 * change.
 */
export function CorporationTaxCard() {
  const data = useData();
  const authMode = useAppStore((s) => s.authMode);
  const generate = useAppStore((s) => s.generateCorporationTaxObligations);
  const toast = useAppStore((s) => s.toast);
  const today = todayIso();
  const missing = useMemo(() => findMissingCorporationTax(data, today), [data, today]);
  const overdue = missing.filter((m) => m.alreadyOverdue).length;

  const run = () => {
    const undo = authMode === 'server' ? ' This is saved as a new version, so it can be undone from Version history.' : '';
    const warn = overdue > 0 ? ` ${overdue} of them ${overdue === 1 ? 'is' : 'are'} already past the filing deadline and will show as overdue.` : '';
    if (!window.confirm(`Create corporation tax for ${missing.length} ${missing.length === 1 ? 'client' : 'clients'}?${warn}${undo}`)) return;
    const result = generate();
    toast({
      title: 'Corporation tax added',
      description: `${result.jobsCreated} CT600 ${result.jobsCreated === 1 ? 'job' : 'jobs'} created${result.overdueCreated > 0 ? `, ${result.overdueCreated} already overdue` : ''}.`,
      tone: 'success',
    });
  };

  return (
    <Card data-testid="corporation-tax-backfill">
      <CardHeader
        title="Corporation tax"
        icon={<Receipt />}
        description="Limited companies with an accounting period on file but no CT600 work. The return is due 12 months after the period end; the tax itself is payable 9 months and a day after it."
        action={
          missing.length > 0 ? (
            <Button size="sm" icon={<Receipt />} onClick={run} data-testid="generate-corporation-tax">
              Create for {missing.length} client{missing.length === 1 ? '' : 's'}
            </Button>
          ) : undefined
        }
      />
      <CardBody className="pt-0">
        {missing.length === 0 ? (
          <p className="text-[13px] text-slate-500">Every limited company with an accounting period already has corporation tax on file.</p>
        ) : (
          <>
            {overdue > 0 && (
              <p className="text-[13px] text-amber-700 mb-2" data-testid="corporation-tax-overdue-warning">
                {overdue} of these {overdue === 1 ? 'is' : 'are'} already past the filing deadline — creating them puts {overdue === 1 ? 'it' : 'them'} straight into the overdue count. Check {overdue === 1 ? 'it has' : 'they have'} not already been filed.
              </p>
            )}
            <ul className="divide-y divide-slate-100">
              {missing.map((m) => (
                <li key={m.clientId} className="py-2" data-testid={`corporation-tax-row-${m.clientId}`}>
                  <p className="text-[13px] font-medium text-slate-900">
                    {m.clientName}
                    <span className="ml-2 text-xs font-normal text-slate-500">period ending {formatDate(m.periodEnd, { year: true })}</span>
                  </p>
                  <p className="text-xs text-slate-500">
                    CT600 due {formatDate(m.dueDate, { year: true })} · tax payable {formatDate(m.paymentDue, { year: true })}
                    {m.alreadyOverdue ? ' · deadline already passed' : ''}
                  </p>
                </li>
              ))}
            </ul>
          </>
        )}
      </CardBody>
    </Card>
  );
}
