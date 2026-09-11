import { LayoutDashboard, Inbox, Users, Briefcase, BellRing, AlertTriangle, UserPlus, Gauge, ShieldCheck, Sunrise, Activity, Sparkles, Settings, type LucideIcon } from 'lucide-react';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  badge?: 'attention' | 'inbox' | 'chasing';
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Core',
    items: [
      { to: '/', label: 'Practice Today', icon: LayoutDashboard },
      { to: '/inbox', label: 'Smart Inbox', icon: Inbox, badge: 'inbox' },
      { to: '/clients', label: 'Clients', icon: Users },
      { to: '/jobs', label: 'Jobs', icon: Briefcase },
      { to: '/chasing', label: 'Chasing', icon: BellRing, badge: 'chasing' },
    ],
  },
  {
    label: 'Workflow',
    items: [
      { to: '/attention', label: 'Needs Attention', icon: AlertTriangle, badge: 'attention' },
      { to: '/onboarding', label: 'Onboarding', icon: UserPlus },
      { to: '/capacity', label: 'Capacity', icon: Gauge },
      { to: '/readiness', label: 'Readiness', icon: ShieldCheck },
    ],
  },
  {
    label: 'Comms',
    items: [
      { to: '/briefing', label: 'Briefing', icon: Sunrise },
      { to: '/activity', label: 'Activity', icon: Activity },
      { to: '/ask', label: 'Ask the Practice', icon: Sparkles },
    ],
  },
];

export const SETTINGS_NAV: NavItem = { to: '/settings', label: 'Settings', icon: Settings };
