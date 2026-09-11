import { useEffect } from 'react';
import { LinkButton } from '../ui/components/Button';
import { EmptyState } from '../ui/components/EmptyState';
import { Compass } from 'lucide-react';

export function NotFoundPage() {
  // The only page whose tab title shouldn't read "Practice Today": a stale
  // link should say so in the tab and in history, then hand the title back.
  useEffect(() => {
    const previous = document.title;
    document.title = 'Page not found — Farhan & Raihan Accounting Operations Hub';
    return () => {
      document.title = previous;
    };
  }, []);

  return <EmptyState headingLevel="h1" icon={<Compass />} title="That page doesn't exist" description="The link may be out of date. Head back to Practice Today." action={<LinkButton to="/" variant="primary">Go to Practice Today</LinkButton>} />;
}
