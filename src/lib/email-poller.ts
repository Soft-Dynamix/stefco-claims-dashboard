import { ImapFlow } from "imapflow";
import { db } from "./db";
import crypto from "crypto";

interface ImapConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  ssl: boolean;
  tls: boolean;
}

interface EmailMessage {
  messageId: string;
  subject: string | null;
  from: string | null;
  fromDomain: string | null;
  to: string | null;
  bodyText: string | null;
  bodyHtml: string | null;
  attachments: Array<{
    filename: string;
    contentType: string;
    size: number;
  }>;
  date: Date | null;
}

// Get IMAP config from database settings
export async function getImapConfig(): Promise<ImapConfig | null> {
  try {
    const configs = await db.systemConfig.findMany({
      where: {
        key: {
          in: ["IMAP_HOST", "IMAP_PORT", "IMAP_USER", "IMAP_PASSWORD", "IMAP_SSL", "IMAP_TLS"],
        },
      },
    });

    const configMap = new Map(configs.map((c) => [c.key, c.value]));

    const host = configMap.get("IMAP_HOST");
    const user = configMap.get("IMAP_USER");
    const password = configMap.get("IMAP_PASSWORD");

    if (!host || !user || !password) {
      return null;
    }

    return {
      host,
      port: parseInt(configMap.get("IMAP_PORT") || "993"),
      user,
      password,
      ssl: configMap.get("IMAP_SSL") !== "false",
      tls: true,
    };
  } catch (error) {
    console.error("Failed to get IMAP config:", error);
    return null;
  }
}

// Generate unique message ID hash
function generateMessageId(subject: string, body: string, from: string): string {
  const content = `${subject}:${body}:${from}`;
  return crypto.createHash("sha256").update(content).digest("hex");
}

// Extract domain from email address
function extractDomain(email: string | null): string | null {
  if (!email) return null;
  const match = email.match(/@([a-zA-Z0-9.-]+)/);
  return match ? match[1].toLowerCase() : null;
}

// Parse email address to get just the email part
function parseEmailAddress(address: string | null): string | null {
  if (!address) return null;
  // Handle formats like "Name <email@domain.com>" or just "email@domain.com"
  const match = address.match(/<([^>]+)>/) || address.match(/([^\s<>]+@[^\s<>]+)/);
  return match ? match[1] : address;
}

// Fetch emails from IMAP server
export async function fetchEmails(limit: number = 50): Promise<{
  success: boolean;
  fetched: number;
  errors: string[];
}> {
  const config = await getImapConfig();
  
  if (!config) {
    return {
      success: false,
      fetched: 0,
      errors: ["IMAP not configured. Please set up IMAP settings."],
    };
  }

  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.ssl,
    auth: {
      user: config.user,
      pass: config.password,
    },
    logger: false,
  });

  const errors: string[] = [];
  let fetched = 0;

  try {
    await client.connect();
    
    const mailbox = await client.mailboxOpen("INBOX");
    
    // Get unseen messages
    const messages = [];
    for await (const message of client.fetch(
      { unseen: true },
      { source: true, envelope: true, bodyStructure: true }
    )) {
      messages.push(message);
    }

    // Process each message
    for (const msg of messages.slice(0, limit)) {
      try {
        const envelope = msg.envelope;
        const source = msg.source?.toString("utf-8") || "";
        
        // Extract body text
        let bodyText = "";
        let bodyHtml = "";
        
        // Simple extraction - in production you'd want proper MIME parsing
        const textMatch = source.match(/Content-Type: text\/plain[\s\S]*?\r\n\r\n([\s\S]*?)(?=\r\n--|\r\nContent-|$)/i);
        const htmlMatch = source.match(/Content-Type: text\/html[\s\S]*?\r\n\r\n([\s\S]*?)(?=\r\n--|\r\nContent-|$)/i);
        
        if (textMatch) bodyText = textMatch[1].replace(/=\r\n/g, "").replace(/=([0-9A-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
        if (htmlMatch) bodyHtml = htmlMatch[1];

        const from = envelope.from?.[0]?.address || envelope.from?.[0]?.name || null;
        const fromEmail = parseEmailAddress(envelope.from?.[0]?.address || envelope.sender?.[0]?.address || null);
        
        const emailData: EmailMessage = {
          messageId: generateMessageId(
            envelope.subject || "(No Subject)",
            bodyText || source.substring(0, 500),
            fromEmail || ""
          ),
          subject: envelope.subject || null,
          from: fromEmail,
          fromDomain: extractDomain(fromEmail),
          to: envelope.to?.[0]?.address || null,
          bodyText: bodyText || source.substring(0, 5000),
          bodyHtml: bodyHtml || null,
          attachments: [],
          date: envelope.date || null,
        };

        // Check for duplicates
        const existing = await db.emailQueue.findUnique({
          where: { messageId: emailData.messageId },
        });

        if (existing) {
          continue; // Skip duplicate
        }

        // Determine processing route based on sender profile
        let processingRoute = "manual_review";
        if (emailData.fromDomain) {
          const senderProfile = await db.senderPattern.findUnique({
            where: { senderDomain: emailData.fromDomain },
          });
          
          if (senderProfile) {
            if (senderProfile.automationLevel === "auto") {
              processingRoute = "auto_create";
            } else if (senderProfile.automationLevel === "semi_auto") {
              processingRoute = "ai_suggest";
            }
          }
        }

        // Insert into email queue
        await db.emailQueue.create({
          data: {
            messageId: emailData.messageId,
            subject: emailData.subject,
            from: emailData.from,
            fromDomain: emailData.fromDomain,
            to: emailData.to,
            bodyText: emailData.bodyText?.substring(0, 50000),
            bodyHtml: emailData.bodyHtml?.substring(0, 100000),
            attachments: emailData.attachments.length > 0 ? JSON.stringify(emailData.attachments) : null,
            emailDate: emailData.date,
            status: "PENDING",
            processingRoute,
          },
        });

        fetched++;
      } catch (msgError) {
        errors.push(`Failed to process message: ${msgError}`);
      }
    }

    await client.logout();

    // Create audit log
    await db.auditLog.create({
      data: {
        action: "email_poll_completed",
        entityType: "system",
        details: JSON.stringify({ fetched, errors: errors.length }),
        status: errors.length > 0 ? "WARNING" : "SUCCESS",
        processedBy: "AUTO",
      },
    });

    return { success: true, fetched, errors };
  } catch (error) {
    const errorMsg = `IMAP connection failed: ${error}`;
    errors.push(errorMsg);
    
    // Create audit log for failure
    await db.auditLog.create({
      data: {
        action: "email_poll_failed",
        entityType: "system",
        details: JSON.stringify({ error: errorMsg }),
        status: "ERROR",
        processedBy: "AUTO",
      },
    });

    return { success: false, fetched, errors };
  }
}

// Get polling status
export async function getPollingStatus(): Promise<{
  isConfigured: boolean;
  lastPoll: Date | null;
  nextPoll: Date | null;
  totalQueued: number;
}> {
  const config = await getImapConfig();
  
  const lastPollLog = await db.auditLog.findFirst({
    where: { action: "email_poll_completed" },
    orderBy: { createdAt: "desc" },
  });

  const totalQueued = await db.emailQueue.count({
    where: { status: "PENDING" },
  });

  return {
    isConfigured: config !== null,
    lastPoll: lastPollLog?.createdAt || null,
    nextPoll: null, // Will be set by scheduler
    totalQueued,
  };
}
