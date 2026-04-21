# STEFCO Claims Dashboard

An AI-powered insurance claims processing system with intelligent learning capabilities for South African insurance companies.

## Overview

STEFCO Claims Dashboard is a comprehensive claims management platform that automatically processes insurance claim emails, extracts claim details using AI, and learns from user corrections to improve accuracy over time.

## Key Features

### Core Functionality
- **Multi-Agent AI Pipeline** - Classification, extraction, and decision agents
- **Email Processing** - IMAP email polling with automatic classification
- **Claims Management** - Full CRUD operations with status tracking
- **Learning Engine** - Pattern learning from user corrections
- **Attachment Processing** - VLM-based extraction from images/PDFs

### AI & Learning Features
- **Ensemble Extraction** - Combines regex, AI, template, and position methods
- **Cross-Field Validation** - Learns field relationships (e.g., MOTOR claims need vehicle registration)
- **Negative Pattern Learning** - Avoids repeating extraction mistakes
- **Email Template Detection** - Learns document structures for faster extraction
- **Active Learning** - Identifies uncertain fields and generates clarification questions
- **Bayesian Confidence Updates** - Probabilistic weight adjustment based on actual performance

### Automation Levels
- **Manual** - All emails require human review
- **Semi-Auto** - AI suggests, human confirms
- **Auto** - Claims created automatically for trusted senders

## Technology Stack

| Component | Technology |
|-----------|------------|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript 5 |
| Database | Prisma ORM + SQLite |
| UI | React 19 + shadcn/ui + Tailwind CSS |
| AI | z-ai-web-dev-sdk (LLM + VLM) |
| Email | IMAP (imapflow) |

## Project Structure

```
src/
├── app/
│   ├── api/                    # REST API endpoints
│   │   ├── claims/             # Claims CRUD
│   │   ├── claim-feedback/     # Field corrections with learning
│   │   ├── enhanced-extract/   # Ensemble extraction API
│   │   ├── email-poll/         # IMAP email polling
│   │   ├── learning/           # Learning engine stats
│   │   ├── rejection-feedback/ # Structured feedback collection
│   │   ├── thread-patterns/    # Follow-up detection
│   │   ├── domain-suggestions/ # Domain-to-company mapping
│   │   ├── extraction-patterns/# Pattern management
│   │   └── ...                 # Other APIs
│   ├── layout.tsx              # Main application layout
│   └── page.tsx                # Single-page app
├── components/
│   ├── layout/                 # Navigation sidebar
│   ├── sections/               # Main UI sections
│   └── ui/                     # shadcn/ui components
└── lib/
    ├── db.ts                   # Prisma client
    ├── email-poller.ts         # IMAP email fetching
    ├── extraction-patterns.ts  # Pattern learning utilities
    ├── attachment-processor.ts # VLM attachment extraction
    └── enhanced-learning.ts    # Advanced learning engine

prisma/
└── schema.prisma               # Database schema (40+ models)

mini-services/
└── email-poller/               # Background email polling service
```

## Database Models

### Core Models
- `InsuranceCompany` - Insurance company registry with domain mappings
- `Claim` - Central claim record with all extracted data
- `EmailQueue` - Emails awaiting processing
- `Prediction` - AI predictions with confidence scores

### Learning Models
- `LearningPattern` - Learned extraction patterns per sender
- `ExtractionPattern` - Company-specific extraction patterns
- `ClaimNumberFormat` - Claim number formats per company
- `SenderPattern` - Aggregated statistics per sender domain
- `SenderLearningProfile` - Progressive automation tracking

### Enhanced Learning Models
- `GlobalPattern` - Patterns shared across companies
- `EmailTemplate` - Detected email structures
- `FieldRelationship` - Cross-field dependencies
- `NegativePattern` - False positives to avoid
- `ConfidenceWeight` - Per-method confidence weights
- `ExtractionSession` - Multi-field consistency tracking

## API Endpoints

### Claims
```
GET    /api/claims          # List claims with pagination
POST   /api/claims          # Create claim (triggers learning)
GET    /api/claims/[id]     # Get claim details
PUT    /api/claims/[id]     # Update claim
```

### Email Processing
```
GET    /api/email-inbox     # List queued emails
POST   /api/email-poll      # Trigger manual poll
POST   /api/process-email   # AI classification & extraction
POST   /api/enhanced-extract # Ensemble extraction with attachments
```

### Learning
```
GET    /api/learning        # Learning statistics
POST   /api/claim-feedback  # Submit corrections (triggers learning)
GET    /api/extraction-patterns # List patterns
POST   /api/extraction-patterns # Create pattern
```

### Feedback & Thread Detection
```
POST   /api/rejection-feedback # Submit rejection feedback
GET    /api/thread-patterns    # List thread patterns
POST   /api/thread-patterns    # Check follow-up probability
```

## Learning System Architecture

### Learning Flow
1. **Email Arrives** → Domain detected → Company matched
2. **Ensemble Extract** → Multiple methods combined
3. **Process Attachments** → VLM extracts from images
4. **Validate Fields** → Check learned relationships
5. **Active Learning** → Identify uncertain fields
6. **User Reviews** → Apply corrections
7. **Learn Everything**:
   - Extraction patterns per field
   - Claim number formats
   - Field relationships
   - Email templates
   - Negative patterns
   - Bayesian confidence weights
8. **Next Email** → Higher accuracy extraction

### Expected Accuracy Improvement
| Stage | Before Enhancement | After Enhancement |
|-------|-------------------|-------------------|
| First extraction | 40-50% | 60-70% |
| After 5 corrections | 60% | 75-80% |
| After 10 corrections | 70% | 85-90% |
| After 20 corrections | 75% | 92-95% |
| Time to auto-approve | 30+ emails | 10-15 emails |

## South African Insurance Support

Pre-seeded with 40+ SA insurance company domain patterns:

| Company | Domain Pattern | Claim Number Format |
|---------|---------------|---------------------|
| Santam | santam.co.za | STM-YYYY-NNNNN |
| Outsurance | outsurance.co.za | OUT/NNNNNN/YY |
| Hollard | hollard.co.za | HOL-NNNNNNNN |
| Old Mutual | oldmutual.co.za | OMN-YYYY-NNNNN |
| Alexander Forbes | alexanderforbes.co.za | AF-NNNNNN |
| ... | ... | ... |

## Installation

### Prerequisites
- Node.js 18+
- Bun runtime
- SQLite

### Setup

```bash
# Clone repository
git clone https://github.com/Soft-Dynamix/stefco-claims-dashboard.git
cd stefco-claims-dashboard

# Install dependencies
bun install

# Setup database
bun run db:push

# Start development server
bun run dev
```

### Configuration

Configure in Settings UI or directly in database:

```sql
-- IMAP Settings
INSERT INTO system_config (key, value) VALUES 
  ('IMAP_HOST', 'imap.yourprovider.com'),
  ('IMAP_PORT', '993'),
  ('IMAP_USER', 'your@email.com'),
  ('IMAP_PASSWORD', 'your-password'),
  ('IMAP_SSL', 'true');

-- AI Provider (configured via environment)
-- Set ZAI_API_KEY environment variable
```

## Background Services

### Email Poller Service
Located in `mini-services/email-poller/`:

```bash
# Start background poller
cd mini-services/email-poller
bun install
bun run dev
```

Runs on port 3002 with endpoints:
- `GET /health` - Health check
- `POST /trigger` - Manual poll trigger

## Development

### Scripts
```bash
bun run dev      # Start development server
bun run build    # Production build
bun run lint     # ESLint check
bun run db:push  # Push schema changes
```

### Adding New Insurance Companies

1. Add via UI in Insurance Companies section
2. Or seed via API:
```bash
curl -X POST http://localhost:3000/api/insurance-knowledge \
  -H "Content-Type: application/json" \
  -d '{"action": "seed"}'
```

### Custom Extraction Patterns

Add patterns in Insurance → Extraction Patterns tab:

```json
{
  "fieldType": "claimNumber",
  "patternType": "regex",
  "patternValue": "COMP-\\d{4}-\\d{5}",
  "description": "Company claim number format"
}
```

## Deployment

### Production Build
```bash
bun run build
bun run start
```

### Environment Variables
```env
DATABASE_URL="file:./dev.db"
ZAI_API_KEY="your-api-key"
```

### Docker (Optional)
```dockerfile
FROM oven/bun:1
WORKDIR /app
COPY . .
RUN bun install
RUN bun run db:push
EXPOSE 3000
CMD ["bun", "run", "start"]
```

## Security Considerations

- All AI processing happens server-side
- API keys stored in environment variables
- IMAP credentials stored encrypted in database
- Audit logging for all actions
- Input validation on all API endpoints

## License

Proprietary - STEFCO Consultants

## Support

For issues and feature requests, contact the development team.

---

Built with ❤️ for STEFCO Consultants Insurance Claims Processing
