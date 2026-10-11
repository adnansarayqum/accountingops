import { Link } from 'react-router-dom';
import { Landmark } from 'lucide-react';
import { Card, CardBody, CardHeader } from './Card';
import { Button } from './Button';
import { Badge } from './Badge';
import { useAppStore } from '../../application/store';
import { useData } from '../../application/selectors';
import { useBankStatements } from '../../application/useBankStatements';
import { checkStatements } from '../../domain/rules/bankStatements';

/**
 * On a client's page: how many bank statements have been read, whether they
 * check out, and the way to the transactions. Renders nothing without a
 * server (nothing is read in browser-only mode) or without a bank statement.
 */
export function BankStatementsCard({ clientId }: { clientId: string }) {
  const authMode = useAppStore((s) => s.authMode);
  const data = useData();
  const sources = data.documents
    .filter((d) => d.clientId === clientId && d.documentType === 'Bank statement' && (d.intakeUploadIds?.length ?? 0) > 0)
    .map((d) => (d.intakeUploadIds as string[])[0]);
  const { statements } = useBankStatements(authMode === 'server' ? sources : []);

  if (authMode !== 'server' || sources.length === 0 || !statements) return null;
  const read = statements.filter((s) => s.status === 'extracted');
  const reading = statements.filter((s) => s.status === 'reading').length;
  const checks = checkStatements(statements);
  const lineCount = read.reduce((n, s) => n + s.transactions.length, 0);

  return (
    <Card data-testid="bank-statements-card">
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            Bank transactions
            {read.length > 0 && (checks.allClear ? <Badge tone="green">Checks out</Badge> : <Badge tone="amber">Needs a look</Badge>)}
          </span>
        }
        icon={<Landmark />}
        description={`${sources.length} statement${sources.length === 1 ? '' : 's'} received · ${read.length} read${reading > 0 ? ` · ${reading} reading` : ''}${lineCount > 0 ? ` · ${lineCount} transactions` : ''}`}
      />
      <CardBody className="pt-0">
        <Link to={`/clients/${clientId}/transactions`} tabIndex={-1}>
          <Button size="sm" variant="secondary" data-testid="bank-transactions-open">
            View transactions
          </Button>
        </Link>
      </CardBody>
    </Card>
  );
}
