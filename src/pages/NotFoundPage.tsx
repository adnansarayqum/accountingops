import { LinkButton } from '../ui/components/Button';
import { EmptyState } from '../ui/components/EmptyState';
import { Compass } from 'lucide-react';

export function NotFoundPage() {
  return <EmptyState icon={<Compass />} title="That page doesn't exist" description="The link may be out of date. Head back to Practice Today." action={<LinkButton to="/" variant="primary">Go to Practice Today</LinkButton>} />;
}
