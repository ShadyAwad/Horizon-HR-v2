# Stanza security testing

Run these checks against a local production build:

```powershell
npm run build
npm run start
npm run test:security
npm run check:security
```

`test:security` checks that browser build output does not contain backend-only
secret names, confirms local `.env` files are not tracked, verifies Helmet
headers, probes anonymous access to sensitive API routes, checks that forged
identity headers do not grant access, and exercises safe input-validation and
error responses. Expected failures must be `400`, `401`, `403`, `404`, or
`409`; an unexpected `500` fails the suite.

Set these optional uncommitted `.env` values to extend coverage with dedicated
local fixtures:

```env
SECURITY_TEST_ADMIN_EMAIL=local-admin@example.test
SECURITY_TEST_ADMIN_PASSWORD=replace-with-local-password
SECURITY_TEST_EMPLOYEE_EMAIL=local-employee@example.test
SECURITY_TEST_EMPLOYEE_PASSWORD=replace-with-local-password
```

The admin fixture must have `hr_admin`; the employee fixture must have the
system `employee` role. These checks confirm that an employee cannot manage
roles or approve payroll. The suite does not modify roles, tenants, payroll,
or real employee data.

## Manual tenant-isolation check

Provision two dedicated local tenants and users. Authenticate as Tenant A,
then use a record ID belonging to Tenant B in payroll, grievance, break
request, and company-location routes. Responses must be `403`, `404`, or an
empty scoped list, and must never return Tenant B data. Also send a mismatched
`tenantId` in any accepted request body and confirm the authenticated token's
tenant remains authoritative.

## Security notes

`VITE_` variables are browser-visible by design. Restrict the public
`VITE_MAPTILER_KEY` to approved origins in MapTiler. Never commit `.env` or
other real environment files. Legacy `x-employee-id` and `x-tenant-id` headers
are only accepted in development or when `DEV_AUTH_HEADERS=true` is explicitly
set for a local test environment; production clients must use signed auth
tokens.
