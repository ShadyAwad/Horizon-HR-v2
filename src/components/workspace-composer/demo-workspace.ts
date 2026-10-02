import type { AuthUser } from '../../auth/auth-contract';
import { canUseWidget, widgetDefinition, type WidgetId } from './widget-catalog';
import { normalizePreferences, type ComposerPreferences } from './workspace-model';
/** Demo-only first-use layouts; saved browser choices always win. */
export function demoWorkspace(user: AuthUser): ComposerPreferences | null {
    if (!user.isDemoTenant)
        return null;
    const name = user.role === 'hr_admin' ? 'HR Morning' : user.role === 'manager' ? 'Team Overview' : 'My Day';
    const ids: WidgetId[] = user.role === 'hr_admin' ? ['attendance', 'leave', 'grievances', 'hiring', 'communications'] : user.role === 'manager' ? ['attendance', 'breaks', 'goals', 'leave'] : ['attendance', 'goals', 'feed'];
    return normalizePreferences({ version: 1, activeId: 'northstar-demo', surface: 'auto', workspaces: [{ id: 'northstar-demo', name, widgets: ids.filter(id => canUseWidget(user, widgetDefinition(id)!)).map((widgetId, i) => ({ instanceId: `northstar-${widgetId}`, widgetId, x: (i % 2) * 6, y: Math.floor(i / 2) * 5, width: 6, height: 5, config: { limit: 5 }, surfaceOverride: 'auto' })) }] });
}
