# Deliverability Operations Guide

Questa guida copre la parte operativa ad alta priorita': CI, refresh DNS, sync reply e webhook provider.

## 1. Secret consigliati

Nel deploy pubblico configura:

```env
WEBHOOK_SECRET=un-segreto-per-n8n-e-provider-webhook
MAINTENANCE_SECRET=un-segreto-diverso-per-job-schedulati
```

`MAINTENANCE_SECRET` ricade su `WEBHOOK_SECRET` se non e' impostato, ma in produzione e' meglio tenerli separati.

## 2. Workflow GitHub inclusi

In [.github/workflows/ci.yml](../.github/workflows/ci.yml):

- `npm ci`
- `prisma generate`
- `eslint`
- `tsc --noEmit`
- `next build`

In [.github/workflows/deliverability-maintenance.yml](../.github/workflows/deliverability-maintenance.yml):

- reply sync ogni ora
- refresh DNS una volta al giorno
- esecuzione manuale via `workflow_dispatch`

## 3. Secret GitHub Actions da creare

Nel repository GitHub aggiungi:

- `APP_BASE_URL`
- `MAINTENANCE_SECRET`

Esempio:

```text
APP_BASE_URL=https://outbound-crm-koyeb-sa22-ccfdaa62.koyeb.app
```

## 4. Route di manutenzione

### Reply sync batch

```text
POST /api/maintenance/reply-sync
```

Header:

```text
x-maintenance-secret: <MAINTENANCE_SECRET>
```

Payload esempio:

```json
{
  "lookbackDays": 21,
  "maxMessages": 200,
  "maxInboxes": 25
}
```

### DNS refresh batch

```text
POST /api/maintenance/dns-refresh
```

Payload esempio:

```json
{
  "maxDomains": 50
}
```

## 5. Webhook provider supportati

Route normalizzate:

- `POST /api/webhooks/providers/sendgrid`
- `POST /api/webhooks/providers/mailgun`
- `POST /api/webhooks/providers/postmark`
- `POST /api/webhooks/providers/resend`
- `POST /api/webhooks/providers/ses`

Puoi proteggere la route in due modi:

- header `x-webhook-secret`
- query string `?secret=<WEBHOOK_SECRET>`

La query string e' utile per provider che non permettono header custom.

## 6. Correlazione consigliata all'invio

Quando usi `POST /api/n8n/prepare-send`, il CRM restituisce:

- header custom `X-OutboundCRM-*`
- `providerHints.metadata`
- `providerHints.sendgrid.customArgs`
- `providerHints.mailgun.variables`
- `providerHints.postmark.metadata`
- `providerHints.resend.tags`
- `providerHints.ses.emailTags`

Usali sempre: rendono piu' robusto il collegamento tra webhook provider e `EmailLog`.

## 7. Lettura corretta delle metriche

Segnali forti:

- `clickRate`
- `replyRate`
- `bounceRate`
- `spamRate`
- `inboxPlacementRate`

Segnali deboli:

- `verifiedOpenRate`
- `proxyOpenRate`

Su Gmail/Webmail, i proxy fetch vanno letti come indizio e non come verita' assoluta di apertura.
