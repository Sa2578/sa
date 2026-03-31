# OutboundCRM

OutboundCRM is a focused cold-email CRM built with Next.js, Prisma, PostgreSQL, Redis, BullMQ, and SMTP inbox rotation.

## What It Does

- Manage outbound domains and inboxes
- Create campaigns and import leads from CSV
- Queue campaign sends through Redis/BullMQ
- Rotate across available inboxes with daily send limits
- Track deliverability metrics and alerts
- Run live DNS checks for SPF, DKIM, DMARC, and MX
- Send one-off real deliverability tests from a chosen inbox
- Inspect webhook/tracking delivery events and raw Gmail headers
- Provide a built-in demo dataset for local testing

## Quick Start

From the project folder:

```powershell
cd "c:\Users\salva\OneDrive\Desktop\Nuova cartella (2)\outbound-crm"
docker compose up -d
npm.cmd run setup:demo
npm.cmd run dev:all
```

Open `http://localhost:3000`

Demo login:

- Email: `demo@outboundcrm.com`
- Password: `password123`

## Prerequisites

- Docker Desktop
- Node.js
- npm on Windows via `npm.cmd`

## Required Environment Variables

See [.env.example](./.env.example):

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/outbound_crm"
REDIS_URL="redis://localhost:6379"
NEXTAUTH_SECRET="change-me-to-a-random-secret-in-production"
NEXTAUTH_URL="http://localhost:3000"
WEBHOOK_SECRET="set-a-shared-secret-for-provider-webhooks"
MAINTENANCE_SECRET="set-a-separate-secret-for-cron-and-maintenance-routes"
```

On Render, the web service can use the platform-provided `RENDER_EXTERNAL_URL` automatically if `NEXTAUTH_URL` is not set. The background worker still needs `NEXTAUTH_URL`, and the included [render.yaml](./render.yaml) wires it from the web service automatically.

## Useful Scripts

- `npm.cmd run dev` - start Next.js app
- `npm.cmd run worker` - start BullMQ email worker
- `npm.cmd run dev:all` - start app and worker together
- `npm.cmd run setup:demo` - run migrations and seed demo data
- `npm.cmd run db:migrate` - create/apply Prisma migrations
- `npm.cmd run db:seed` - seed demo data
- `npm.cmd run db:studio` - open Prisma Studio
- `npm.cmd run lint` - run ESLint
- `npm.cmd run build` - production build
- `npm.cmd run test:e2e:deliverability` - run the deliverability regression E2E

## Deploy on Render

This app needs four production components:

- one public web service
- one background worker
- one PostgreSQL database
- one Redis-compatible queue/cache

The repository includes a [render.yaml](./render.yaml) Blueprint that provisions exactly that stack on Render with Docker, managed Postgres, managed Key Value, and a separate worker process.

Before syncing the Blueprint:

- make sure the code is available from a GitHub, GitLab, or Bitbucket repository that Render can access
- keep the web service public over HTTPS so real mailbox tracking can work
- set your real SMTP inbox credentials later inside the app, not in Render environment variables

After the first deploy:

- open `/api/health` on the public app URL
- register a user or seed one manually if desired
- add your real domain
- run the DNS check from the domain page
- add a real inbox with SMTP credentials
- verify SMTP
- send a one-off deliverability test to a Gmail mailbox
- paste Gmail "Show original" headers into the inbox analysis tool

## Main Routes

- `/dashboard`
- `/domains`
- `/inboxes`
- `/campaigns`
- `/deliverability`
- `/login`
- `/api/health`
- `/api/inboxes/test`
- `/api/domains/[id]/check-dns`
- `/api/inboxes/[id]/send-test`
- `/api/inboxes/[id]/logs`
- `/api/deliverability/header-analysis`
- `/api/maintenance/reply-sync`
- `/api/maintenance/dns-refresh`
- `/api/webhooks/providers/[provider]`

## Operational Notes

- Campaign start queues jobs in Redis only when you trigger it manually.
- The worker selects the least-used active inbox for the current day and respects daily limits.
- `sentToday` is synchronized against the day's email logs, so it stays aligned with actual send attempts.
- Deliverability alerts are refreshed when the deliverability endpoints are requested.
- Email links are wrapped for click tracking, and webhook events can update delivered, bounce, spam, and reply states.
- Provider-native webhook normalization is available for SendGrid, Mailgun, Postmark, Resend, and AWS SES.
- Domain detail pages can run real DNS checks and persist the latest SPF/DKIM/DMARC/MX results.
- Inbox detail pages can verify SMTP, send a one-off real test email, show recent event trails, and analyze pasted Gmail raw headers.
- For real open/click tracking, `NEXTAUTH_URL` must be a public HTTPS URL. `http://localhost:3000` is fine for local development but not for production mailbox telemetry.
- On Render, the web app can infer its public URL from `RENDER_EXTERNAL_URL`, and the included Blueprint passes that URL to the worker as `NEXTAUTH_URL`.
- Scheduled deliverability maintenance can be driven by GitHub Actions through the included workflows and maintenance routes.

## CSV Format

Lead import requires an `email` column.

Optional columns:

- `name`
- `company`

Example:

```csv
email,name,company
alice@example.com,Alice,Acme
bob@example.com,Bob,Northwind
```

## Health Check

Use the health endpoint to verify runtime dependencies:

```powershell
curl http://localhost:3000/api/health
```

It checks:

- environment variables
- PostgreSQL connectivity
- Redis connectivity

## Enterprise-Oriented Features Included

- lazy Redis initialization to reduce startup side effects
- runtime dependency health endpoint
- tracked link wrapping and open pixel support
- webhook secret support for provider callbacks
- maintenance-secret support for cron-style DNS refresh and reply sync
- SMTP verification endpoint for inbox diagnostics
- reply, delivered, spam, bounce, open, and click event ingestion
- provider webhook normalization for SendGrid, Mailgun, Postmark, Resend, and SES
- duplicate filtering during CSV lead imports

## Troubleshooting

If `npm` is blocked in PowerShell, use `npm.cmd`.

If the app opens but campaigns cannot start:

- make sure Redis is running
- make sure the worker is running
- check `/api/health`

If login works but pages fail to load:

- make sure PostgreSQL is running
- run `npm.cmd run db:migrate`
- run `npm.cmd run db:seed`

If you want to stop containers:

```powershell
docker compose down
```
