# @ei-tech/webhooks


## Partner documentation


### Verify webhook signature (optional)

To confirm the webhook was sent by EI you can validate its signature using our shared webhook secret and the following code:
1. Read the `X-Webhook-Signature` from the HTTP request headers 
2. Pass it with your webhook secret to `verifyWebhookSignature` (or equivalent)

```typescript
const createWebhookSignature = (secret: string, body: string) => {
  const hmac = crypto.createHmac('sha256', secret)
  hmac.update(body)
  return hmac.digest('hex')
}

const verifyWebhookSignature = (secret: string, signature: string, body: string): boolean => {
  const expected = createWebhookSignature(secret, body)
  return crypto.timingSafeEqual(
    Buffer.from(signature, 'hex'),
    Buffer.from(expected, 'hex'),
  )
}
```

Example:
```ts
const validateRequest = async (request: Request) => {
  console.log('Verify webhook received')
  const body = await request.json()
  const signature = request.headers.get('X-Webhook-Signature')
  if (!signature) {
    console.log('Webhook has no signature')
    return false
  } else {
    const isValid = verifyWebhookSignature(Redacted.make('fake-secret'), signature, JSON.stringify(body))
    console.log('Webhook signature valid?', isValid)
    return isValid
  }}
```

### Lead Summary Events

The lead summary webhook provides comprehensive status updates for leads throughout their journey, from verification to policy binding. This webhook consolidates information about insurance verification, quotes, and policy status in a single event.

#### Event Structure

All lead summary events follow this base structure:

```typescript
interface LeadStatusSummaryEvent {
  id: string;                    // The ID of the event
  leadId: string;               // The ID of the lead
  partnerExternalId: string;    // External partner ID
  eventType: "lead_summary";    // Always "lead_summary"
  eventTime: string;            // ISO 8601 timestamp when event occurred
  status: LeadStatus;           // One of the status values below
  summary: {
    insuranceVerification?: InsuranceVerificationSummary;
    quote?: QuoteSummary;
    policy?: PolicySummary;
  };
}
```

#### Event Status Types

The `status` field indicates what type of event occurred:

- `verification.completed` - Insurance verification was completed successfully
- `quote.completed` - A quote was successfully generated for the lead
- `quote.viewed` - The lead viewed a quote
- `policy.bound` - The lead bound a policy
- `error` - Lead is in an error state (could be quoting error)

#### 1. Verification Completed Event

Sent when insurance verification is completed successfully.

**Status:** `verification.completed`

**Summary includes:** `insuranceVerification` (required)

```typescript
// Example: ID Card Verification Completed
{
  "id": "req_123456789",
  "leadId": "lead_987654321",
  "partnerExternalId": "partner_app_456",
  "eventType": "lead_summary",
  "eventTime": "2024-01-15T10:30:00.000Z",
  "status": "verification.completed",
  "summary": {
    "insuranceVerification": {
      "id": "verification_123",
      "status": "completed",
      "source": "id-card",
      "policyInfo": {
        "carrier": "Progressive",
        "policyType": "auto",
        "policyNumber": "POL123456789",
        "vehicles": [
          {
            "vin": "1HGBH41JXMN109186",
            "year": "2023",
            "make": "Honda",
            "model": "Accord"
          }
        ],
        "namedInsureds": [
          {
            "firstName": "Jane",
            "lastName": "Doe",
            "isPrimary": true
          },
          {
            "firstName": "John",
            "lastName": "Doe",
            "isPrimary": false
          }
        ]
      },
      "media": [
        {
          "url": "https://storage.googleapis.com/ei-media/insurance-cards/id-card-123.jpg",
          "description": "Insurance identification card",
          "contentType": "image/jpeg",
          "size": 512000,
          "createdAt": "2024-01-15T10:25:00.000Z",
          "expiresAt": "2024-01-22T10:25:00.000Z"
        }
      ],
      "verifiedAt": "2024-01-15T10:30:00.000Z"
    }
  }
}
```

```typescript
// Example: Third-Party Verification Completed
{
  "id": "req_123456789",
  "leadId": "lead_987654321",
  "partnerExternalId": "partner_app_456",
  "eventType": "lead_summary",
  "eventTime": "2024-01-15T10:30:00.000Z",
  "status": "verification.completed",
  "summary": {
    "insuranceVerification": {
      "id": "verification_124",
      "status": "completed",
      "source": "third-party",
      "policyInfo": {
        "carrier": "State Farm",
        "policyType": "auto",
        "policyNumber": "SF987654321",
        "vehicles": [
          {
            "vin": "5NPE34AF4FH012345",
            "year": "2022",
            "make": "Toyota",
            "model": "Camry"
          }
        ],
        "namedInsureds": [
          {
            "firstName": "Michael",
            "lastName": "Smith",
            "isPrimary": true
          }
        ]
      },
      "media": [],
      "verifiedAt": "2024-01-15T10:30:00.000Z"
    }
  }
}
```

#### 2. Quote Completed Event

Sent when a quote is successfully generated for a lead.

**Status:** `quote.completed`

**Summary includes:** `quote` (required), may include `insuranceVerification` if verification was completed

```typescript
// Example: Quote Completed (with verification data)
{
  "id": "req_123456789",
  "leadId": "lead_987654321",
  "partnerExternalId": "partner_app_456",
  "eventType": "lead_summary",
  "eventTime": "2024-01-15T11:15:00.000Z",
  "status": "quote.completed",
  "summary": {
    "insuranceVerification": {
      "id": "verification_123",
      "status": "completed",
      "source": "id-card",
      "policyInfo": {
        "carrier": "Progressive",
        "policyType": "auto",
        "policyNumber": "POL123456789",
        "vehicles": [
          {
            "vin": "1HGBH41JXMN109186",
            "year": "2023",
            "make": "Honda",
            "model": "Accord"
          }
        ],
        "namedInsureds": [
          {
            "firstName": "Jane",
            "lastName": "Doe",
            "isPrimary": true
          }
        ]
      },
      "media": [
        {
          "url": "https://storage.googleapis.com/ei-media/insurance-cards/id-card-123.jpg",
          "description": "Insurance identification card",
          "contentType": "image/jpeg",
          "size": 512000,
          "createdAt": "2024-01-15T10:25:00.000Z",
          "expiresAt": "2024-01-22T10:25:00.000Z"
        }
      ],
      "verifiedAt": "2024-01-15T10:30:00.000Z"
    },
    "quote": {
      "id": "quote_456",
      "status": "completed",
      "carrier": "Geico",
      "totalPremiumCents": 120000, // $1,200.00
      "savingsAmountCents": 30000,  // $300.00 savings vs current policy
      "createdAt": "2024-01-15T11:15:00.000Z"
    }
  }
}
```

```typescript
// Example: Quote Completed (without verification data)
{
  "id": "req_123456789",
  "leadId": "lead_987654321",
  "partnerExternalId": "partner_app_456",
  "eventType": "lead_summary",
  "eventTime": "2024-01-15T11:15:00.000Z",
  "status": "quote.completed",
  "summary": {
    "quote": {
      "id": "quote_457",
      "status": "completed",
      "carrier": "Allstate",
      "totalPremiumCents": 150000, // $1,500.00
      "createdAt": "2024-01-15T11:15:00.000Z"
    }
  }
}
```

#### 3. Quote Viewed Event

Sent when a lead views a quote.

**Status:** `quote.viewed`

**Summary includes:** `quote` (required)

```typescript
// Example: Quote Viewed
{
  "id": "req_123456789",
  "leadId": "lead_987654321",
  "partnerExternalId": "partner_app_456",
  "eventType": "lead_summary",
  "eventTime": "2024-01-15T11:30:00.000Z",
  "status": "quote.viewed",
  "summary": {
    "quote": {
      "id": "quote_456",
      "status": "viewed",
      "carrier": "Geico",
      "totalPremiumCents": 120000,
      "savingsAmountCents": 30000,
      "createdAt": "2024-01-15T11:15:00.000Z",
      "viewedAt": "2024-01-15T11:30:00.000Z"
    }
  }
}
```

#### 4. Policy Bound Event

Sent when a lead successfully binds a policy.

**Status:** `policy.bound`

**Summary includes:** `policy` (required)
```typescript
// Example: Policy Bound
{
  "id": "req_123456789",
  "leadId": "lead_987654321",
  "partnerExternalId": "partner_app_456",
  "eventType": "lead_summary",
  "eventTime": "2024-01-15T12:00:00.000Z",
  "status": "policy.bound",
  "summary": {
    "policy": {
      "id": "policy_789",
      "carrier": "Geico",
      "boundAt": "2024-01-15T12:00:00.000Z"
    }
  }
}
```

#### 5. Error Event

Sent when a lead encounters an error state.

**Status:** `error`

**Summary includes:** May include partial data depending on what was completed before the error

```typescript
// Example: Error Event
{
  "id": "req_123456789",
  "leadId": "lead_987654321",
  "partnerExternalId": "partner_app_456",
  "eventType": "lead_summary",
  "eventTime": "2024-01-15T11:45:00.000Z",
  "status": "error",
  "summary": {}
}
```

#### TypeScript Type Definitions

For TypeScript users, here are the complete type definitions:

```typescript
interface LeadStatusSummaryEvent {
  id: string;
  leadId: string;
  partnerExternalId: string;
  eventType: "lead_summary";
  eventTime: string; // ISO 8601 timestamp
  status: "verification.completed" | "quote.completed" | "quote.viewed" | "policy.bound" | "error";
  summary: {
    insuranceVerification?: InsuranceVerificationSummary;
    quote?: QuoteSummary;
    policy?: PolicySummary;
  };
}

interface InsuranceVerificationSummary {
  id: string;
  status: "pending" | "failed" | "completed";
  source: "id-card" | "third-party";
  policyInfo?: {
    carrier: string;
    policyType: "auto";
    policyNumber?: string;
    vehicles: Array<{
      vin?: string;
      year?: string;
      make?: string;
      model?: string;
    }>;
    namedInsureds: Array<{
      firstName?: string;
      lastName?: string;
      isPrimary?: boolean;
    }>;
  };
  media: Array<{
    url: string;
    description: string;
    contentType: string;
    size: number;
    createdAt: string; // ISO 8601 timestamp
    expiresAt: string; // ISO 8601 timestamp
  }>;
  verifiedAt: string; // ISO 8601 timestamp
}

interface QuoteSummary {
  id: string;
  status: "completed" | "viewed";
  carrier: string;
  totalPremiumCents: number;
  savingsAmountCents?: number;
  createdAt: string; // ISO 8601 timestamp
  viewedAt?: string; // ISO 8601 timestamp
}

interface PolicySummary {
  id: string;
  carrier: string;
  boundAt: string; // ISO 8601 timestamp
}
```

