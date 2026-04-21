# STEFCO Claims Dashboard - Developer Documentation

## Table of Contents
1. [Architecture Overview](#architecture-overview)
2. [Database Schema](#database-schema)
3. [AI Pipeline](#ai-pipeline)
4. [Learning System](#learning-system)
5. [API Reference](#api-reference)
6. [Component Guide](#component-guide)
7. [Configuration](#configuration)
8. [Testing & Debugging](#testing--debugging)

---

## Architecture Overview

### System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        EMAIL SOURCES                             │
│                  (Insurance Companies via IMAP)                  │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                    EMAIL POLLER SERVICE                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ IMAP Fetch   │→ │ Deduplication│→ │ Domain Detect│          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                      EMAIL QUEUE (DB)                            │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ status: PENDING → AI_ANALYZED → USER_REVIEWING → ...    │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                     MULTI-AGENT AI PIPELINE                      │
│                                                                  │
│  ┌────────────┐   ┌────────────┐   ┌────────────┐              │
│  │  INTAKE    │→  │ EXTRACTION │→  │  DECISION  │              │
│  │   AGENT    │   │   AGENT    │   │   AGENT    │              │
│  │            │   │            │   │            │              │
│  │ Classify:  │   │ Extract:   │   │ Decide:    │              │
│  │ NEW_CLAIM  │   │ - Claim #  │   │ PROCEED    │              │
│  │ IGNORE     │   │ - Name     │   │ REVIEW     │              │
│  │ OTHER      │   │ - Vehicle  │   │ REJECT     │              │
│  └────────────┘   └────────────┘   └────────────┘              │
│        │                │                │                      │
│        └────────────────┴────────────────┘                      │
│                         │                                        │
│                         ▼                                        │
│              ┌─────────────────────┐                            │
│              │  ENSEMBLE ENGINE    │                            │
│              │  - Regex patterns   │                            │
│              │  - AI extraction    │                            │
│              │  - Template match   │                            │
│              │  - Position-based   │                            │
│              └─────────────────────┘                            │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                      USER REVIEW QUEUE                           │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Email + AI Suggestion → User Confirms/Corrects         │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                    LEARNING ENGINE                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │   Patterns   │  │  Templates   │  │  Weights     │          │
│  │  Learning    │  │  Detection   │  │  Updates     │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │   Negative   │  │   Cross-     │  │   Active     │          │
│  │   Patterns   │  │   Field      │  │   Learning   │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                    CLAIMS DATABASE                               │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Claims + Feedback + Patterns + Audit Logs              │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### Progressive Automation Model

```
┌─────────────────────────────────────────────────────────────────┐
│                   AUTOMATION PROGRESSION                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Level 0: MANUAL                                                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ All emails require human review and data entry         │    │
│  │ Confidence: 0-50% | Accuracy: Unknown                  │    │
│  └─────────────────────────────────────────────────────────┘    │
│                         │                                        │
│                         ▼ (5+ correct extractions)               │
│                                                                  │
│  Level 1: SEMI-AUTO                                              │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ AI suggests values, human confirms                      │    │
│  │ Confidence: 50-75% | Accuracy: 75%+                    │    │
│  └─────────────────────────────────────────────────────────┘    │
│                         │                                        │
│                         ▼ (10+ correct extractions, 90%+ acc)    │
│                                                                  │
│  Level 2: AUTO                                                   │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ Claims created automatically, sampled for QA            │    │
│  │ Confidence: 75-95% | Accuracy: 90%+                    │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Database Schema

### Core Tables

#### InsuranceCompany
```prisma
model InsuranceCompany {
  id            String   @id @default(cuid())
  name          String   @unique
  shortName     String?
  folderName    String
  senderDomains String?  // JSON array
  contactEmail  String?
  contactPhone  String?
  isActive      Boolean  @default(true)
  
  // Relations
  claims              Claim[]
  learningPatterns    LearningPattern[]
  extractionPatterns  ExtractionPattern[]
  classificationKnowledge ClassificationKnowledge[]
}
```

#### Claim
```prisma
model Claim {
  id                    String   @id @default(cuid())
  claimNumber           String   @unique
  clientName            String?
  clientEmail           String?
  clientPhone           String?
  claimType             String?  // MOTOR, PROPERTY, LIABILITY, etc.
  incidentDate          DateTime?
  incidentDescription   String?
  vehicleRegistration   String?
  vehicleMake           String?
  vehicleModel          String?
  propertyAddress       String?
  excessAmount          Float?
  status                String   @default("NEW")
  processingStage       String   @default("INTAKE")
  
  // AI confidence scores
  classificationConfidence Float?
  extractionConfidence     Float?
  
  // Source tracking
  sourceEmailId        String?
  sourceEmailSubject   String?
  sourceEmailFrom      String?
  sourceEmailDate      DateTime?
  
  // Relationships
  insuranceCompanyId   String?
  insuranceCompany     InsuranceCompany? @relation(...)
  
  // Processing metadata
  processedBy          String?  // AUTO or user ID
  processedAt          DateTime?
  reviewedBy           String?
  reviewedAt           DateTime?
}
```

#### EmailQueue
```prisma
model EmailQueue {
  id                String   @id @default(cuid())
  messageId         String   @unique  // SHA-256 hash
  
  // Email content
  subject           String?
  from              String?
  fromDomain        String?
  bodyText          String?
  bodyHtml          String?
  attachments       String?  // JSON
  
  // AI analysis
  aiClassification  String?
  aiConfidence      Float?
  aiReasoning       String?
  aiExtractedData   String?  // JSON
  
  // Processing status
  status            String   @default("PENDING")
  processingRoute   String?
  
  // Learning hints
  learningHintsCount Int     @default(0)
  
  // Result tracking
  createdClaimId    String?
  ignoreReason      String?
}
```

### Learning Tables

#### ExtractionPattern
```prisma
model ExtractionPattern {
  id                  String   @id
  insuranceCompanyId  String
  fieldType           String   // claimNumber, policyNumber, etc.
  
  // Pattern definition
  patternType         String   // regex, keyword, position
  patternValue        String   // Actual regex/pattern
  
  // Metadata
  description         String?
  exampleMatch        String?
  
  // Performance
  confidence          Int      @default(70)
  successCount        Int      @default(0)
  failureCount        Int      @default(0)
  priority            Int      @default(0)
  
  isActive            Boolean  @default(true)
  isSystemPattern     Boolean  @default(false)
}
```

#### ClaimNumberFormat
```prisma
model ClaimNumberFormat {
  id                  String   @id
  insuranceCompanyId  String
  
  // Format definition
  formatPattern       String   // e.g., "STM-YYYY-NNNNN"
  prefix              String?  // e.g., "STM"
  separator           String?  // e.g., "-"
  
  // Number structure
  hasYear             Boolean  @default(false)
  yearPosition        Int?
  numberLength        Int?
  
  // Matching
  regexPattern        String
  example             String?
  
  // Performance
  matchCount          Int      @default(0)
  confidence          Int      @default(70)
}
```

#### FieldRelationship
```prisma
model FieldRelationship {
  id                  String   @id
  insuranceCompanyId  String?
  
  // Relationship
  primaryField        String   // e.g., "claimType"
  primaryValue        String?  // e.g., "MOTOR"
  dependentField      String   // e.g., "vehicleRegistration"
  
  // Probability
  occurrenceCount     Int      @default(0)
  probability         Float    @default(0)  // P(dependent|primary)
  expectedPattern     String?
}
```

#### NegativePattern
```prisma
model NegativePattern {
  id                  String   @id
  insuranceCompanyId  String?
  
  // What was wrong
  fieldType           String
  incorrectValue      String
  
  // Context
  contextPattern      String?
  rejectionReason     String?
  
  // Statistics
  occurrenceCount     Int      @default(1)
}
```

---

## AI Pipeline

### Agent 1: Intake Agent (Classification)

**Purpose**: Determine if email is a new claim appointment

**Prompt Structure**:
```
You are the Intake Agent for Stefco Consultants Insurance Claims.

Classify into:
- NEW_CLAIM: New claim assessment/appointment request
- IGNORE: Spam, marketing, out-of-office, irrelevant
- MISSING_INFO: Related but lacks essential info
- OTHER: Unclear or miscellaneous

Indicators of NEW_CLAIM:
- "New assessment", "New appointment", "NUWE EIS"
- "You are appointed"
- Attachments related to claims
- Insurance company correspondence

Rules:
- Only mark NEW_CLAIM with clear evidence
- If unsure, return OTHER
```

**Output**:
```json
{
  "classification": "NEW_CLAIM",
  "confidence": 85,
  "reasoning": "Email from Santam with claim reference and vehicle details"
}
```

### Agent 2: Extraction Agent

**Purpose**: Extract structured claim data

**Methods**:

1. **Ensemble Extraction** (enhanced-extract API):
```typescript
const result = await ensembleExtract(text, "claimNumber", insuranceCompanyId);
// Combines: regex, AI, template, position methods
// Returns: { value, confidence, contributingMethods }
```

2. **AI Extraction** (LLM-based):
```
Extract the following fields:
- claimNumber: Main claim reference
- clientName: Client/claimant name
- claimType: MOTOR, PROPERTY, LIABILITY, etc.
- vehicleRegistration: Vehicle reg (if motor)
- excessAmount: Excess amount
```

3. **Attachment Extraction** (VLM-based):
```typescript
const result = await extractFromAttachment(attachment, insuranceCompanyId);
// Uses VLM to read claim documents from images
```

### Agent 3: Decision Agent

**Purpose**: Decide if claim can be processed automatically

**Decision Logic**:
```typescript
if (claimNumberConfidence >= 70 && overallConfidence >= 75) {
  return "PROCEED"; // Create claim automatically
} else if (claimNumberConfidence >= 50) {
  return "REVIEW"; // Send to review queue
} else {
  return "REJECT"; // Missing critical fields
}
```

---

## Learning System

### Pattern Learning Flow

```typescript
// 1. User creates/edits claim
await createClaim(claimData);

// 2. System learns from each field
for (const field of filledFields) {
  await learnExtractionPattern(
    insuranceCompanyId,
    field,
    originalValue,
    correctedValue,
    sourceText
  );
}

// 3. Learn claim number format
await learnClaimNumberFormat(companyId, claimNumber);

// 4. Update sender pattern accuracy
await updateSenderAccuracy(domain, wasCorrect);

// 5. Learn field relationships
await learnFieldRelationship(companyId, primaryField, primaryValue, dependentField, dependentValue);
```

### Ensemble Extraction

```typescript
export async function ensembleExtract(
  text: string,
  field: ExtractableField,
  insuranceCompanyId: string | null
): Promise<EnsembleResult> {
  // Get confidence weights
  const weights = await getConfidenceWeights(insuranceCompanyId, field);
  
  // Run all methods
  const results = [
    await extractWithRegex(text, field, insuranceCompanyId),
    await extractWithTemplate(text, field, insuranceCompanyId),
    await extractWithPosition(text, field, insuranceCompanyId),
  ];
  
  // Combine with weighted voting
  const valueGroups = groupByNormalizedValue(results);
  
  // Return highest weighted value
  return getBestValue(valueGroups);
}
```

### Bayesian Confidence Updates

```typescript
// When extraction is confirmed correct:
newWeight = (successCount + 1) / (totalAttempts + 2)

// When extraction is corrected:
newWeight = successCount / (totalAttempts + 2)

// This gives Bayesian posterior probability
```

### Cross-Field Validation

```typescript
// Learned relationship:
// When claimType = "MOTOR", vehicleRegistration is expected (90% probability)

// During extraction:
if (extractedFields.claimType === "MOTOR" && !extractedFields.vehicleRegistration) {
  warnings.push({
    field: "vehicleRegistration",
    message: "Motor claims typically include vehicle registration"
  });
}
```

---

## API Reference

### Claims API

#### Create Claim
```http
POST /api/claims
Content-Type: application/json

{
  "claimNumber": "STM-2024-12345",
  "clientName": "John Smith",
  "claimType": "MOTOR",
  "vehicleRegistration": "CA123456",
  "insuranceCompanyId": "company-id",
  "sourceText": "Email body...",
  "sourceEmailId": "email-id"
}
```

**Triggers**:
- Pattern learning for each field
- Claim number format learning
- Domain-to-company linking
- Sender pattern update

#### Submit Correction
```http
POST /api/claim-feedback
Content-Type: application/json

{
  "claimId": "claim-id",
  "fieldName": "vehicleRegistration",
  "originalValue": "CA12345",
  "correctedValue": "CA123456",
  "insuranceCompanyId": "company-id",
  "sourceText": "Full email text..."
}
```

**Triggers**:
- Pattern update for field
- Negative pattern for wrong value
- Confidence weight adjustment

### Enhanced Extraction API

#### Extract with Ensemble
```http
POST /api/enhanced-extract
Content-Type: application/json

{
  "emailId": "email-id",
  "subject": "New Claim - STM-2024-12345",
  "from": "claims@santam.co.za",
  "fromDomain": "santam.co.za",
  "bodyText": "Email body...",
  "attachments": [
    {
      "filename": "claim_form.jpg",
      "contentType": "image/jpeg",
      "content": "base64..."
    }
  ],
  "insuranceCompanyId": "company-id"
}
```

**Response**:
```json
{
  "classification": { "classification": "NEW_CLAIM", "confidence": 85 },
  "extraction": {
    "claimNumber": "STM-2024-12345",
    "clientName": "John Smith",
    "claimType": "MOTOR"
  },
  "ensembleResults": {
    "claimNumber": {
      "value": "STM-2024-12345",
      "confidence": 92,
      "contributingMethods": ["regex", "template"]
    }
  },
  "validation": {
    "warnings": [],
    "suggestions": []
  },
  "clarification": {
    "needsClarification": false,
    "uncertainFields": []
  }
}
```

#### Submit Learning Feedback
```http
PUT /api/enhanced-extract
Content-Type: application/json

{
  "emailId": "email-id",
  "insuranceCompanyId": "company-id",
  "extractedFields": { ... },
  "corrections": {
    "vehicleRegistration": "CA123456"
  },
  "wasAccepted": false
}
```

---

## Component Guide

### Main Sections

```tsx
// src/app/page.tsx
export default function Dashboard() {
  const [activeSection, setActiveSection] = useState("dashboard");
  
  return (
    <div className="flex h-screen">
      <AppSidebar activeSection={activeSection} onNavigate={setActiveSection} />
      <main className="flex-1 overflow-auto">
        {activeSection === "dashboard" && <DashboardSection />}
        {activeSection === "inbox" && <InboxSection />}
        {activeSection === "claims" && <ClaimsSection />}
        {activeSection === "learning" && <LearningSection />}
        {activeSection === "insurance" && <InsuranceSection />}
        {activeSection === "analytics" && <AnalyticsSection />}
        {activeSection === "settings" && <SettingsSection />}
      </main>
    </div>
  );
}
```

### InboxSection

**Features**:
- Email queue list with status badges
- AI classification display
- Claim creation form
- Feedback modal for rejections
- Follow-up detection indicators
- Manual poll button

### LearningSection

**Tabs**:
- **Patterns**: Learning patterns by sender
- **Senders**: Sender profiles with automation levels
- **Knowledge**: Classification knowledge base
- **Ignore Rules**: Auto-ignore patterns
- **Rejection Feedback**: Structured feedback history
- **Thread Detection**: Follow-up patterns

### InsuranceSection

**Tabs**:
- **Companies**: Insurance company management
- **Extraction Patterns**: Company-specific patterns
- **Claim Number Formats**: SA insurance formats

---

## Configuration

### Environment Variables

```env
# Database
DATABASE_URL="file:./dev.db"

# AI Provider
ZAI_API_KEY="your-api-key"

# Optional: Email Poller
IMAP_HOST="imap.provider.com"
IMAP_PORT="993"
IMAP_USER="email@domain.com"
IMAP_PASSWORD="password"
```

### System Config (Database)

```sql
INSERT INTO system_config (key, value) VALUES
  ('IMAP_HOST', 'imap.provider.com'),
  ('IMAP_PORT', '993'),
  ('IMAP_USER', 'email@domain.com'),
  ('IMAP_PASSWORD', 'password'),
  ('IMAP_SSL', 'true'),
  ('POLLING_INTERVAL', '300000'),  -- 5 minutes
  ('AUTO_APPROVE_THRESHOLD', '90'),
  ('MIN_CORRECTIONS_FOR_AUTO', '10');
```

---

## Testing & Debugging

### Manual Email Classification Test

```bash
curl -X POST http://localhost:3000/api/process-email \
  -H "Content-Type: application/json" \
  -d '{
    "subject": "New Claim - STM-2024-12345",
    "from": "claims@santam.co.za",
    "bodyText": "Dear Sir/Madam, We hereby appoint you to assess..."
  }'
```

### Pattern Testing

```bash
# Test claim number against known formats
curl -X PUT http://localhost:3000/api/claim-number-formats \
  -H "Content-Type: application/json" \
  -d '{ "claimNumber": "STM-2024-12345" }'
```

### View Learning Stats

```bash
curl http://localhost:3000/api/learning?type=stats
```

### Debug Extraction

```typescript
import { ensembleExtract } from '@/lib/enhanced-learning';

const result = await ensembleExtract(
  "Claim Number: STM-2024-12345\nClient: John Smith",
  "claimNumber",
  "company-id"
);

console.log(result);
// {
//   value: "STM-2024-12345",
//   confidence: 85,
//   method: "ensemble",
//   contributingMethods: [...]
// }
```

---

## Troubleshooting

### Common Issues

1. **Emails not being fetched**
   - Check IMAP configuration in Settings
   - Verify credentials and SSL settings
   - Check Email Poller service is running

2. **Low extraction confidence**
   - Add company-specific patterns
   - Verify claim number formats are seeded
   - Check if domain is linked to company

3. **Patterns not learning**
   - Ensure sourceText is passed when creating claims
   - Check claim-feedback API is called for corrections
   - Verify insuranceCompanyId is set

4. **Automation level not progressing**
   - Need 5+ correct extractions for semi-auto
   - Need 10+ correct extractions with 90%+ accuracy for auto
   - Check sender pattern stats

---

## Performance Optimization

### Database Indexes

```sql
CREATE INDEX idx_claims_status ON claims(status);
CREATE INDEX idx_claims_company ON claims(insuranceCompanyId);
CREATE INDEX idx_email_status ON email_queue(status);
CREATE INDEX idx_email_domain ON email_queue(fromDomain);
CREATE INDEX idx_patterns_company_field ON extraction_patterns(insuranceCompanyId, fieldType);
```

### Caching Strategy

- Learning patterns cached per domain
- Confidence weights cached per company/field
- Template fingerprints cached for matching

### Batch Processing

```typescript
// Process emails in batches
const emails = await fetchEmails(50);
await Promise.all(emails.map(processEmail));
```

---

## Future Enhancements

1. **PDF Processing** - Add PDF text extraction
2. **OCR for Scanned Docs** - Integrate OCR service
3. **Multi-language Support** - Afrikaans, Zulu, etc.
4. **Mobile App** - React Native companion
5. **API Integrations** - Insurance company APIs
6. **Advanced Analytics** - ML-based insights
7. **Workflow Automation** - Custom claim flows

---

*Last Updated: 2025*
