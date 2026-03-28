# n8n Deliverability Guide

Questa guida serve per usare il CRM come layer di tracking quando l'invio vero viene fatto da `n8n`.

## Prerequisiti

- Il deploy pubblico del CRM deve essere raggiungibile via HTTPS.
- `WEBHOOK_SECRET` deve essere valorizzato.
- In `n8n` devi inviare l'header `x-webhook-secret: <WEBHOOK_SECRET>` verso gli endpoint del CRM.

Base URL di esempio:

```text
https://outbound-crm-koyeb-sa22-ccfdaa62.koyeb.app
```

## Flusso consigliato

1. n8n chiama `POST /api/n8n/prepare-send`
2. il CRM crea `Lead`, `EmailLog` e restituisce HTML gia' tracciato
3. n8n invia la mail con il body restituito dal CRM
4. dopo l'invio, n8n chiama `POST /api/n8n/events`
5. quando hai gli header Gmail, n8n o un operatore chiama `POST /api/n8n/header-analysis`

## 1. Preparare la mail

Endpoint:

```text
POST /api/n8n/prepare-send
```

Payload minimo:

```json
{
  "inboxId": "cmn7zkxrr00021vknpi7ktkke",
  "recipientEmail": "destinatario@example.com",
  "subject": "Hello from n8n",
  "bodyHtml": "<p>Hello <a href=\"https://example.com\">click here</a></p>",
  "workflowName": "Cold Outreach"
}
```

Risposta utile:

- `emailLog.id`: id da usare nei passaggi successivi
- `message.html`: HTML gia' tracciato
- `message.text`: versione testo
- `message.headers`: header custom da inoltrare nel nodo email
- `tracking.eventsWebhookUrl`: endpoint per `accepted/delivered/bounce/reply`
- `tracking.headersWebhookUrl`: endpoint per salvare gli header Gmail

## 2. Inviare da n8n

Nel nodo email di n8n usa:

- `From`: l'inbox che vuoi usare
- `To`: il destinatario
- `Subject`: `message.subject`
- `HTML`: `message.html`
- `Text`: `message.text`
- headers custom:

```json
{
  "X-OutboundCRM-Log-Id": "emailLog.id",
  "X-OutboundCRM-Campaign-Id": "campaign.id"
}
```

## 3. Registrare gli esiti

Endpoint:

```text
POST /api/n8n/events
```

Esempio `accepted`:

```json
{
  "emailLogId": "cmnatsu2g00011vfp1t3svrvj",
  "event": "accepted",
  "providerMessageId": "<provider-message-id@example.com>",
  "response": "250 2.0.0 OK",
  "occurredAt": "2026-03-28T21:12:00.920Z"
}
```

Esempio `bounce`:

```json
{
  "emailLogId": "cmnatsu2g00011vfp1t3svrvj",
  "event": "bounce",
  "reason": "550 5.1.1 User unknown",
  "occurredAt": "2026-03-28T21:14:00.000Z"
}
```

Eventi supportati:

- `accepted`
- `delivered`
- `open`
- `click`
- `bounce`
- `spam`
- `reply`
- `failed`

## 4. Salvare gli header Gmail

Endpoint:

```text
POST /api/n8n/header-analysis
```

Esempio:

```json
{
  "emailLogId": "cmnatsu2g00011vfp1t3svrvj",
  "placement": "INBOX",
  "rawHeaders": "Delivered-To: ... Authentication-Results: ..."
}
```

Placement supportati:

- `INBOX`
- `PROMOTIONS`
- `SPAM`
- `UPDATES`
- `FORUMS`
- `OTHER`
- `UNKNOWN`

## Mapping pratico per n8n

- nodo `HTTP Request` iniziale -> `POST /api/n8n/prepare-send`
- nodo email -> invia `message.html`
- nodo `HTTP Request` successivo -> `POST /api/n8n/events` con `accepted`
- eventuale provider webhook o polling -> `POST /api/n8n/events` con `delivered`, `bounce`, `reply`, `spam`
- eventuale step manuale o Gmail parsing -> `POST /api/n8n/header-analysis`

## Cosa vedrai nel CRM

- il log della mail compare subito come `QUEUED`
- dopo `accepted` passa a `SENT`
- con `delivered` passa a `DELIVERED`
- con pixel/link tracciati passa a `OPENED` e `CLICKED`
- con gli header Gmail vedrai `SPF`, `DKIM`, `DMARC` e `Placement`

## Nota importante

Se n8n invia una mail senza passare prima da `prepare-send`, il CRM non potra' collegare in modo affidabile open, click, bounce e placement a un log esistente.
