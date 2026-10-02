import { logServerError } from '../../lib/server-logging';
import type express from 'express';
import { hasDatabaseConfig, withTenant } from '../../lib/hr-background';

type EmployeeRole = 'employee' | 'manager' | 'hr_admin';
type NotificationChannel = 'in_app' | 'email' | 'push';
type NotificationKey =
  | 'attendance_reminders'
  | 'break_reminders'
  | 'break_request_pending'
  | 'break_request_reviewed'
  | 'leave_updates'
  | 'payroll_updates'
  | 'loan_updates'
  | 'grievance_updates'
  | 'company_feed_posts'
  | 'role_permission_changes'
  | 'system_alerts';

type NotificationSettingInput = {
  channel?: NotificationChannel;
  notificationKey?: NotificationKey;
  enabled?: boolean;
  quietHoursStart?: string | null;
  quietHoursEnd?: string | null;
};

type UpdateNotificationSettingsBody = {
  settings?: NotificationSettingInput[];
};

type NotificationRouteDependencies = {
  standardAuth: express.RequestHandler;
  requireRole: (roles: EmployeeRole[]) => express.RequestHandler;
};

const notificationChannels: NotificationChannel[] = ['in_app', 'email', 'push'];
const notificationKeys: NotificationKey[] = [
  'attendance_reminders',
  'break_reminders',
  'break_request_pending',
  'break_request_reviewed',
  'leave_updates',
  'payroll_updates',
  'loan_updates',
  'grievance_updates',
  'company_feed_posts',
  'role_permission_changes',
  'system_alerts',
];

function isNotificationChannel(value: unknown): value is NotificationChannel {
  return typeof value === 'string' && notificationChannels.includes(value as NotificationChannel);
}

function isNotificationKey(value: unknown): value is NotificationKey {
  return typeof value === 'string' && notificationKeys.includes(value as NotificationKey);
}

function isValidQuietHour(value: string | null | undefined) {
  return value === null || value === undefined || /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function formatNotificationSetting(row: {
  channel: NotificationChannel;
  notification_key: NotificationKey;
  enabled: boolean;
  quiet_hours_start?: string | null;
  quiet_hours_end?: string | null;
}) {
  return {
    channel: row.channel,
    notificationKey: row.notification_key,
    enabled: row.enabled,
    quietHoursStart: row.quiet_hours_start ? String(row.quiet_hours_start).slice(0, 5) : null,
    quietHoursEnd: row.quiet_hours_end ? String(row.quiet_hours_end).slice(0, 5) : null,
  };
}

function buildDefaultNotificationSettings() {
  return notificationKeys.flatMap((notificationKey) => (
    notificationChannels.map((channel) => ({
      channel,
      notification_key: notificationKey,
      enabled: true,
      quiet_hours_start: null,
      quiet_hours_end: null,
    }))
  ));
}

function mergeNotificationSettings(rows: Array<{
  channel: NotificationChannel;
  notification_key: NotificationKey;
  enabled: boolean;
  quiet_hours_start?: string | null;
  quiet_hours_end?: string | null;
}>) {
  const savedByKey = new Map(rows.map((row) => [`${row.channel}:${row.notification_key}`, row]));

  return buildDefaultNotificationSettings().map((defaultSetting) => (
    formatNotificationSetting(savedByKey.get(`${defaultSetting.channel}:${defaultSetting.notification_key}`) || defaultSetting)
  ));
}

export function registerNotificationSettingsRoutes(
  app: express.Express,
  { standardAuth, requireRole }: NotificationRouteDependencies,
) {
  app.get(
    '/api/notification-settings/me',
    standardAuth,
    requireRole(['employee', 'manager', 'hr_admin']),
    async (req, res) => {
      const tenantId = req.authUser!.tenantId;
      const employeeId = req.authUser!.employeeId;

      if (!hasDatabaseConfig()) {
        return res.status(503).json({ success: false, error: 'DATABASE_URL is required for notification settings' });
      }

      try {
        const settings = await withTenant(tenantId, async (client) => {
          const result = await client.query<{
            channel: NotificationChannel;
            notification_key: NotificationKey;
            enabled: boolean;
            quiet_hours_start: string | null;
            quiet_hours_end: string | null;
          }>(
            `SELECT channel, notification_key, enabled, quiet_hours_start, quiet_hours_end
             FROM user_notification_settings
             WHERE tenant_id = $1 AND employee_id = $2
             ORDER BY notification_key ASC, channel ASC`,
            [tenantId, employeeId],
          );

          return mergeNotificationSettings(result.rows);
        });

        res.json({ success: true, settings });
      } catch (error) {
        logServerError('[Notifications] Failed to load settings:', error);
        res.status(500).json({ success: false, error: 'Unable to load notification settings' });
      }
    },
  );

  app.put(
    '/api/notification-settings/me',
    standardAuth,
    requireRole(['employee', 'manager', 'hr_admin']),
    async (req, res) => {
      const tenantId = req.authUser!.tenantId;
      const employeeId = req.authUser!.employeeId;
      const { settings } = req.body as UpdateNotificationSettingsBody;

      if (!Array.isArray(settings)) {
        return res.status(400).json({ success: false, error: 'settings must be an array.' });
      }
      if (!hasDatabaseConfig()) {
        return res.status(503).json({ success: false, error: 'DATABASE_URL is required for notification settings' });
      }

      const normalizedSettings: Array<{
        channel: NotificationChannel;
        notificationKey: NotificationKey;
        enabled: boolean;
        quietHoursStart: string | null;
        quietHoursEnd: string | null;
      }> = [];

      for (const setting of settings) {
        if (!isNotificationChannel(setting.channel)) {
          return res.status(400).json({ success: false, error: 'channel must be in_app, email, or push.' });
        }
        if (!isNotificationKey(setting.notificationKey)) {
          return res.status(400).json({ success: false, error: 'notificationKey is invalid.' });
        }
        if (typeof setting.enabled !== 'boolean') {
          return res.status(400).json({ success: false, error: 'enabled must be a boolean.' });
        }
        if (!isValidQuietHour(setting.quietHoursStart) || !isValidQuietHour(setting.quietHoursEnd)) {
          return res.status(400).json({ success: false, error: 'quiet hours must use HH:MM format.' });
        }

        normalizedSettings.push({
          channel: setting.channel,
          notificationKey: setting.notificationKey,
          enabled: setting.enabled,
          quietHoursStart: setting.quietHoursStart || null,
          quietHoursEnd: setting.quietHoursEnd || null,
        });
      }

      try {
        const savedSettings = await withTenant(tenantId, async (client) => {
          await client.query('BEGIN');
          try {
            for (const setting of normalizedSettings) {
              await client.query(
                `INSERT INTO user_notification_settings (
                   tenant_id, employee_id, channel, notification_key, enabled,
                   quiet_hours_start, quiet_hours_end
                 ) VALUES ($1, $2, $3::varchar, $4::varchar, $5::boolean, $6::time, $7::time)
                 ON CONFLICT (tenant_id, employee_id, channel, notification_key)
                 DO UPDATE SET enabled = EXCLUDED.enabled,
                   quiet_hours_start = EXCLUDED.quiet_hours_start,
                   quiet_hours_end = EXCLUDED.quiet_hours_end,
                   updated_at = NOW()`,
                [
                  tenantId,
                  employeeId,
                  setting.channel,
                  setting.notificationKey,
                  setting.enabled,
                  setting.quietHoursStart,
                  setting.quietHoursEnd,
                ],
              );
            }

            await client.query(
              `INSERT INTO audit_logs (
                 tenant_id, actor_employee_id, action, entity_type, entity_id, metadata
               ) VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
              [
                tenantId,
                employeeId,
                'notification_settings_updated',
                'notification_settings',
                employeeId,
                JSON.stringify({ updatedSettingCount: normalizedSettings.length }),
              ],
            );

            const result = await client.query<{
              channel: NotificationChannel;
              notification_key: NotificationKey;
              enabled: boolean;
              quiet_hours_start: string | null;
              quiet_hours_end: string | null;
            }>(
              `SELECT channel, notification_key, enabled, quiet_hours_start, quiet_hours_end
               FROM user_notification_settings
               WHERE tenant_id = $1 AND employee_id = $2
               ORDER BY notification_key ASC, channel ASC`,
              [tenantId, employeeId],
            );

            await client.query('COMMIT');
            return mergeNotificationSettings(result.rows);
          } catch (error) {
            await client.query('ROLLBACK');
            throw error;
          }
        });

        res.json({ success: true, settings: savedSettings });
      } catch (error) {
        logServerError('[Notifications] Failed to save settings:', error);
        res.status(500).json({ success: false, error: 'Unable to save notification settings' });
      }
    },
  );
}
