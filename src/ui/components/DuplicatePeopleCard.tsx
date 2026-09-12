import { useMemo } from 'react';
import { Merge } from 'lucide-react';
import { Card, CardBody, CardHeader } from './Card';
import { Button } from './Button';
import { useAppStore } from '../../application/store';
import { useData } from '../../application/selectors';
import { findDuplicatePeople } from '../../domain/peopleMerge';
import { normalisePersonName } from '../../domain/personNames';

/**
 * People recorded more than once — typically a director added by an import
 * as "HASAN, Mohammad" and again by a Companies House refresh as "Mr
 * Mohammad Hasan", before names were normalised. Lists what a merge would
 * do and does it only on confirmation, as one ordinary saved change.
 */
export function DuplicatePeopleCard() {
  const data = useData();
  const authMode = useAppStore((s) => s.authMode);
  const mergeDuplicatePeople = useAppStore((s) => s.mergeDuplicatePeople);
  const toast = useAppStore((s) => s.toast);
  const groups = useMemo(() => findDuplicatePeople(data), [data]);
  const removable = groups.reduce((sum, g) => sum + g.duplicates.length, 0);
  const clientName = (id: string) => data.clients.find((c) => c.id === id)?.name ?? id;

  const merge = () => {
    const undo = authMode === 'server' ? ' This is saved as a new version, so it can be undone from Version history.' : '';
    if (!window.confirm(`Merge ${removable} duplicate ${removable === 1 ? 'record' : 'records'}? Roles and verification status move to the record that stays.${undo}`)) return;
    const result = mergeDuplicatePeople();
    const parts = [`${result.peopleRemoved} ${result.peopleRemoved === 1 ? 'record' : 'records'} merged`];
    if (result.rolesMoved > 0) parts.push(`${result.rolesMoved} ${result.rolesMoved === 1 ? 'role' : 'roles'} moved`);
    if (result.rolesCombined > 0) parts.push(`${result.rolesCombined} combined`);
    toast({ title: 'Duplicates merged', description: `${parts.join(', ')}.`, tone: 'success' });
  };

  return (
    <Card data-testid="duplicate-people">
      <CardHeader
        title="Duplicate people"
        icon={<Merge />}
        description="A director or PSC recorded twice for the same client — once from an import and once from Companies House, say."
        action={
          groups.length > 0 ? (
            <Button size="sm" icon={<Merge />} onClick={merge} data-testid="merge-duplicate-people">
              Merge {removable} duplicate{removable === 1 ? '' : 's'}
            </Button>
          ) : undefined
        }
      />
      <CardBody className="pt-0">
        {groups.length === 0 ? (
          <p className="text-[13px] text-slate-500">No duplicate people found.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {groups.map((g) => (
              <li key={g.keep.id} className="py-2" data-testid={`duplicate-group-${g.keep.id}`}>
                <p className="text-[13px] font-medium text-slate-900">
                  {normalisePersonName(g.keep.fullName)}
                  <span className="ml-2 text-xs font-normal text-slate-500">
                    recorded {g.duplicates.length + 1} times{g.keep.birthMonthYear ? ` · born ${g.keep.birthMonthYear}` : ''}
                  </span>
                </p>
                <p className="text-xs text-slate-500">
                  Keeps “{g.keep.fullName}”; merges {g.duplicates.map((p) => `“${p.fullName}”`).join(', ')} · {g.clientIds.map(clientName).join(', ')}
                </p>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
