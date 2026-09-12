import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, FileCheck, Play, Send, ShieldCheck, UserPlus } from 'lucide-react';
import { ReminderComposer } from './ReminderComposer';
import { useAppStore } from '../../application/store';
import type { AttentionItem } from '../../domain/rules';
import type { JobView } from '../../application/selectors';

const ACTION_ICONS = { send_reminder: Send, chase_approval: Send, assign_reviewer: UserPlus, reassign: UserPlus, verify_identity: ShieldCheck, file: FileCheck, start_work: Play, review_job: ArrowRight };

/** Two-word forms for a table cell, where the full label ("Send email reminder to client") does not fit. */
const SHORT_LABELS = { send_reminder: 'Send reminder', chase_approval: 'Chase approval', assign_reviewer: 'Assign reviewer', reassign: 'Assign', verify_identity: 'Verify identity', file: 'Mark as filed', start_work: 'Start work', review_job: 'Review' };

/**
 * Running an attention item's recommended action — shared by the dashboard's
 * compact table and the full card on the Attention page, so the two can't
 * drift on what "Send reminder" or "Mark as filed" actually does.
 *
 * Returns the handler, the matching icon, a short button label, and the
 * reminder composer element to render (it needs to live in the caller's
 * tree, since that's where it can portal from).
 */
export function useAttentionAction(item: AttentionItem, view: JobView): { run: () => void; icon: ReactNode; label: string; shortLabel: string; composer: ReactNode } {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const transition = useAppStore((s) => s.transitionJob);
  const fileJob = useAppStore((s) => s.fileJob);
  const toast = useAppStore((s) => s.toast);

  const run = () => {
    switch (item.recommendedAction.kind) {
      case 'send_reminder':
      case 'chase_approval':
        setOpen(true);
        return;
      case 'file': {
        const r = fileJob(view.job.id);
        toast({ title: 'Job marked as filed', description: r.nextJob ? `Simulated submission recorded. Next job created: ${r.nextJob.name}.` : 'Simulated submission recorded.', tone: 'success' });
        return;
      }
      case 'start_work':
        transition(view.job.id, 'in_progress');
        toast({ title: 'Work started', tone: 'success' });
        return;
      default:
        navigate(`/jobs/${view.job.id}`);
    }
  };

  const Icon = ACTION_ICONS[item.recommendedAction.kind];
  return {
    run,
    icon: <Icon />,
    // "Send email reminder to client" is right on a full card but too long for
    // a table cell — the row already says which client it is.
    label: item.recommendedAction.label.replace(/ to client$/, ''),
    shortLabel: SHORT_LABELS[item.recommendedAction.kind],
    composer: open ? <ReminderComposer job={view.job} open={open} onClose={() => setOpen(false)} initialChannel={item.recommendedAction.channel} /> : null,
  };
}
