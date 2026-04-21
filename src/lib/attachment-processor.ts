/**
 * Attachment Processing Module for STEFCO Claims Dashboard
 * 
 * Handles extraction of claim information from various attachment types:
 * - PDF documents
 * - Images (using VLM for OCR-like extraction)
 * - Word documents
 */

import { VLM } from "z-ai-web-dev-sdk";
import { db } from "./db";

export interface AttachmentInfo {
  filename: string;
  contentType: string;
  size: number;
  content?: Buffer;
}

export interface ExtractedAttachmentData {
  text: string;
  claimNumber: string | null;
  policyNumber: string | null;
  clientName: string | null;
  vehicleRegistration: string | null;
  vehicleMake: string | null;
  vehicleModel: string | null;
  excessAmount: string | null;
  incidentDate: string | null;
  claimType: string | null;
  confidence: number;
  extractionMethod: string;
}

// Supported attachment types
const SUPPORTED_TYPES = {
  pdf: ["application/pdf"],
  image: ["image/jpeg", "image/png", "image/gif", "image/bmp", "image/webp"],
  // doc: ["application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
};

// Determine attachment type
export function getAttachmentType(contentType: string): "pdf" | "image" | "unknown" {
  if (SUPPORTED_TYPES.pdf.includes(contentType)) return "pdf";
  if (SUPPORTED_TYPES.image.includes(contentType)) return "image";
  return "unknown";
}

// Main extraction function for attachments
export async function extractFromAttachment(
  attachment: AttachmentInfo,
  insuranceCompanyId?: string | null
): Promise<ExtractedAttachmentData> {
  const attachmentType = getAttachmentType(attachment.contentType);

  if (attachmentType === "unknown") {
    return {
      text: "",
      claimNumber: null,
      policyNumber: null,
      clientName: null,
      vehicleRegistration: null,
      vehicleMake: null,
      vehicleModel: null,
      excessAmount: null,
      incidentDate: null,
      claimType: null,
      confidence: 0,
      extractionMethod: "unsupported",
    };
  }

  // Get company-specific patterns for context
  const companyPatterns = insuranceCompanyId
    ? await getCompanyPatterns(insuranceCompanyId)
    : null;

  if (attachmentType === "image") {
    return extractFromImage(attachment, companyPatterns);
  }

  // For PDFs, we would need a PDF parsing library
  // For now, return empty - this can be extended with pdf-parse or similar
  return {
    text: "",
    claimNumber: null,
    policyNumber: null,
    clientName: null,
    vehicleRegistration: null,
    vehicleMake: null,
    vehicleModel: null,
    excessAmount: null,
    incidentDate: null,
    claimType: null,
    confidence: 0,
    extractionMethod: "pdf_not_implemented",
  };
}

// Extract from image using VLM
async function extractFromImage(
  attachment: AttachmentInfo,
  companyPatterns: CompanyPatterns | null
): Promise<ExtractedAttachmentData> {
  try {
    const vlm = new VLM();

    // Build context-aware prompt
    const prompt = buildExtractionPrompt(companyPatterns);

    // Convert buffer to base64
    const base64Image = attachment.content?.toString("base64") || "";

    const response = await vlm.chat({
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: {
                url: `data:${attachment.contentType};base64,${base64Image}`,
              },
            },
            {
              type: "text",
              text: prompt,
            },
          ],
        },
      ],
      temperature: 0.1,
    });

    const responseText = response.content || "";

    // Parse the response
    return parseVLMResponse(responseText);
  } catch (error) {
    console.error("Image extraction error:", error);
    return {
      text: "",
      claimNumber: null,
      policyNumber: null,
      clientName: null,
      vehicleRegistration: null,
      vehicleMake: null,
      vehicleModel: null,
      excessAmount: null,
      incidentDate: null,
      claimType: null,
      confidence: 0,
      extractionMethod: "error",
    };
  }
}

// Build context-aware extraction prompt
function buildExtractionPrompt(patterns: CompanyPatterns | null): string {
  let prompt = `You are an insurance claim document analyzer. Extract the following information from this image/document:

**Required Fields:**
- claimNumber: The main claim reference number
- policyNumber: Policy number if visible
- clientName: Full name of the client/claimant
- claimType: MOTOR, PROPERTY, LIABILITY, THEFT, FIRE, or OTHER
- vehicleRegistration: Vehicle registration (if motor claim)
- vehicleMake: Vehicle make (if motor claim)
- vehicleModel: Vehicle model (if motor claim)
- excessAmount: Excess amount as a number only
- incidentDate: Date in YYYY-MM-DD format

**Important Rules:**
1. Only extract what is clearly visible in the document
2. Use null for fields that cannot be found
3. For claim numbers, look for patterns like "Claim No:", "Reference:", or similar
4. For vehicle registrations, use South African format (e.g., CA123456, AB12CD GP)

`;

  // Add company-specific hints if available
  if (patterns) {
    prompt += `\n**Company-Specific Patterns:**\n`;
    if (patterns.claimNumberPrefix) {
      prompt += `- Claim numbers from this company typically start with: ${patterns.claimNumberPrefix}\n`;
    }
    if (patterns.commonFields) {
      prompt += `- This company's documents typically contain: ${patterns.commonFields.join(", ")}\n`;
    }
  }

  prompt += `
**Response Format (JSON only, no markdown):**
{"claimNumber": null, "policyNumber": null, "clientName": null, "claimType": null, "vehicleRegistration": null, "vehicleMake": null, "vehicleModel": null, "excessAmount": null, "incidentDate": null, "confidence": 0-100, "fullText": "extract all visible text"}`;

  return prompt;
}

// Parse VLM response
function parseVLMResponse(response: string): ExtractedAttachmentData {
  try {
    // Try to extract JSON from response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        text: parsed.fullText || "",
        claimNumber: parsed.claimNumber || null,
        policyNumber: parsed.policyNumber || null,
        clientName: parsed.clientName || null,
        vehicleRegistration: parsed.vehicleRegistration || null,
        vehicleMake: parsed.vehicleMake || null,
        vehicleModel: parsed.vehicleModel || null,
        excessAmount: parsed.excessAmount || null,
        incidentDate: parsed.incidentDate || null,
        claimType: parsed.claimType || null,
        confidence: parsed.confidence || 50,
        extractionMethod: "vlm_image",
      };
    }
  } catch (error) {
    console.error("Failed to parse VLM response:", error);
  }

  return {
    text: response,
    claimNumber: null,
    policyNumber: null,
    clientName: null,
    vehicleRegistration: null,
    vehicleMake: null,
    vehicleModel: null,
    excessAmount: null,
    incidentDate: null,
    claimType: null,
    confidence: 0,
    extractionMethod: "vlm_parse_failed",
  };
}

// Company patterns interface
interface CompanyPatterns {
  claimNumberPrefix?: string;
  commonFields?: string[];
  claimNumberFormats?: string[];
}

// Get company-specific patterns
async function getCompanyPatterns(
  insuranceCompanyId: string
): Promise<CompanyPatterns | null> {
  try {
    // Get claim number formats for this company
    const formats = await db.claimNumberFormat.findMany({
      where: {
        insuranceCompanyId,
        isActive: true,
      },
      take: 5,
    });

    // Get extraction patterns
    const patterns = await db.extractionPattern.findMany({
      where: {
        insuranceCompanyId,
        isActive: true,
      },
      take: 20,
    });

    const fieldTypes = [...new Set(patterns.map((p) => p.fieldType))];

    return {
      claimNumberPrefix: formats[0]?.prefix || undefined,
      claimNumberFormats: formats.map((f) => f.regexPattern),
      commonFields: fieldTypes,
    };
  } catch (error) {
    console.error("Failed to get company patterns:", error);
    return null;
  }
}

// Learn attachment patterns after user verification
export async function learnAttachmentPattern(
  insuranceCompanyId: string,
  attachmentType: string,
  fieldName: string,
  extractedValue: string,
  correctedValue: string | null,
  wasCorrect: boolean
): Promise<void> {
  // Store the learning for attachments
  await db.extractionExample.create({
    data: {
      insuranceCompanyId,
      fieldType: fieldName,
      sourceText: `Attachment (${attachmentType})`,
      extractedValue: correctedValue || extractedValue,
      contextBefore: null,
      contextAfter: null,
      learnedFrom: wasCorrect ? "initial_extraction" : "user_correction",
      verified: wasCorrect,
    },
  });

  // If it was a correction, also store as negative pattern for the wrong value
  if (!wasCorrect && extractedValue && correctedValue) {
    await db.negativePattern.create({
      data: {
        insuranceCompanyId,
        fieldType: fieldName,
        incorrectValue: extractedValue,
        contextPattern: `attachment:${attachmentType}`,
        rejectionReason: `Corrected to: ${correctedValue}`,
      },
    });
  }
}

// Process all attachments from an email
export async function processAllAttachments(
  attachments: AttachmentInfo[],
  insuranceCompanyId?: string | null
): Promise<{
  combinedText: string;
  extractedFields: Map<string, { value: string; confidence: number; source: string }>;
}> {
  const combinedText: string[] = [];
  const extractedFields = new Map<string, { value: string; confidence: number; source: string }>();

  for (const attachment of attachments) {
    const result = await extractFromAttachment(attachment, insuranceCompanyId);

    if (result.text) {
      combinedText.push(`--- ${attachment.filename} ---\n${result.text}`);
    }

    // Store extracted fields with confidence scores
    const fields: Array<{ key: keyof ExtractedAttachmentData; value: string | null }> = [
      { key: "claimNumber", value: result.claimNumber },
      { key: "policyNumber", value: result.policyNumber },
      { key: "clientName", value: result.clientName },
      { key: "vehicleRegistration", value: result.vehicleRegistration },
      { key: "vehicleMake", value: result.vehicleMake },
      { key: "vehicleModel", value: result.vehicleModel },
      { key: "excessAmount", value: result.excessAmount },
      { key: "incidentDate", value: result.incidentDate },
      { key: "claimType", value: result.claimType },
    ];

    for (const { key, value } of fields) {
      if (value) {
        const existing = extractedFields.get(key);
        // Keep higher confidence value
        if (!existing || result.confidence > existing.confidence) {
          extractedFields.set(key, {
            value,
            confidence: result.confidence,
            source: attachment.filename,
          });
        }
      }
    }
  }

  return {
    combinedText: combinedText.join("\n\n"),
    extractedFields,
  };
}
