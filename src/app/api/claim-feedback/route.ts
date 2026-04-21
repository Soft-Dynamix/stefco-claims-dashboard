import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { learnExtractionPattern, ExtractableField } from "@/lib/extraction-patterns";

// GET - Fetch feedback for a claim
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const claimId = searchParams.get("claimId");

    if (!claimId) {
      return NextResponse.json({ error: "Claim ID required" }, { status: 400 });
    }

    const feedback = await db.claimFeedback.findMany({
      where: { claimId },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(feedback);
  } catch (error) {
    console.error("Claim feedback GET error:", error);
    return NextResponse.json(
      { error: "Failed to fetch feedback" },
      { status: 500 }
    );
  }
}

// POST - Submit field correction and learn from it
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { 
      claimId, 
      fieldName, 
      originalValue, 
      correctedValue,
      insuranceCompanyId,
      emailQueueId,
      sourceText,
      notes 
    } = body;

    if (!claimId || !fieldName || !correctedValue) {
      return NextResponse.json({ 
        error: "Claim ID, field name, and corrected value required" 
      }, { status: 400 });
    }

    // Create feedback record
    const feedback = await db.claimFeedback.create({
      data: {
        claimId,
        feedbackType: "corrected",
        fieldName,
        originalValue,
        correctedValue,
        notes,
      },
    });

    // Update the claim with corrected value
    const updateData: Record<string, any> = {};
    updateData[fieldName] = correctedValue;
    
    await db.claim.update({
      where: { id: claimId },
      data: updateData,
    });

    // Learn from this correction
    if (sourceText && isValidExtractableField(fieldName)) {
      await learnExtractionPattern(
        insuranceCompanyId,
        fieldName as ExtractableField,
        originalValue,
        correctedValue,
        sourceText,
        emailQueueId
      );
    }

    // If claim number was corrected, learn the format pattern
    if (fieldName === "claimNumber" && insuranceCompanyId && correctedValue) {
      await learnClaimNumberFormat(insuranceCompanyId, correctedValue);
    }

    // Update sender pattern accuracy
    if (insuranceCompanyId) {
      await updateSenderPatternAccuracy(insuranceCompanyId, true);
    }

    // Create audit log
    await db.auditLog.create({
      data: {
        action: "field_corrected",
        entityType: "claim",
        entityId: claimId,
        details: JSON.stringify({ 
          fieldName, 
          originalValue, 
          correctedValue 
        }),
        status: "SUCCESS",
        processedBy: "MANUAL",
        claimId,
      },
    });

    return NextResponse.json({ 
      success: true, 
      feedback,
      message: "Correction saved and pattern learned" 
    });
  } catch (error) {
    console.error("Claim feedback POST error:", error);
    return NextResponse.json(
      { error: "Failed to save feedback" },
      { status: 500 }
    );
  }
}

// Helper to validate field name
function isValidExtractableField(field: string): boolean {
  const validFields: ExtractableField[] = [
    "claimNumber", "policyNumber", "clientName", "clientEmail",
    "clientPhone", "vehicleRegistration", "vehicleMake", "vehicleModel",
    "propertyAddress", "excessAmount", "incidentDate", "incidentDescription", "claimType"
  ];
  return validFields.includes(field as ExtractableField);
}

// Learn claim number format pattern
async function learnClaimNumberFormat(
  insuranceCompanyId: string, 
  claimNumber: string
): Promise<void> {
  try {
    // Parse the claim number to extract format components
    const formatInfo = parseClaimNumberFormat(claimNumber);
    
    if (!formatInfo) return;

    // Check if this format already exists
    const existing = await db.claimNumberFormat.findFirst({
      where: {
        insuranceCompanyId,
        formatPattern: formatInfo.formatPattern,
      },
    });

    if (existing) {
      // Increment match count
      await db.claimNumberFormat.update({
        where: { id: existing.id },
        data: {
          matchCount: { increment: 1 },
          confidence: Math.min(95, existing.confidence + 2),
        },
      });
    } else {
      // Create new format pattern
      await db.claimNumberFormat.create({
        data: {
          insuranceCompanyId,
          formatPattern: formatInfo.formatPattern,
          prefix: formatInfo.prefix,
          separator: formatInfo.separator,
          hasYear: formatInfo.hasYear,
          yearPosition: formatInfo.yearPosition,
          numberLength: formatInfo.numberLength,
          regexPattern: formatInfo.regexPattern,
          example: claimNumber,
          confidence: 70,
        },
      });
    }
  } catch (error) {
    console.error("Failed to learn claim number format:", error);
  }
}

// Parse claim number to extract format
function parseClaimNumberFormat(claimNumber: string): {
  formatPattern: string;
  prefix: string | null;
  separator: string | null;
  hasYear: boolean;
  yearPosition: number | null;
  numberLength: number | null;
  regexPattern: string;
} | null {
  if (!claimNumber || claimNumber.length < 5) return null;

  // Common SA claim number patterns:
  // STM-2024-12345 (Company-Year-Number)
  // OUT/123456/24 (Company/Number/ShortYear)
  // HOL-12345678 (Company-Number)
  // CLM123456 (Company + Number)

  const patterns = [
    // Company-Year-Number: STM-2024-12345
    {
      regex: /^([A-Z]{2,4})[-/](\d{4})[-/](\d{4,8})$/,
      format: "AAA-YYYY-NNNNN",
      sep: "-",
    },
    // Company/Number/ShortYear: OUT/123456/24
    {
      regex: /^([A-Z]{2,4})[-/](\d{5,8})[-/](\d{2})$/,
      format: "AAA/NNNNNN/YY",
      sep: "/",
    },
    // Company-Number: HOL-12345678
    {
      regex: /^([A-Z]{2,4})[-/](\d{5,10})$/,
      format: "AAA-NNNNNNNN",
      sep: "-",
    },
    // Company+Number: CLM123456
    {
      regex: /^([A-Z]{2,4})(\d{5,10})$/,
      format: "AAANNNNNN",
      sep: "",
    },
  ];

  for (const pattern of patterns) {
    const match = claimNumber.match(pattern.regex);
    if (match) {
      const prefix = match[1];
      const hasYear = /\d{4}/.test(match[2]) || /\d{2}$/.test(claimNumber);
      const yearPosition = hasYear ? (pattern.format.includes("YYYY") ? 2 : 3) : null;
      
      // Build dynamic regex pattern
      let regexPattern: string;
      if (match[0].includes("/") || match[0].includes("-")) {
        const sep = match[0].includes("/") ? "/" : "-";
        const parts = claimNumber.split(sep);
        regexPattern = `^${prefix}${sep}${parts.map((p, i) => {
          if (i === 0) return "";
          if (/^\d{4}$/.test(p)) return "(\\d{4})";
          if (/^\d{2}$/.test(p)) return "(\\d{2})";
          return `(\\d{${p.length},${p.length + 2}})`;
        }).join(sep).slice(1)}$`;
      } else {
        regexPattern = `^${prefix}(\\d{5,10})$`;
      }

      return {
        formatPattern: pattern.format.replace("AAA", prefix),
        prefix,
        separator: pattern.sep,
        hasYear,
        yearPosition,
        numberLength: match[2]?.length || match[3]?.length || null,
        regexPattern,
      };
    }
  }

  // Fallback: generate a basic pattern
  const prefixMatch = claimNumber.match(/^([A-Z]{2,4})/);
  if (prefixMatch) {
    const prefix = prefixMatch[1];
    return {
      formatPattern: `${prefix}-XXXXX`,
      prefix,
      separator: claimNumber.includes("/") ? "/" : claimNumber.includes("-") ? "-" : "",
      hasYear: /\d{4}/.test(claimNumber),
      yearPosition: null,
      numberLength: null,
      regexPattern: `^${prefix}[-/]?(\\d{4,10})$`,
    };
  }

  return null;
}

// Update sender pattern accuracy after correction
async function updateSenderPatternAccuracy(
  insuranceCompanyId: string,
  wasCorrect: boolean
): Promise<void> {
  try {
    const company = await db.insuranceCompany.findUnique({
      where: { id: insuranceCompanyId },
    });

    if (!company?.senderDomains) return;

    const domains = JSON.parse(company.senderDomains) as string[];
    
    for (const domain of domains) {
      const pattern = await db.senderPattern.findUnique({
        where: { senderDomain: domain },
      });

      if (pattern) {
        const newCorrectCount = wasCorrect 
          ? pattern.correctCount + 1 
          : pattern.correctCount;
        const newCorrectedCount = wasCorrect 
          ? pattern.correctedCount 
          : pattern.correctedCount + 1;
        
        const newAccuracy = newCorrectCount + newCorrectedCount > 0
          ? (newCorrectCount / (newCorrectCount + newCorrectedCount)) * 100
          : 0;

        await db.senderPattern.update({
          where: { id: pattern.id },
          data: {
            correctCount: newCorrectCount,
            correctedCount: newCorrectedCount,
            accuracyRate: newAccuracy,
          },
        });
      }
    }
  } catch (error) {
    console.error("Failed to update sender pattern accuracy:", error);
  }
}
