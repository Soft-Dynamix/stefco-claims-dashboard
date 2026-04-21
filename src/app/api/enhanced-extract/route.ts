import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { LLM } from "z-ai-web-dev-sdk";
import {
  ensembleExtract,
  validateFieldRelationships,
  needsClarification,
  processLearningSession,
  learnEmailTemplate,
  ExtractableField,
  ExtractionResult,
} from "@/lib/enhanced-learning";
import { processAllAttachments } from "@/lib/attachment-processor";

// Classification prompt
const CLASSIFICATION_PROMPT = `You are the Intake Agent for Stefco Consultants Insurance Claims.

Determine if this email is a NEW CLAIM APPOINTMENT. Be strict - avoid false positives.

Classify into:
- NEW_CLAIM: New claim assessment/appointment request
- IGNORE: Spam, marketing, out-of-office, irrelevant
- MISSING_INFO: Related to claims but lacks essential info
- OTHER: Unclear or miscellaneous

NEW_CLAIM indicators:
- "New assessment", "New appointment", "NUWE EIS" (Afrikaans)
- "You are appointed"
- Attachments related to claims
- Insurance company correspondence about new matters
- Vehicle/property incident details

Rules:
- Only mark NEW_CLAIM with clear evidence
- If unsure, return OTHER
- Ignore spam, replies, follow-ups, marketing

Analyze and respond with ONLY valid JSON (no markdown):
Subject: {subject}
From: {from}
Body:
{body}

{"classification": "NEW_CLAIM|IGNORE|MISSING_INFO|OTHER", "confidence": 0-100, "reasoning": "brief explanation"}`;

// Enhanced extraction prompt with learning hints
const ENHANCED_EXTRACTION_PROMPT = `You are the Data Extraction Agent for Stefco Consultants Insurance Claims.

Extract structured claim data. Be precise - DO NOT guess. Use null for uncertain fields.

Extract:
- claimNumber: Main claim reference number
- policyNumber: Policy number
- clientName: Client/claimant full name
- clientEmail: Client email
- clientPhone: Client phone
- claimType: MOTOR, PROPERTY, LIABILITY, THEFT, FIRE, or OTHER
- incidentDate: Date (ISO format YYYY-MM-DD)
- incidentDescription: Brief incident description
- vehicleRegistration: Vehicle reg (if motor claim)
- vehicleMake: Vehicle make
- vehicleModel: Vehicle model
- propertyAddress: Property address (if property claim)
- excessAmount: Excess amount (number only)
- insuranceCompany: Insurance company name

Learning hints:
{hints}

Attachment data:
{attachmentData}

Respond with ONLY valid JSON (no markdown):
{"claimNumber": null, "policyNumber": null, "clientName": null, "clientEmail": null, "clientPhone": null, "claimType": null, "incidentDate": null, "incidentDescription": null, "vehicleRegistration": null, "vehicleMake": null, "vehicleModel": null, "propertyAddress": null, "excessAmount": null, "insuranceCompany": null, "confidenceOverall": 0-100, "missingFields": [], "fieldConfidences": {}}`;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      emailId,
      subject,
      from,
      fromDomain,
      bodyText,
      attachments,
      insuranceCompanyId,
      skipAttachments,
    } = body;

    if (!bodyText && !attachments?.length) {
      return NextResponse.json(
        { error: "Email body or attachments required" },
        { status: 400 }
      );
    }

    // Initialize LLM
    const llm = new LLM();

    // Step 1: Get all learning hints
    const [learningPatterns, extractionPatterns, claimNumberFormats] =
      await Promise.all([
        db.learningPattern.findMany({
          where: {
            senderDomain: fromDomain || undefined,
            isActive: true,
          },
          orderBy: { confidence: "desc" },
          take: 15,
        }),
        db.extractionPattern.findMany({
          where: {
            insuranceCompanyId: insuranceCompanyId || null,
            isActive: true,
          },
          orderBy: [{ priority: "desc" }, { confidence: "desc" }],
          take: 20,
        }),
        insuranceCompanyId
          ? db.claimNumberFormat.findMany({
              where: { insuranceCompanyId, isActive: true },
              take: 5,
            })
          : [],
      ]);

    // Build hints text
    const hintsParts: string[] = [];

    if (learningPatterns.length > 0) {
      hintsParts.push("Learned patterns from this sender:");
      hintsParts.push(...learningPatterns.map((h) => `- ${h.fieldName}: ${h.patternHint}`));
    }

    if (extractionPatterns.length > 0) {
      hintsParts.push("\nCompany-specific patterns:");
      hintsParts.push(
        ...extractionPatterns.map(
          (p) => `- ${p.fieldType}: ${p.description || p.patternValue}`
        )
      );
    }

    if (claimNumberFormats.length > 0) {
      hintsParts.push("\nKnown claim number formats:");
      hintsParts.push(
        ...claimNumberFormats.map((f) => `- ${f.formatPattern} (example: ${f.example})`)
      );
    }

    const hintsText =
      hintsParts.length > 0 ? hintsParts.join("\n") : "No learning hints available.";

    // Step 2: Process attachments if provided
    let attachmentData = "";
    const attachmentFields = new Map<string, { value: string; confidence: number; source: string }>();

    if (attachments?.length && !skipAttachments) {
      try {
        const attachmentResults = await processAllAttachments(
          attachments.map((a: { filename: string; contentType: string; size: number; content?: string }) => ({
            filename: a.filename,
            contentType: a.contentType,
            size: a.size,
            content: a.content ? Buffer.from(a.content, "base64") : undefined,
          })),
          insuranceCompanyId
        );

        attachmentData = attachmentResults.combinedText;
        attachmentResults.extractedFields.forEach((v, k) => attachmentFields.set(k, v));
      } catch (error) {
        console.error("Attachment processing error:", error);
      }
    }

    // Step 3: Classification
    const classificationPrompt = CLASSIFICATION_PROMPT.replace(
      "{subject}",
      subject || "(No Subject)"
    )
      .replace("{from}", from || "Unknown")
      .replace("{body}", (bodyText || "").substring(0, 4000));

    const classificationResponse = await llm.chat({
      messages: [{ role: "user", content: classificationPrompt }],
      temperature: 0.1,
    });

    let classification;
    try {
      const responseText = classificationResponse.content || "";
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      classification = jsonMatch
        ? JSON.parse(jsonMatch[0])
        : { classification: "OTHER", confidence: 50, reasoning: "Failed to parse" };
    } catch {
      classification = { classification: "OTHER", confidence: 50, reasoning: "Parse error" };
    }

    // Step 4: Enhanced extraction for NEW_CLAIM
    let extraction: Record<string, unknown> = {};
    const ensembleResults = new Map<string, ExtractionResult>();
    const validation = { warnings: [] as Array<{ field: string; message: string }>, suggestions: [] as Array<{ field: string; suggestedValue: string; reason: string }> };
    const clarification = { needsClarification: false, uncertainFields: [] as Array<{ field: string; reason: string; alternatives?: string[] }>, suggestedQuestions: [] as string[] };

    if (classification.classification === "NEW_CLAIM") {
      // Run ensemble extraction for key fields
      const fieldsToExtract: ExtractableField[] = [
        "claimNumber",
        "policyNumber",
        "clientName",
        "vehicleRegistration",
        "excessAmount",
      ];

      const combinedText = [bodyText, attachmentData].filter(Boolean).join("\n\n");

      for (const field of fieldsToExtract) {
        const result = await ensembleExtract(combinedText, field, insuranceCompanyId);
        ensembleResults.set(field, result as ExtractionResult);
      }

      // Also run AI extraction for remaining fields
      const extractionPrompt = ENHANCED_EXTRACTION_PROMPT.replace(
        "{subject}",
        subject || "(No Subject)"
      )
        .replace("{from}", from || "Unknown")
        .replace("{body}", combinedText.substring(0, 6000))
        .replace("{hints}", hintsText)
        .replace("{attachmentData}", attachmentData || "No attachment data");

      const extractionResponse = await llm.chat({
        messages: [{ role: "user", content: extractionPrompt }],
        temperature: 0.1,
      });

      try {
        const responseText = extractionResponse.content || "";
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          extraction = JSON.parse(jsonMatch[0]);
        }
      } catch {
        extraction = {};
      }

      // Merge ensemble results with AI results (ensemble takes priority)
      for (const [field, result] of ensembleResults) {
        if (result.value && result.confidence > 50) {
          extraction[field] = result.value;
        }
      }

      // Merge attachment-extracted fields
      for (const [field, data] of attachmentFields) {
        if (!extraction[field] && data.confidence > 40) {
          extraction[field] = data.value;
        }
      }

      // Validate field relationships
      const extractedMap = new Map<string, ExtractionResult>();
      for (const [key, value] of Object.entries(extraction)) {
        if (value !== null && value !== undefined) {
          extractedMap.set(key, {
            field: key as ExtractableField,
            value: String(value),
            confidence: typeof extraction === 'object' && extraction !== null && 'fieldConfidences' in extraction 
              ? ((extraction as Record<string, unknown>).fieldConfidences as Record<string, number>)?.[key] || 60 
              : 60,
            method: "ai",
          });
        }
      }

      const validationResult = await validateFieldRelationships(extractedMap, insuranceCompanyId);
      validation.warnings = validationResult.warnings;
      validation.suggestions = validationResult.suggestions;

      const clarificationResult = await needsClarification(extractedMap, insuranceCompanyId);
      clarification.needsClarification = clarificationResult.needsClarification;
      clarification.uncertainFields = clarificationResult.uncertainFields;
      clarification.suggestedQuestions = clarificationResult.suggestedQuestions;

      // Learn email template if extraction was successful
      if (emailId && Object.keys(extraction).length > 3) {
        await learnEmailTemplate(
          emailId,
          insuranceCompanyId,
          subject || null,
          bodyText || "",
          extractedMap
        ).catch(console.error);
      }
    }

    // Step 5: Decision
    let decision = {
      decision: "REVIEW",
      confidence: 50,
      riskFlags: [] as string[],
      reason: "",
      nextAction: "",
    };

    if (classification.classification === "NEW_CLAIM") {
      const criticalFields = ["claimNumber"];
      const extractionObj = extraction as Record<string, unknown>;
      const fieldConfidences = (extractionObj.fieldConfidences as Record<string, number>) || {};
      const hasCriticalField = criticalFields.some(
        (f) => extractionObj[f] && (fieldConfidences[f] || 0) >= 70
      );

      const overallConfidence = typeof extractionObj.confidenceOverall === 'number' ? extractionObj.confidenceOverall : 0;
      const hasWarnings = validation.warnings.length > 0;
      const needsUserClarification = clarification.needsClarification;

      if (hasCriticalField && overallConfidence >= 75 && !needsUserClarification) {
        decision = {
          decision: "PROCEED",
          confidence: overallConfidence,
          riskFlags: hasWarnings ? ["warnings_present"] : [],
          reason: "High confidence extraction with all critical fields",
          nextAction: "CREATE_CLAIM",
        };
      } else if (hasCriticalField && overallConfidence >= 50) {
        decision = {
          decision: "REVIEW",
          confidence: overallConfidence,
          riskFlags: [
            ...(hasWarnings ? ["warnings_present"] : []),
            ...(needsUserClarification ? ["needs_clarification"] : []),
          ],
          reason: `Medium confidence. ${clarification.suggestedQuestions.join(" ")}`,
          nextAction: "SEND_TO_REVIEW_QUEUE",
        };
      } else {
        decision = {
          decision: "REVIEW",
          confidence: overallConfidence,
          riskFlags: ["missing_critical_fields"],
          reason: "Missing or low confidence critical fields",
          nextAction: "SEND_TO_REVIEW_QUEUE",
        };
      }
    }

    // Update email queue if emailId provided
    if (emailId) {
      await db.emailQueue.update({
        where: { id: emailId },
        data: {
          aiClassification: classification.classification,
          aiConfidence: classification.confidence,
          aiReasoning: classification.reasoning,
          aiExtractedData: Object.keys(extraction).length > 0 ? JSON.stringify(extraction) : null,
          status: "AI_ANALYZED",
          learningHintsCount: learningPatterns.length + extractionPatterns.length,
        },
      });

      // Create prediction record
      await db.prediction.create({
        data: {
          emailQueueId: emailId,
          predictedClass: classification.classification,
          confidence: classification.confidence,
          reasoning: classification.reasoning,
          decision: decision.decision,
          extractedFields: Object.keys(extraction).length > 0 ? JSON.stringify(extraction) : null,
          learningHintsCount: learningPatterns.length,
          senderPatternsCount: extractionPatterns.length,
        },
      });

      // Create audit log
      await db.auditLog.create({
        data: {
          action: "enhanced_email_classified",
          entityType: "email",
          entityId: emailId,
          details: JSON.stringify({
            classification: classification.classification,
            confidence: classification.confidence,
            decision: decision.decision,
            warningsCount: validation.warnings.length,
            clarificationNeeded: clarification.needsClarification,
          }),
          status: "SUCCESS",
          processedBy: "AUTO",
        },
      });
    }

    return NextResponse.json({
      classification,
      extraction,
      decision,
      validation,
      clarification,
      ensembleResults: Object.fromEntries(ensembleResults),
      attachmentFields: Object.fromEntries(attachmentFields),
      learningHintsCount: learningPatterns.length + extractionPatterns.length,
    });
  } catch (error) {
    console.error("Enhanced extraction error:", error);
    return NextResponse.json(
      { error: "Failed to process", details: String(error) },
      { status: 500 }
    );
  }
}

// Endpoint to submit learning feedback
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      emailId,
      insuranceCompanyId,
      extractedFields,
      corrections,
      wasAccepted,
    } = body;

    // Convert to Map format
    const extractedMap = new Map<string, ExtractionResult>();
    for (const [key, value] of Object.entries(extractedFields || {})) {
      extractedMap.set(key, value as ExtractionResult);
    }

    const correctionsMap = new Map<string, string>();
    for (const [key, value] of Object.entries(corrections || {})) {
      correctionsMap.set(key, value as string);
    }

    // Process learning session
    await processLearningSession({
      emailQueueId: emailId,
      insuranceCompanyId,
      extractedFields: extractedMap,
      userCorrections: correctionsMap,
      wasAccepted,
    });

    return NextResponse.json({
      success: true,
      message: "Learning session processed successfully",
    });
  } catch (error) {
    console.error("Learning feedback error:", error);
    return NextResponse.json(
      { error: "Failed to process learning feedback" },
      { status: 500 }
    );
  }
}
