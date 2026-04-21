import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { learnExtractionPattern, ExtractableField } from "@/lib/extraction-patterns";

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const status = searchParams.get("status");
    const search = searchParams.get("search");
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "20");
    const skip = (page - 1) * limit;

    const where: any = {};
    
    if (status && status !== "all") {
      where.status = status;
    }
    
    if (search) {
      where.OR = [
        { claimNumber: { contains: search } },
        { clientName: { contains: search } },
        { vehicleRegistration: { contains: search } },
      ];
    }

    const [claims, total] = await Promise.all([
      db.claim.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          insuranceCompany: {
            select: { id: true, name: true, folderName: true },
          },
        },
      }),
      db.claim.count({ where }),
    ]);

    return NextResponse.json({
      claims,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("Claims GET error:", error);
    return NextResponse.json(
      { error: "Failed to fetch claims" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    const claim = await db.claim.create({
      data: {
        claimNumber: body.claimNumber,
        clientName: body.clientName,
        clientEmail: body.clientEmail,
        clientPhone: body.clientPhone,
        claimType: body.claimType,
        incidentDate: body.incidentDate ? new Date(body.incidentDate) : null,
        incidentDescription: body.incidentDescription,
        vehicleRegistration: body.vehicleRegistration,
        vehicleMake: body.vehicleMake,
        vehicleModel: body.vehicleModel,
        propertyAddress: body.propertyAddress,
        excessAmount: body.excessAmount ? parseFloat(body.excessAmount) : null,
        insuranceCompanyId: body.insuranceCompanyId,
        status: body.status || "NEW",
        processedBy: "MANUAL",
        sourceEmailId: body.sourceEmailId,
        sourceEmailSubject: body.sourceEmailSubject,
        sourceEmailFrom: body.sourceEmailFrom,
        sourceEmailDate: body.sourceEmailDate ? new Date(body.sourceEmailDate) : null,
      },
    });

    // Create audit log
    await db.auditLog.create({
      data: {
        action: "claim_created",
        entityType: "claim",
        entityId: claim.id,
        details: JSON.stringify({ claimNumber: claim.claimNumber }),
        status: "SUCCESS",
        processedBy: "MANUAL",
        claimId: claim.id,
      },
    });

    // ====== LEARNING INTEGRATION ======
    // Learn from the claim data if we have source text and company
    
    if (body.sourceText && body.insuranceCompanyId) {
      // Learn extraction patterns for each field that was filled
      const fieldsToLearn: Array<{ field: string; value: string | null }> = [
        { field: "claimNumber", value: body.claimNumber },
        { field: "policyNumber", value: body.policyNumber },
        { field: "clientName", value: body.clientName },
        { field: "clientEmail", value: body.clientEmail },
        { field: "clientPhone", value: body.clientPhone },
        { field: "vehicleRegistration", value: body.vehicleRegistration },
        { field: "vehicleMake", value: body.vehicleMake },
        { field: "vehicleModel", value: body.vehicleModel },
        { field: "excessAmount", value: body.excessAmount ? String(body.excessAmount) : null },
      ];

      for (const { field, value } of fieldsToLearn) {
        if (value) {
          await learnExtractionPattern(
            body.insuranceCompanyId,
            field as ExtractableField,
            null, // Original value - we don't have AI extraction to compare
            value,
            body.sourceText,
            body.sourceEmailId
          ).catch(err => console.error(`Failed to learn ${field}:`, err));
        }
      }
    }

    // Learn claim number format
    if (body.claimNumber && body.insuranceCompanyId) {
      await learnClaimNumberFormat(body.insuranceCompanyId, body.claimNumber)
        .catch(err => console.error("Failed to learn claim number format:", err));
    }

    // Update sender pattern stats if we know the domain
    if (body.sourceEmailDomain && body.insuranceCompanyId) {
      await updateSenderPatternOnClaim(body.sourceEmailDomain, body.insuranceCompanyId)
        .catch(err => console.error("Failed to update sender pattern:", err));
    }

    // Link domain to company if not already linked
    if (body.sourceEmailDomain && body.insuranceCompanyId) {
      await linkDomainToCompany(body.sourceEmailDomain, body.insuranceCompanyId)
        .catch(err => console.error("Failed to link domain:", err));
    }

    return NextResponse.json(claim);
  } catch (error) {
    console.error("Claims POST error:", error);
    return NextResponse.json(
      { error: "Failed to create claim" },
      { status: 500 }
    );
  }
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

  const patterns = [
    // Company-Year-Number: STM-2024-12345
    { regex: /^([A-Z]{2,4})[-/](\d{4})[-/](\d{4,8})$/, format: "AAA-YYYY-NNNNN", sep: "-" },
    // Company/Number/ShortYear: OUT/123456/24
    { regex: /^([A-Z]{2,4})[-/](\d{5,8})[-/](\d{2})$/, format: "AAA/NNNNNN/YY", sep: "/" },
    // Company-Number: HOL-12345678
    { regex: /^([A-Z]{2,4})[-/](\d{5,10})$/, format: "AAA-NNNNNNNN", sep: "-" },
    // Company+Number: CLM123456
    { regex: /^([A-Z]{2,4})(\d{5,10})$/, format: "AAANNNNNN", sep: "" },
  ];

  for (const pattern of patterns) {
    const match = claimNumber.match(pattern.regex);
    if (match) {
      const prefix = match[1];
      const hasYear = /\d{4}/.test(match[2]) || /\d{2}$/.test(claimNumber);
      const yearPosition = hasYear ? (pattern.format.includes("YYYY") ? 2 : 3) : null;
      
      let regexPattern: string;
      if (match[0].includes("/") || match[0].includes("-")) {
        const sep = match[0].includes("/") ? "/" : "-";
        const parts = claimNumber.split(sep);
        regexPattern = `^${prefix}${sep}(\\d{${parts[1]?.length || 4}})${parts[2] ? sep + '(\\d{' + parts[2].length + '})' : ''}$`;
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

  // Fallback
  const prefixMatch = claimNumber.match(/^([A-Z]{2,4})/);
  if (prefixMatch) {
    return {
      formatPattern: `${prefixMatch[1]}-XXXXX`,
      prefix: prefixMatch[1],
      separator: claimNumber.includes("/") ? "/" : claimNumber.includes("-") ? "-" : "",
      hasYear: /\d{4}/.test(claimNumber),
      yearPosition: null,
      numberLength: null,
      regexPattern: `^${prefixMatch[1]}[-/]?(\\d{4,10})$`,
    };
  }

  return null;
}

// Update sender pattern when a claim is created
async function updateSenderPatternOnClaim(
  senderDomain: string,
  insuranceCompanyId: string
): Promise<void> {
  try {
    const pattern = await db.senderPattern.findUnique({
      where: { senderDomain },
    });

    if (pattern) {
      await db.senderPattern.update({
        where: { id: pattern.id },
        data: {
          newClaimCount: { increment: 1 },
          correctCount: { increment: 1 },
          accuracyRate: ((pattern.correctCount + 1) / (pattern.correctCount + pattern.correctedCount + 1)) * 100,
        },
      });
    } else {
      // Create new sender pattern
      await db.senderPattern.create({
        data: {
          senderDomain,
          totalEmails: 1,
          newClaimCount: 1,
          correctCount: 1,
          accuracyRate: 100,
          automationLevel: "manual",
        },
      });
    }
  } catch (error) {
    console.error("Failed to update sender pattern:", error);
  }
}

// Link domain to company if not already linked
async function linkDomainToCompany(
  senderDomain: string,
  insuranceCompanyId: string
): Promise<void> {
  try {
    // Check if domain suggestion exists
    const suggestion = await db.domainSuggestion.findUnique({
      where: { senderDomain },
    });

    if (suggestion && suggestion.status === "pending") {
      // Auto-approve the suggestion
      await db.domainSuggestion.update({
        where: { id: suggestion.id },
        data: {
          status: "auto_approved",
          linkedCompanyId: insuranceCompanyId,
          reviewedAt: new Date(),
        },
      });
    }

    // Also update the company's sender domains
    const company = await db.insuranceCompany.findUnique({
      where: { id: insuranceCompanyId },
    });

    if (company) {
      const existingDomains = company.senderDomains 
        ? JSON.parse(company.senderDomains) as string[] 
        : [];
      
      if (!existingDomains.includes(senderDomain)) {
        existingDomains.push(senderDomain);
        await db.insuranceCompany.update({
          where: { id: insuranceCompanyId },
          data: { senderDomains: JSON.stringify(existingDomains) },
        });
      }
    }
  } catch (error) {
    console.error("Failed to link domain to company:", error);
  }
}
