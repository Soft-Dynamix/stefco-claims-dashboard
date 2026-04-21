/**
 * STEFCO Claims Dashboard - Email Poller Service
 * 
 * This service runs independently to poll emails from IMAP on a schedule.
 * It checks the database configuration for settings and logs all activity.
 * 
 * Usage:
 *   bun run dev   - Development with hot reload
 *   bun run start - Production mode
 */

import { PrismaClient } from "@prisma/client";
import { ImapFlow } from "imapflow";
import crypto from "crypto";

const prisma = new PrismaClient();

const SERVICE_PORT = 3002;
const DEFAULT_INTERVAL = 5; // minutes

// Simple HTTP server for health checks
const server = Bun.serve({
  port: SERVICE_PORT,
  async fetch(req) {
    const url = new URL(req.url);
    
    if (url.pathname === "/health") {
      const status = await getPollerStatus();
      return Response.json({
        status: "running",
        ...status,
        timestamp: new Date().toISOString(),
      });
    }
    
    if (url.pathname === "/trigger") {
      const result = await pollEmails();
      return Response.json(result);
    }
    
    return Response.json({ error: "Not found" }, { status: 404 });
  },
});

console.log(`📧 Email Poller Service running on port ${SERVICE_PORT}`);

// Main polling loop
async function main() {
  console.log("🚀 Starting Email Poller Service...");
  
  // Initial poll
  await pollEmails();
  
  // Schedule polling
  setInterval(async () => {
    const config = await getPollerConfig();
    if (config.enabled) {
      await pollEmails();
    }
  }, 60 * 1000); // Check every minute
}

interface PollerConfig {
  enabled: boolean;
  interval: number;
  host: string | null;
  port: number;
  user: string | null;
  password: string | null;
  ssl: boolean;
}

async function getPollerConfig(): Promise<PollerConfig> {
  try {
    const configs = await prisma.systemConfig.findMany({
      where: {
        key: {
          in: [
            "EMAIL_POLLER_ENABLED",
            "AUTO_POLL_INTERVAL",
            "IMAP_HOST",
            "IMAP_PORT",
            "IMAP_USER",
            "IMAP_PASSWORD",
            "IMAP_SSL",
          ],
        },
      },
    });

    const configMap = new Map(configs.map((c) => [c.key, c.value]));

    return {
      enabled: configMap.get("EMAIL_POLLER_ENABLED") === "true",
      interval: parseInt(configMap.get("AUTO_POLL_INTERVAL") || `${DEFAULT_INTERVAL}`),
      host: configMap.get("IMAP_HOST") || null,
      port: parseInt(configMap.get("IMAP_PORT") || "993"),
      user: configMap.get("IMAP_USER") || null,
      password: configMap.get("IMAP_PASSWORD") || null,
      ssl: configMap.get("IMAP_SSL") !== "false",
    };
  } catch (error) {
    console.error("Failed to get poller config:", error);
    return {
      enabled: false,
      interval: DEFAULT_INTERVAL,
      host: null,
      port: 993,
      user: null,
      password: null,
      ssl: true,
    };
  }
}

async function getPollerStatus() {
  const config = await getPollerConfig();
  const lastRun = await prisma.systemConfig.findUnique({
    where: { key: "EMAIL_POLLER_LAST_RUN" },
  });
  
  const pendingCount = await prisma.emailQueue.count({
    where: { status: "PENDING" },
  });

  return {
    enabled: config.enabled,
    interval: config.interval,
    isConfigured: !!(config.host && config.user && config.password),
    lastRun: lastRun?.value || null,
    pendingEmails: pendingCount,
  };
}

async function pollEmails(): Promise<{
  success: boolean;
  fetched: number;
  errors: string[];
  timestamp: string;
}> {
  const startTime = Date.now();
  console.log(`📬 [${new Date().toISOString()}] Starting email poll...`);

  const config = await getPollerConfig();
  
  if (!config.enabled) {
    console.log("⏸️ Poller is disabled, skipping...");
    return {
      success: false,
      fetched: 0,
      errors: ["Poller is disabled"],
      timestamp: new Date().toISOString(),
    };
  }

  if (!config.host || !config.user || !config.password) {
    console.log("⚠️ IMAP not configured, skipping...");
    return {
      success: false,
      fetched: 0,
      errors: ["IMAP not configured"],
      timestamp: new Date().toISOString(),
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
    console.log("✅ Connected to IMAP server");
    
    await client.mailboxOpen("INBOX");
    
    // Get unseen messages
    const messages = [];
    for await (const message of client.fetch(
      { unseen: true },
      { source: true, envelope: true }
    )) {
      messages.push(message);
    }

    console.log(`📥 Found ${messages.length} unseen messages`);

    // Process each message
    for (const msg of messages) {
      try {
        const envelope = msg.envelope;
        const source = msg.source?.toString("utf-8") || "";
        
        // Extract body text
        let bodyText = "";
        const textMatch = source.match(/Content-Type: text\/plain[\s\S]*?\r\n\r\n([\s\S]*?)(?=\r\n--|\r\nContent-|$)/i);
        if (textMatch) {
          bodyText = textMatch[1]
            .replace(/=\r\n/g, "")
            .replace(/=([0-9A-F]{2})/g, (_: string, hex: string) => 
              String.fromCharCode(parseInt(hex, 16))
            );
        }

        const fromEmail = parseEmailAddress(
          envelope.from?.[0]?.address || envelope.sender?.[0]?.address || null
        );
        
        const messageId = generateMessageId(
          envelope.subject || "(No Subject)",
          bodyText || source.substring(0, 500),
          fromEmail || ""
        );

        // Check for duplicates
        const existing = await prisma.emailQueue.findUnique({
          where: { messageId },
        });

        if (existing) {
          continue;
        }

        // Determine processing route
        const fromDomain = extractDomain(fromEmail);
        let processingRoute = "manual_review";
        
        if (fromDomain) {
          const senderProfile = await prisma.senderPattern.findUnique({
            where: { senderDomain: fromDomain },
          });
          
          if (senderProfile?.automationLevel === "auto") {
            processingRoute = "auto_create";
          } else if (senderProfile?.automationLevel === "semi_auto") {
            processingRoute = "ai_suggest";
          }
        }

        // Insert into email queue
        await prisma.emailQueue.create({
          data: {
            messageId,
            subject: envelope.subject || null,
            from: fromEmail,
            fromDomain,
            to: envelope.to?.[0]?.address || null,
            bodyText: bodyText.substring(0, 50000) || source.substring(0, 5000),
            bodyHtml: null,
            emailDate: envelope.date || null,
            status: "PENDING",
            processingRoute,
          },
        });

        fetched++;
        console.log(`✉️ Saved: ${envelope.subject?.substring(0, 50)}...`);
      } catch (msgError) {
        errors.push(`Failed to process message: ${msgError}`);
        console.error("❌ Message processing error:", msgError);
      }
    }

    await client.logout();

    // Update last run time
    await prisma.systemConfig.upsert({
      where: { key: "EMAIL_POLLER_LAST_RUN" },
      update: { value: new Date().toISOString() },
      create: { key: "EMAIL_POLLER_LAST_RUN", value: new Date().toISOString() },
    });

    // Create audit log
    await prisma.auditLog.create({
      data: {
        action: "email_poll_completed",
        entityType: "system",
        details: JSON.stringify({ fetched, errors: errors.length, duration: Date.now() - startTime }),
        status: errors.length > 0 ? "WARNING" : "SUCCESS",
        processedBy: "AUTO",
      },
    });

    console.log(`✅ Poll complete: ${fetched} emails fetched in ${Date.now() - startTime}ms`);

    return {
      success: true,
      fetched,
      errors,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    const errorMsg = `IMAP connection failed: ${error}`;
    errors.push(errorMsg);
    console.error("❌ Poll failed:", error);

    await prisma.auditLog.create({
      data: {
        action: "email_poll_failed",
        entityType: "system",
        details: JSON.stringify({ error: errorMsg }),
        status: "ERROR",
        processedBy: "AUTO",
      },
    });

    return {
      success: false,
      fetched,
      errors,
      timestamp: new Date().toISOString(),
    };
  }
}

function generateMessageId(subject: string, body: string, from: string): string {
  const content = `${subject}:${body}:${from}`;
  return crypto.createHash("sha256").update(content).digest("hex");
}

function extractDomain(email: string | null): string | null {
  if (!email) return null;
  const match = email.match(/@([a-zA-Z0-9.-]+)/);
  return match ? match[1].toLowerCase() : null;
}

function parseEmailAddress(address: string | null): string | null {
  if (!address) return null;
  const match = address.match(/<([^>]+)>/) || address.match(/([^\s<>]+@[^\s<>]+)/);
  return match ? match[1] : address;
}

// Start the service
main().catch(console.error);
