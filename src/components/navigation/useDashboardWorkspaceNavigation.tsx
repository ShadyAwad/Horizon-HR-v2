import { useMemo, type ReactNode } from 'react';
import { StanzaIcon } from '../ui/StanzaIcon';
import {
  BarChart3,
  Box,
  BriefcaseBusiness,
  Calendar,
  DollarSign,
  FileText,
  Map,
  MapPin,
  MessageSquare,
  Network,
  Newspaper,
  ReceiptText,
  ScrollText,
  ShieldCheck,
  User,
  UsersRound,
} from 'lucide-react';
import type { DashboardAttentionCounts } from '../../hooks/useDashboardAttentionCounts';
import type { TranslationKey } from '../../lib/LanguageContext';
import type { DashboardNavigationItem } from '../../navigation/navigation-contracts';
import {
  WORKSPACE_REGISTRY,
  type DashboardTabId,
  type DashboardWorkspaceId,
  type WorkspaceIconKey,
  type WorkspaceVisibilityKey,
} from '../../navigation/workspace-registry';

type WorkspaceCapabilities = Record<WorkspaceVisibilityKey, boolean>;
type ActiveProfilePanel = 'payroll' | 'grievances' | null;

type WorkspaceNavigationOptions = {
  activeTab: DashboardTabId;
  activeProfilePanel: ActiveProfilePanel;
  capabilities: WorkspaceCapabilities;
  attentionCounts: DashboardAttentionCounts;
  translate: (key: TranslationKey) => string;
  onSelect: (id: DashboardWorkspaceId) => void;
};

const iconFor = (icon: WorkspaceIconKey): ReactNode => {
  const className = 'h-5 w-5';
  switch (icon) {
    case 'map': return <Map className={className} />;
    case 'calendar': return <Calendar className={className} />;
    case 'receipt': return <ReceiptText className={className} />;
    case 'briefcase': return <BriefcaseBusiness className={className} />;
    case 'chart': return <BarChart3 className={className} />;
    case 'network': return <Network className={className} />;
    case 'mapPin': return <MapPin className={className} />;
    case 'users': return <UsersRound className={className} />;
    case 'box': return <Box className={className} />;
    case 'newspaper': return <Newspaper className={className} />;
    case 'dollar': return <DollarSign className={className} />;
    case 'message': return <MessageSquare className={className} />;
    case 'file': return <FileText className={className} />;
    case 'audit': return <ScrollText className={className} />;
    case 'shield': return <ShieldCheck className={className} />;
    case 'user': return <User className={className} />;
  }
};

function isActive(
  id: DashboardWorkspaceId,
  activeTab: DashboardTabId,
  activeProfilePanel: ActiveProfilePanel,
) {
  if (id === 'payroll' || id === 'grievances') {
    return activeTab === 'profile' && activeProfilePanel === id;
  }
  if (id === 'profile') return activeTab === 'profile' && activeProfilePanel === null;
  return activeTab === id;
}

export function useDashboardWorkspaceNavigation({
  activeTab,
  activeProfilePanel,
  capabilities,
  attentionCounts,
  translate,
  onSelect,
}: WorkspaceNavigationOptions) {
  return useMemo<DashboardNavigationItem[]>(() => {
    const counts = {
      ...attentionCounts,
      payroll: attentionCounts.payroll + attentionCounts.loans,
    };

    return WORKSPACE_REGISTRY
      .filter((workspace) => !workspace.visibility || capabilities[workspace.visibility])
      .map((workspace) => ({
        id: workspace.id,
        label: translate(workspace.labelKey),
        group: workspace.group,
        icon: workspace.id === 'support' ? <StanzaIcon name="support" /> : workspace.id === 'composer' ? <StanzaIcon name="workspace" /> : iconFor(workspace.icon),
        badge: workspace.attention ? counts[workspace.attention] : 0,
        active: isActive(workspace.id, activeTab, activeProfilePanel),
        onSelect: () => onSelect(workspace.id),
      }));
  }, [activeProfilePanel, activeTab, attentionCounts, capabilities, onSelect, translate]);
}
