import type express from 'express';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { hasDatabaseConfig, withTenant } from '../../lib/hr-background';

type PayrollExportRouteDependencies = {
  standardAuth: express.RequestHandler;
  requirePermission: (permission: string) => express.RequestHandler;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value: string | undefined) {
  return Boolean(value && uuidPattern.test(value));
}

function formatPdfDate(value: string | Date | null | undefined) {
  if (!value) return 'Not set';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Not set';
  return parsed.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatPdfDateTime(value: string | Date | null | undefined) {
  if (!value) return 'Not set';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Not set';
  return parsed.toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function formatPdfMoney(value: string | number | null | undefined, currency: string | null | undefined) {
  const amount = Number(value || 0);
  return `${new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(amount) ? amount : 0)} ${currency || 'USD'}`;
}

function sanitizeFilenamePart(value: string | null | undefined) {
  const sanitized = (value || 'payroll')
    .trim()
    .replace(/[^a-z0-9_-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return sanitized || 'payroll';
}

export function registerPayrollExportRoute(
  app: express.Express,
  { standardAuth: demoAuth, requirePermission }: PayrollExportRouteDependencies,
) {
  app.get(
    '/api/payroll/:id/pdf',
    demoAuth,
    requirePermission('payroll.export_pdf'),
    async (req, res) => {
      const { id } = req.params;
      const tenantId = req.authUser!.tenantId;
      const employeeId = req.authUser!.employeeId;
      const role = req.authUser!.role;
      const canViewAllPayroll = role === 'hr_admin' || Boolean(req.authUser!.permissions?.includes('payroll.view_all'));
  
      if (!isUuid(id)) {
        return res.status(400).json({ success: false, error: 'Payroll record id must be a valid UUID.' });
      }
  
      if (!hasDatabaseConfig()) {
        return res.status(503).json({ success: false, error: 'DATABASE_URL is required for payroll PDF export' });
      }
  
      try {
        const payrollRecord = await withTenant(tenantId, async (client) => {
          const result = await client.query(
            `
              SELECT
                payroll_records.id,
                payroll_records.employee_id,
                payroll_records.pay_period_start,
                payroll_records.pay_period_end,
                payroll_records.base_salary,
                payroll_records.bonuses,
                payroll_records.deductions,
                payroll_records.net_pay,
                payroll_records.currency,
                payroll_records.status,
                payroll_records.generated_at,
                payroll_records.approved_at,
                payroll_records.paid_at,
                payroll_records.cancelled_at,
                employees.full_name,
                employees.email,
                tenants.company_name,
                tenants.default_currency
              FROM payroll_records
              INNER JOIN employees
                ON employees.id = payroll_records.employee_id
               AND employees.tenant_id = payroll_records.tenant_id
              INNER JOIN tenants
                ON tenants.id = payroll_records.tenant_id
              WHERE payroll_records.tenant_id = $1
                AND payroll_records.id = $2
              LIMIT 1
            `,
            [tenantId, id],
          );
  
          return result.rows[0];
        });
  
        if (!payrollRecord) {
          return res.status(404).json({ success: false, error: 'Payroll record not found.' });
        }
  
        if (!canViewAllPayroll && payrollRecord.employee_id !== employeeId) {
          return res.status(403).json({ success: false, error: 'You do not have permission to export this payroll record.' });
        }
  
        const currency = payrollRecord.currency || payrollRecord.default_currency || 'USD';
        const pdf = await PDFDocument.create();
        const page = pdf.addPage([595.28, 841.89]);
        const regularFont = await pdf.embedFont(StandardFonts.Helvetica);
        const boldFont = await pdf.embedFont(StandardFonts.HelveticaBold);
        const { width, height } = page.getSize();
        const left = 56;
        let y = height - 64;
  
        const drawText = (
          text: string,
          x: number,
          nextY: number,
          options: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb> } = {},
        ) => {
          page.drawText(text, {
            x,
            y: nextY,
            size: options.size || 11,
            font: options.bold ? boldFont : regularFont,
            color: options.color || rgb(0.15, 0.18, 0.22),
          });
        };
  
        const drawRow = (label: string, value: string) => {
          drawText(label, left, y, { size: 10, bold: true, color: rgb(0.12, 0.35, 0.26) });
          drawText(value, left + 155, y, { size: 10 });
          y -= 22;
        };
  
        drawText('Stanza', left, y, { size: 13, bold: true, color: rgb(0.02, 0.45, 0.32) });
        y -= 28;
        drawText('Payroll Statement', left, y, { size: 24, bold: true, color: rgb(0.02, 0.22, 0.18) });
        y -= 34;
        page.drawLine({
          start: { x: left, y },
          end: { x: width - left, y },
          thickness: 1,
          color: rgb(0.75, 0.82, 0.78),
        });
        y -= 28;
  
        drawRow('Company', payrollRecord.company_name);
        drawRow('Employee', payrollRecord.full_name);
        drawRow('Email', payrollRecord.email);
        drawRow('Payroll Record ID', payrollRecord.id);
        drawRow('Period', `${formatPdfDate(payrollRecord.pay_period_start)} to ${formatPdfDate(payrollRecord.pay_period_end)}`);
        drawRow('Status', payrollRecord.status);
        drawRow('Generated', formatPdfDateTime(payrollRecord.generated_at));
        if (payrollRecord.approved_at) {
          drawRow('Approved', formatPdfDateTime(payrollRecord.approved_at));
        }
        if (payrollRecord.paid_at) {
          drawRow('Paid', formatPdfDateTime(payrollRecord.paid_at));
        }
        if (payrollRecord.cancelled_at) {
          drawRow('Cancelled', formatPdfDateTime(payrollRecord.cancelled_at));
        }
  
        y -= 12;
        drawText('Earnings', left, y, { size: 14, bold: true, color: rgb(0.02, 0.45, 0.32) });
        y -= 26;
        drawRow('Base Salary', formatPdfMoney(payrollRecord.base_salary, currency));
        drawRow('Bonuses', formatPdfMoney(payrollRecord.bonuses, currency));
  
        y -= 8;
        drawText('Deductions', left, y, { size: 14, bold: true, color: rgb(0.02, 0.45, 0.32) });
        y -= 26;
        drawRow('Deductions', formatPdfMoney(payrollRecord.deductions, currency));
  
        y -= 8;
        drawText('Net Pay', left, y, { size: 14, bold: true, color: rgb(0.02, 0.45, 0.32) });
        y -= 30;
        drawText(formatPdfMoney(payrollRecord.net_pay, currency), left, y, { size: 20, bold: true, color: rgb(0.02, 0.22, 0.18) });
  
        const generatedAt = new Date().toISOString();
        drawText('Generated by Stanza', left, 48, { size: 9, color: rgb(0.38, 0.44, 0.42) });
        drawText(`Generated at ${formatPdfDateTime(generatedAt)}`, left, 32, { size: 9, color: rgb(0.38, 0.44, 0.42) });
  
        const pdfBytes = await pdf.save();
        const periodPart = `${formatPdfDate(payrollRecord.pay_period_start)}-${formatPdfDate(payrollRecord.pay_period_end)}`;
        const filename = `payroll-${sanitizeFilenamePart(periodPart)}-${sanitizeFilenamePart(payrollRecord.full_name)}.pdf`;
  
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Cache-Control', 'no-store');
        res.send(Buffer.from(pdfBytes));
      } catch (error) {
        console.error('[Payroll] Failed to export payroll PDF:', error);
        res.status(500).json({ success: false, error: 'Unable to export payroll PDF' });
      }
    },
  );
}
