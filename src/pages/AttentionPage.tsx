import { useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { PageHeader } from '../ui/components/PageHeader';
import { AttentionCard } from '../ui/components/AttentionCard';
import { Tabs } from '../ui/components/Tabs';
import { Card } from '../ui/components/Card';
import { EmptyState } from '../ui/components/EmptyState';
import { Select } from '../ui/components/Form';
import { useData, useDerived } from '../application/selectors';

type Filter = 'all' | 'red' | 'amber';

export function AttentionPage() {
  const derived = useDerived();
  const data = useData();
  const [filter, setFilter] = useState<Filter>('all');
  const [owner, setOwner] = useState('all');
  const items = derived.attention.filter((a) => (filter === 'all' ? true : a.severity === filter)).filter((a) => (owner === 'all' ? true : a.ownerUserId === owner));
  const red = derived.attention.filter((a) => a.severity === 'red').length;

  return (
    <div className="animate-in">
      <PageHeader
        title="Needs Attention"
        description="Explainable operational rules — every item shows why it was flagged and what to do next."
        actions={
          <Select value={owner} onChange={(e) => setOwner(e.target.value)} aria-label="Filter by owner" className="w-44">
            <option value="all">All owners</option>
            {data.users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
        }
      />
      <Tabs
        value={filter}
        onChange={setFilter}
        className="mb-4"
        options={[
          { value: 'all', label: 'All', count: derived.attention.length },
          { value: 'red', label: 'Immediate risk', count: red },
          { value: 'amber', label: 'Watch', count: derived.attention.length - red },
        ]}
      />
      {items.length === 0 ? (
        <Card>
          <EmptyState icon={<CheckCircle2 />} title="Everything is under control" description="There are no jobs requiring immediate action." />
        </Card>
      ) : (
        <div className="space-y-3" data-testid="attention-list">
          {items.map((a) => {
            const view = derived.jobViewById.get(a.jobId);
            return view ? <AttentionCard key={a.id} item={a} view={view} /> : null;
          })}
        </div>
      )}
    </div>
  );
}
