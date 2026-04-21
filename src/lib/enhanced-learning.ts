/**
 * Enhanced Learning Engine for STEFCO Claims Dashboard
 * 
 * Features:
 * - Ensemble extraction methods (regex + AI + template + position)
 * - Cross-field validation and relationships
 * - Negative pattern learning (what NOT to extract)
 * - Email template detection
 * - Active learning for uncertain cases
 * - Bayesian confidence updates
 */

import { db } from "./db";

// =============================================================================
// TYPES
// =============================================================================

export type ExtractableField =
  | "claimNumber"
  | "policyNumber"
  | "clientName"
  | "clientEmail"
  | "clientPhone"
  | "vehicleRegistration"
  | "vehicleMake"
  | "vehicleModel"
  | "propertyAddress"
  | "excessAmount"
  | "incidentDate"
  | "incidentDescription"
  | "claimType";

export interface ExtractionResult {
  field: ExtractableField;
  value: string | null;
  confidence: number;
  method: "regex" | "ai" | "template" | "position" | "ensemble" | "fallback";
  pattern?: string;
  source?: string;
  alternatives?: Array<{ value: string; confidence: number }>;
}

export interface EnsembleResult {
  field: ExtractableField;
  value: string | null;
  confidence: number;
  method: "ensemble";
  contributingMethods: Array<{
    method: string;
    value: string;
    weight: number;
    confidence: number;
  }>;
}

export interface FieldRelationship {
  primaryField: string;
  primaryValue: string;
  dependentField: string;
  probability: number;
  expectedPattern?: string;
}

export interface LearningSession {
  emailQueueId: string;
  insuranceCompanyId: string | null;
  extractedFields: Map<string, ExtractionResult>;
  userCorrections: Map<string, string>;
  wasAccepted: boolean;
}

// =============================================================================
// ENSEMBLE EXTRACTION
// =============================================================================

/**
 * Extract field using multiple methods and combine results
 */
export async function ensembleExtract(
  text: string,
  field: ExtractableField,
  insuranceCompanyId: string | null
): Promise<EnsembleResult | ExtractionResult> {
  // Get confidence weights for this company/field
  const weights = await getConfidenceWeights(insuranceCompanyId, field);

  // Run all extraction methods
  const results: Array<{
    method: "regex" | "ai" | "template" | "position";
    value: string | null;
    confidence: number;
    weight: number;
  }> = [];

  // Method 1: Regex patterns
  const regexResult = await extractWithRegex(text, field, insuranceCompanyId);
  if (regexResult.value) {
    results.push({
      method: "regex",
      value: regexResult.value,
      confidence: regexResult.confidence,
      weight: weights.regex || 0.3,
    });
  }

  // Method 2: Template matching
  const templateResult = await extractWithTemplate(text, field, insuranceCompanyId);
  if (templateResult.value) {
    results.push({
      method: "template",
      value: templateResult.value,
      confidence: templateResult.confidence,
      weight: weights.template || 0.25,
    });
  }

  // Method 3: Position-based extraction (for structured documents)
  const positionResult = await extractWithPosition(text, field, insuranceCompanyId);
  if (positionResult.value) {
    results.push({
      method: "position",
      value: positionResult.value,
      confidence: positionResult.confidence,
      weight: weights.position || 0.2,
    });
  }

  // If only one method found a value, return it
  if (results.length === 0) {
    return {
      field,
      value: null,
      confidence: 0,
      method: "fallback",
    };
  }

  if (results.length === 1) {
    return {
      field,
      value: results[0].value,
      confidence: results[0].confidence * results[0].weight,
      method: results[0].method,
    };
  }

  // Combine results using weighted voting
  const valueGroups = new Map<string, { totalWeight: number; methods: typeof results }>();

  for (const result of results) {
    const normalizedValue = normalizeValue(result.value, field);
    const existing = valueGroups.get(normalizedValue);
    if (existing) {
      existing.totalWeight += result.weight * (result.confidence / 100);
      existing.methods.push(result);
    } else {
      valueGroups.set(normalizedValue, {
        totalWeight: result.weight * (result.confidence / 100),
        methods: [result],
      });
    }
  }

  // Find best value
  let bestValue = "";
  let bestWeight = 0;
  let bestMethods: typeof results = [];

  for (const [value, data] of valueGroups) {
    if (data.totalWeight > bestWeight) {
      bestValue = value;
      bestWeight = data.totalWeight;
      bestMethods = data.methods;
    }
  }

  // Calculate ensemble confidence
  const methodAgreement = bestMethods.length / results.length;
  const ensembleConfidence = Math.min(95, (bestWeight * 100 * (0.7 + 0.3 * methodAgreement)));

  return {
    field,
    value: bestValue,
    confidence: ensembleConfidence,
    method: "ensemble",
    contributingMethods: bestMethods.map((m) => ({
      method: m.method,
      value: m.value || "",
      weight: m.weight,
      confidence: m.confidence,
    })),
  };
}

/**
 * Normalize value for comparison
 */
function normalizeValue(value: string | null, field: ExtractableField): string {
  if (!value) return "";
  let normalized = value.trim().toUpperCase();

  switch (field) {
    case "claimNumber":
    case "policyNumber":
      // Remove separators for comparison
      normalized = normalized.replace(/[-/]/g, "");
      break;
    case "clientName":
      // Normalize whitespace
      normalized = normalized.replace(/\s+/g, " ");
      break;
    case "vehicleRegistration":
      // Remove spaces for SA plates
      normalized = normalized.replace(/\s/g, "");
      break;
    case "excessAmount":
      // Extract number
      const numMatch = normalized.match(/[\d,.]+/);
      normalized = numMatch ? numMatch[0].replace(/,/g, "") : normalized;
      break;
  }

  return normalized;
}

/**
 * Get confidence weights for ensemble methods
 */
async function getConfidenceWeights(
  insuranceCompanyId: string | null,
  field: ExtractableField
): Promise<Record<string, number>> {
  const defaultWeights = {
    regex: 0.35,
    template: 0.3,
    position: 0.2,
    ai: 0.15,
  };

  if (!insuranceCompanyId) return defaultWeights;

  try {
    const weights = await db.confidenceWeight.findMany({
      where: {
        insuranceCompanyId,
        fieldType: field,
      },
    });

    if (weights.length === 0) return defaultWeights;

    const result: Record<string, number> = { ...defaultWeights };
    for (const w of weights) {
      result[w.extractionMethod] = w.weight;
    }

    return result;
  } catch {
    return defaultWeights;
  }
}

// =============================================================================
// EXTRACTION METHODS
// =============================================================================

/**
 * Extract using regex patterns
 */
async function extractWithRegex(
  text: string,
  field: ExtractableField,
  insuranceCompanyId: string | null
): Promise<ExtractionResult> {
  // Get patterns for this company/field
  const patterns = await db.extractionPattern.findMany({
    where: {
      insuranceCompanyId: insuranceCompanyId || null,
      fieldType: field,
      isActive: true,
    },
    orderBy: [
      { priority: "desc" },
      { confidence: "desc" },
    ],
    take: 5,
  });

  // Also get global patterns
  const globalPatterns = await db.globalPattern.findMany({
    where: {
      fieldType: field,
      isActive: true,
    },
    orderBy: { successRate: "desc" },
    take: 3,
  });

  const allPatterns = [
    ...patterns.map((p) => ({ pattern: p.patternValue, confidence: p.confidence, id: p.id })),
    ...globalPatterns.map((p) => ({ pattern: p.patternValue, confidence: p.confidence, id: p.id })),
  ];

  for (const { pattern, confidence } of allPatterns) {
    try {
      const regex = new RegExp(pattern, "im");
      const match = text.match(regex);
      if (match && match[1]) {
        return {
          field,
          value: match[1].trim(),
          confidence,
          method: "regex",
          pattern,
        };
      }
    } catch {
      // Invalid regex, skip
    }
  }

  // Fallback to generic patterns
  return extractWithFallbackRegex(text, field);
}

/**
 * Fallback regex patterns for each field
 */
function extractWithFallbackRegex(text: string, field: ExtractableField): ExtractionResult {
  const fallbackPatterns: Record<string, { pattern: RegExp; confidence: number }> = {
    claimNumber: {
      pattern: /(?:claim|case|ref(?:erence)?)\s*(?:no|number|#)?[:\s]*([A-Z]{2,4}[-/]\d{2,4}[-/]\d{4,8})/i,
      confidence: 40,
    },
    policyNumber: {
      pattern: /(?:policy|pol)\s*(?:no|number|#)?[:\s]*([A-Z]{0,4}[-/]?\d{6,12})/i,
      confidence: 40,
    },
    clientName: {
      pattern: /(?:client|insured|name|dear)[:\s]+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/i,
      confidence: 35,
    },
    vehicleRegistration: {
      pattern: /(?:vehicle|reg(?:istration)?)\s*(?:no|number|#)?[:\s]*([A-Z]{2,3}\d{3}[A-Z]{0,2}|\d{3}[A-Z]{3}\d{2})/i,
      confidence: 45,
    },
    excessAmount: {
      pattern: /excess[:\s]*(R?\s*[\d,]+\.?\d{0,2})/i,
      confidence: 45,
    },
  };

  const fallback = fallbackPatterns[field];
  if (fallback) {
    const match = text.match(fallback.pattern);
    if (match && match[1]) {
      return {
        field,
        value: match[1].trim(),
        confidence: fallback.confidence,
        method: "regex",
        pattern: fallback.pattern.source,
        source: "fallback",
      };
    }
  }

  return { field, value: null, confidence: 0, method: "regex" };
}

/**
 * Extract using learned email templates
 */
async function extractWithTemplate(
  text: string,
  field: ExtractableField,
  insuranceCompanyId: string | null
): Promise<ExtractionResult> {
  // Find matching templates
  const templates = await db.emailTemplate.findMany({
    where: {
      insuranceCompanyId: insuranceCompanyId || null,
      isActive: true,
    },
    take: 5,
  });

  for (const template of templates) {
    if (!template.structureFingerprint) continue;

    try {
      const structure = JSON.parse(template.structureFingerprint);
      const fieldPosition = structure[field];

      if (fieldPosition && typeof fieldPosition.start === "number") {
        // Extract based on position in similar template
        const lines = text.split("\n");
        const lineIndex = Math.min(fieldPosition.line || 0, lines.length - 1);
        const line = lines[lineIndex];

        if (line) {
          // Try to extract value from expected position
          const afterLabel = line.slice(fieldPosition.start);
          const valueMatch = afterLabel.match(/^[:\s]*([^\n]+)/);
          if (valueMatch) {
            return {
              field,
              value: valueMatch[1].trim(),
              confidence: template.confidence,
              method: "template",
              source: template.id,
            };
          }
        }
      }
    } catch {
      // Invalid template structure
    }
  }

  return { field, value: null, confidence: 0, method: "template" };
}

/**
 * Extract using position-based patterns (for structured documents)
 */
async function extractWithPosition(
  text: string,
  field: ExtractableField,
  insuranceCompanyId: string | null
): Promise<ExtractionResult> {
  // Look for common position patterns
  // e.g., "Claim Number:" followed by value on same line or next line

  const positionPatterns: Record<string, Array<{ label: RegExp; sameLine: boolean }>> = {
    claimNumber: [
      { label: /claim\s*(?:no|number|#|ref)?[:\s]*$/i, sameLine: true },
      { label: /reference[:\s]*$/i, sameLine: true },
    ],
    policyNumber: [
      { label: /policy\s*(?:no|number|#)?[:\s]*$/i, sameLine: true },
    ],
    clientName: [
      { label: /(?:client|insured|claimant)\s*[:\s]*$/i, sameLine: true },
      { label: /dear\s+$/i, sameLine: true },
    ],
    excessAmount: [
      { label: /excess[:\s]*$/i, sameLine: true },
    ],
  };

  const patterns = positionPatterns[field] || [];
  const lines = text.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    for (const { label, sameLine } of patterns) {
      const labelMatch = line.match(label);
      if (labelMatch) {
        if (sameLine) {
          // Extract value after label on same line
          const afterLabel = line.slice(labelMatch.index! + labelMatch[0].length);
          const valueMatch = afterLabel.match(/^([^\n\r]+)/);
          if (valueMatch && valueMatch[1].trim()) {
            return {
              field,
              value: valueMatch[1].trim(),
              confidence: 55,
              method: "position",
              pattern: label.source,
            };
          }
        } else if (i + 1 < lines.length) {
          // Extract value from next line
          const nextLine = lines[i + 1].trim();
          if (nextLine) {
            return {
              field,
              value: nextLine,
              confidence: 50,
              method: "position",
              pattern: label.source,
            };
          }
        }
      }
    }
  }

  return { field, value: null, confidence: 0, method: "position" };
}

// =============================================================================
// CROSS-FIELD VALIDATION
// =============================================================================

/**
 * Validate extracted fields against learned relationships
 */
export async function validateFieldRelationships(
  extractedFields: Map<string, ExtractionResult>,
  insuranceCompanyId: string | null
): Promise<{
  validated: Map<string, ExtractionResult>;
  warnings: Array<{ field: string; message: string }>;
  suggestions: Array<{ field: string; suggestedValue: string; reason: string }>;
}> {
  const warnings: Array<{ field: string; message: string }> = [];
  const suggestions: Array<{ field: string; suggestedValue: string; reason: string }> = [];

  // Get learned relationships
  const relationships = await db.fieldRelationship.findMany({
    where: {
      insuranceCompanyId: insuranceCompanyId || null,
      isActive: true,
      probability: { gte: 0.7 },
    },
  });

  for (const rel of relationships) {
    const primaryField = extractedFields.get(rel.primaryField);
    const dependentField = extractedFields.get(rel.dependentField);

    if (primaryField?.value === rel.primaryValue) {
      // Primary condition met, check dependent
      if (!dependentField?.value && rel.expectedPattern) {
        // Dependent field is missing but expected
        suggestions.push({
          field: rel.dependentField,
          suggestedValue: rel.expectedPattern,
          reason: `When ${rel.primaryField}="${rel.primaryValue}", ${rel.dependentField} is expected (${Math.round(rel.probability * 100)}% confidence)`,
        });
      }
    }
  }

  // Apply claim type specific validations
  const claimType = extractedFields.get("claimType")?.value;
  if (claimType === "MOTOR") {
    // Motor claims should have vehicle details
    if (!extractedFields.get("vehicleRegistration")?.value) {
      warnings.push({
        field: "vehicleRegistration",
        message: "Motor claims typically include vehicle registration",
      });
    }
  } else if (claimType === "PROPERTY") {
    // Property claims should have address
    if (!extractedFields.get("propertyAddress")?.value) {
      warnings.push({
        field: "propertyAddress",
        message: "Property claims typically include property address",
      });
    }
  }

  return { validated: extractedFields, warnings, suggestions };
}

/**
 * Learn field relationship from extraction session
 */
export async function learnFieldRelationship(
  insuranceCompanyId: string | null,
  primaryField: string,
  primaryValue: string,
  dependentField: string,
  dependentValue: string | null
): Promise<void> {
  try {
    const existing = await db.fieldRelationship.findUnique({
      where: {
        insuranceCompanyId_primaryField_primaryValue_dependentField: {
          insuranceCompanyId: insuranceCompanyId || "",
          primaryField,
          primaryValue,
          dependentField,
        },
      },
    });

    if (existing) {
      // Update probability using Bayesian update
      const newCount = existing.occurrenceCount + 1;
      const newProbability = dependentValue
        ? (existing.probability * existing.occurrenceCount + 1) / newCount
        : (existing.probability * existing.occurrenceCount) / newCount;

      await db.fieldRelationship.update({
        where: { id: existing.id },
        data: {
          occurrenceCount: newCount,
          probability: newProbability,
          expectedPattern: dependentValue || existing.expectedPattern,
        },
      });
    } else {
      // Create new relationship
      await db.fieldRelationship.create({
        data: {
          insuranceCompanyId,
          primaryField,
          primaryValue,
          dependentField,
          probability: dependentValue ? 1 : 0,
          expectedPattern: dependentValue,
        },
      });
    }
  } catch (error) {
    console.error("Failed to learn field relationship:", error);
  }
}

// =============================================================================
// NEGATIVE PATTERN LEARNING
// =============================================================================

/**
 * Learn from incorrect extractions to avoid future false positives
 */
export async function learnNegativePattern(
  insuranceCompanyId: string | null,
  fieldType: ExtractableField,
  incorrectValue: string,
  context: string,
  rejectionReason: string
): Promise<void> {
  try {
    // Check if this pattern exists
    const existing = await db.negativePattern.findFirst({
      where: {
        insuranceCompanyId: insuranceCompanyId || null,
        fieldType,
        incorrectValue,
      },
    });

    if (existing) {
      await db.negativePattern.update({
        where: { id: existing.id },
        data: {
          occurrenceCount: { increment: 1 },
        },
      });
    } else {
      await db.negativePattern.create({
        data: {
          insuranceCompanyId,
          fieldType,
          incorrectValue,
          contextPattern: context.substring(0, 200),
          rejectionReason,
        },
      });
    }
  } catch (error) {
    console.error("Failed to learn negative pattern:", error);
  }
}

/**
 * Check if a value matches a known negative pattern
 */
export async function checkNegativePatterns(
  insuranceCompanyId: string | null,
  fieldType: ExtractableField,
  value: string,
  context: string
): Promise<{ isNegative: boolean; reason?: string }> {
  try {
    const negativePatterns = await db.negativePattern.findMany({
      where: {
        insuranceCompanyId: insuranceCompanyId || null,
        fieldType,
        isActive: true,
      },
    });

    for (const pattern of negativePatterns) {
      if (value === pattern.incorrectValue) {
        return { isNegative: true, reason: pattern.rejectionReason || undefined };
      }

      // Check context similarity if available
      if (pattern.contextPattern && context.includes(pattern.contextPattern)) {
        return {
          isNegative: true,
          reason: `Similar context to previously rejected: ${pattern.rejectionReason}`,
        };
      }
    }

    return { isNegative: false };
  } catch {
    return { isNegative: false };
  }
}

// =============================================================================
// EMAIL TEMPLATE DETECTION
// =============================================================================

/**
 * Generate a structural fingerprint from email content
 */
export function generateTemplateFingerprint(
  subject: string | null,
  body: string
): string {
  // Extract structural elements
  const lines = body.split("\n").filter((l) => l.trim());

  // Get positions of key labels
  const labels = [
    "claim", "policy", "client", "insured", "vehicle", "excess",
    "date", "reference", "number", "name", "address",
  ];

  const structure: Record<string, { line: number; start: number }> = {};
  const lowerBody = body.toLowerCase();

  for (const label of labels) {
    const regex = new RegExp(`${label}[:\\s]`, "gi");
    let match;
    while ((match = regex.exec(lowerBody)) !== null) {
      const lineNum = lowerBody.substring(0, match.index).split("\n").length - 1;
      if (!structure[label]) {
        structure[label] = { line: lineNum, start: match.index };
      }
    }
  }

  // Create fingerprint hash
  const fingerprint = JSON.stringify({
    labelPositions: Object.keys(structure).sort(),
    lineCount: lines.length,
    subjectPattern: subject ? subject.replace(/\d+/g, "N").replace(/[A-Z]{2,4}[-/]\d+/g, "CLAIM") : null,
  });

  return fingerprint;
}

/**
 * Learn email template from successful extraction
 */
export async function learnEmailTemplate(
  emailQueueId: string,
  insuranceCompanyId: string | null,
  subject: string | null,
  body: string,
  extractedFields: Map<string, ExtractionResult>
): Promise<void> {
  try {
    const fingerprint = generateTemplateFingerprint(subject, body);

    // Check if template exists
    const existing = await db.emailTemplate.findUnique({
      where: { templateHash: fingerprint },
    });

    const fieldPositions: Record<string, { line: number; start: number }> = {};
    const lowerBody = body.toLowerCase();

    // Record positions of successfully extracted fields
    for (const [field, result] of extractedFields) {
      if (result.value) {
        const index = lowerBody.indexOf(result.value.toLowerCase());
        if (index !== -1) {
          const lineNum = lowerBody.substring(0, index).split("\n").length - 1;
          fieldPositions[field] = { line: lineNum, start: index };
        }
      }
    }

    if (existing) {
      // Update existing template
      await db.emailTemplate.update({
        where: { id: existing.id },
        data: {
          matchCount: { increment: 1 },
          structureFingerprint: JSON.stringify(fieldPositions),
          confidence: Math.min(95, existing.confidence + 2),
        },
      });
    } else {
      // Create new template
      await db.emailTemplate.create({
        data: {
          insuranceCompanyId,
          templateHash: fingerprint,
          subjectPattern: subject?.replace(/\d+/g, "N") || null,
          structureFingerprint: JSON.stringify(fieldPositions),
          expectedFields: JSON.stringify([...extractedFields.keys()]),
          confidence: 60,
        },
      });
    }
  } catch (error) {
    console.error("Failed to learn email template:", error);
  }
}

// =============================================================================
// ACTIVE LEARNING
// =============================================================================

/**
 * Determine if extraction needs human clarification
 */
export async function needsClarification(
  extractedFields: Map<string, ExtractionResult>,
  insuranceCompanyId: string | null
): Promise<{
  needsClarification: boolean;
  uncertainFields: Array<{ field: string; reason: string; alternatives?: string[] }>;
  suggestedQuestions: string[];
}> {
  const uncertainFields: Array<{ field: string; reason: string; alternatives?: string[] }> = [];
  const suggestedQuestions: string[] = [];

  for (const [field, result] of extractedFields) {
    // Check confidence threshold
    if (result.confidence < 50) {
      uncertainFields.push({
        field,
        reason: `Low confidence (${result.confidence}%)`,
        alternatives: result.alternatives?.map((a) => a.value),
      });
    }

    // Check for multiple high-confidence alternatives
    if (result.alternatives && result.alternatives.length > 1) {
      const highConfAlternatives = result.alternatives.filter((a) => a.confidence > 40);
      if (highConfAlternatives.length > 1) {
        uncertainFields.push({
          field,
          reason: "Multiple possible values detected",
          alternatives: highConfAlternatives.map((a) => a.value),
        });
      }
    }

    // Check against negative patterns
    if (result.value) {
      const { isNegative, reason } = await checkNegativePatterns(
        insuranceCompanyId,
        field as ExtractableField,
        result.value,
        ""
      );
      if (isNegative) {
        uncertainFields.push({
          field,
          reason: reason || "Matched negative pattern",
        });
      }
    }
  }

  // Generate suggested questions
  for (const { field, reason, alternatives } of uncertainFields) {
    if (alternatives && alternatives.length > 1) {
      suggestedQuestions.push(
        `Which ${field.replace(/([A-Z])/g, " $1").toLowerCase()} is correct: ${alternatives.join(" or ")}?`
      );
    } else {
      suggestedQuestions.push(
        `Please verify the ${field.replace(/([A-Z])/g, " $1").toLowerCase()} (uncertain: ${reason})`
      );
    }
  }

  return {
    needsClarification: uncertainFields.length > 0,
    uncertainFields,
    suggestedQuestions,
  };
}

// =============================================================================
// BAYESIAN CONFIDENCE UPDATE
// =============================================================================

/**
 * Update confidence weights using Bayesian learning
 */
export async function updateConfidenceWeights(
  insuranceCompanyId: string | null,
  field: ExtractableField,
  method: string,
  wasCorrect: boolean
): Promise<void> {
  try {
    const existing = await db.confidenceWeight.findUnique({
      where: {
        insuranceCompanyId_fieldType_extractionMethod: {
          insuranceCompanyId: insuranceCompanyId || "",
          fieldType: field,
          extractionMethod: method,
        },
      },
    });

    if (existing) {
      // Bayesian update: P(success|data) = (successes + 1) / (total + 2)
      const newSuccessCount = wasCorrect ? existing.successCount + 1 : existing.successCount;
      const newFailureCount = wasCorrect ? existing.failureCount : existing.failureCount + 1;
      const total = newSuccessCount + newFailureCount;

      // New weight with smoothing
      const newWeight = total > 0 ? (newSuccessCount + 1) / (total + 2) : 0.5;

      await db.confidenceWeight.update({
        where: { id: existing.id },
        data: {
          successCount: newSuccessCount,
          failureCount: newFailureCount,
          weight: newWeight,
          lastSuccessAt: wasCorrect ? new Date() : existing.lastSuccessAt,
          lastFailureAt: wasCorrect ? existing.lastFailureAt : new Date(),
        },
      });
    } else {
      // Create new weight entry
      await db.confidenceWeight.create({
        data: {
          insuranceCompanyId,
          fieldType: field,
          extractionMethod: method,
          weight: wasCorrect ? 0.7 : 0.3,
          successCount: wasCorrect ? 1 : 0,
          failureCount: wasCorrect ? 0 : 1,
        },
      });
    }
  } catch (error) {
    console.error("Failed to update confidence weights:", error);
  }
}

// =============================================================================
// MAIN LEARNING SESSION PROCESSOR
// =============================================================================

/**
 * Process a learning session after user review
 */
export async function processLearningSession(session: LearningSession): Promise<void> {
  const { emailQueueId, insuranceCompanyId, extractedFields, userCorrections, wasAccepted } = session;

  try {
    // Record extraction session
    await db.extractionSession.create({
      data: {
        emailQueueId,
        extractedFields: JSON.stringify(Object.fromEntries(extractedFields)),
        overallConfidence: [...extractedFields.values()].reduce((sum, f) => sum + f.confidence, 0) / extractedFields.size,
        wasAccepted,
        correctionCount: userCorrections.size,
      },
    });

    // Process corrections
    for (const [field, correctedValue] of userCorrections) {
      const originalResult = extractedFields.get(field);

      if (originalResult) {
        // Update confidence weights
        await updateConfidenceWeights(
          insuranceCompanyId,
          field as ExtractableField,
          originalResult.method,
          false // Was corrected, so original was wrong
        );

        // Learn negative pattern for wrong value
        if (originalResult.value) {
          await learnNegativePattern(
            insuranceCompanyId,
            field as ExtractableField,
            originalResult.value,
            "",
            `Corrected to: ${correctedValue}`
          );
        }

        // Store the correction as a learning example
        await db.extractionExample.create({
          data: {
            insuranceCompanyId,
            fieldType: field,
            sourceText: correctedValue,
            extractedValue: correctedValue,
            learnedFrom: "user_correction",
            verified: true,
            emailQueueId,
          },
        });
      }
    }

    // Update confidence for fields that were NOT corrected (they were correct)
    for (const [field, result] of extractedFields) {
      if (!userCorrections.has(field) && result.value) {
        await updateConfidenceWeights(
          insuranceCompanyId,
          field as ExtractableField,
          result.method,
          true // Was correct
        );
      }
    }

    // Learn field relationships
    const fields = Object.fromEntries(extractedFields);
    for (const [primaryField, primaryResult] of extractedFields) {
      for (const [dependentField, dependentResult] of extractedFields) {
        if (primaryField !== dependentField && primaryResult.value && dependentResult.value) {
          await learnFieldRelationship(
            insuranceCompanyId,
            primaryField,
            primaryResult.value,
            dependentField,
            dependentResult.value
          );
        }
      }
    }

    // Update sender pattern
    if (insuranceCompanyId) {
      await updateSenderAccuracy(insuranceCompanyId, userCorrections.size === 0);
    }
  } catch (error) {
    console.error("Failed to process learning session:", error);
  }
}

/**
 * Update sender pattern accuracy
 */
async function updateSenderAccuracy(
  insuranceCompanyId: string,
  wasFullyCorrect: boolean
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
        const newCorrectCount = wasFullyCorrect
          ? pattern.correctCount + 1
          : pattern.correctCount;
        const newCorrectedCount = wasFullyCorrect
          ? pattern.correctedCount
          : pattern.correctedCount + 1;

        const total = newCorrectCount + newCorrectedCount;
        const newAccuracy = total > 0 ? (newCorrectCount / total) * 100 : 0;

        // Update automation level based on accuracy
        let newLevel = pattern.automationLevel;
        if (newAccuracy >= 90 && pattern.totalEmails >= 10) {
          newLevel = "auto";
        } else if (newAccuracy >= 75 && pattern.totalEmails >= 5) {
          newLevel = "semi_auto";
        }

        await db.senderPattern.update({
          where: { id: pattern.id },
          data: {
            correctCount: newCorrectCount,
            correctedCount: newCorrectedCount,
            accuracyRate: newAccuracy,
            automationLevel: newLevel,
          },
        });
      }
    }
  } catch (error) {
    console.error("Failed to update sender accuracy:", error);
  }
}

// =============================================================================
// QUICK LEARNING RULES
// =============================================================================

/**
 * Apply quick learning rules for instant pattern learning
 */
export async function applyQuickLearningRules(
  extractedFields: Map<string, ExtractionResult>
): Promise<Map<string, ExtractionResult>> {
  const rules = await db.quickLearningRule.findMany({
    where: { isActive: true },
    orderBy: { priority: "desc" },
  });

  for (const rule of rules) {
    const triggerField = extractedFields.get(rule.triggerField);
    if (!triggerField?.value) continue;

    const triggerRegex = new RegExp(rule.triggerPattern, "i");
    if (triggerRegex.test(triggerField.value)) {
      // Apply the learned pattern to the target field
      const learnField = extractedFields.get(rule.learnField);
      if (!learnField?.value) {
        // Apply the pattern
        const learnRegex = new RegExp(rule.learnPattern, "i");
        // This would need the source text to apply the pattern
      }
    }
  }

  return extractedFields;
}

/**
 * Create a quick learning rule from a strong pattern
 */
export async function createQuickLearningRule(
  triggerField: string,
  triggerPattern: string,
  learnField: string,
  learnPattern: string
): Promise<void> {
  await db.quickLearningRule.create({
    data: {
      triggerField,
      triggerPattern,
      learnField,
      learnPattern,
      priority: 10,
    },
  });
}
