import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

// GET - Get scheduler status
export async function GET() {
  try {
    const enabledConfig = await db.systemConfig.findUnique({
      where: { key: "EMAIL_POLLER_ENABLED" },
    });
    
    const intervalConfig = await db.systemConfig.findUnique({
      where: { key: "AUTO_POLL_INTERVAL" },
    });

    const lastRunConfig = await db.systemConfig.findUnique({
      where: { key: "EMAIL_POLLER_LAST_RUN" },
    });

    return NextResponse.json({
      enabled: enabledConfig?.value === "true",
      interval: parseInt(intervalConfig?.value || "5"),
      lastRun: lastRunConfig?.value || null,
    });
  } catch (error) {
    console.error("Failed to get scheduler status:", error);
    return NextResponse.json(
      { error: "Failed to get scheduler status" },
      { status: 500 }
    );
  }
}

// POST - Start/Stop scheduler
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const action = body.action; // "start" or "stop"

    if (action === "start") {
      const interval = body.interval || 5; // minutes

      // Update config
      await db.systemConfig.upsert({
        where: { key: "EMAIL_POLLER_ENABLED" },
        update: { value: "true" },
        create: { key: "EMAIL_POLLER_ENABLED", value: "true" },
      });

      await db.systemConfig.upsert({
        where: { key: "AUTO_POLL_INTERVAL" },
        update: { value: interval.toString() },
        create: { key: "AUTO_POLL_INTERVAL", value: interval.toString() },
      });

      // Create audit log
      await db.auditLog.create({
        data: {
          action: "email_poller_started",
          entityType: "system",
          details: JSON.stringify({ interval }),
          status: "SUCCESS",
          processedBy: "MANUAL",
        },
      });

      return NextResponse.json({
        success: true,
        message: `Email poller started with ${interval} minute interval`,
        enabled: true,
        interval,
      });
    }

    if (action === "stop") {
      await db.systemConfig.upsert({
        where: { key: "EMAIL_POLLER_ENABLED" },
        update: { value: "false" },
        create: { key: "EMAIL_POLLER_ENABLED", value: "false" },
      });

      // Create audit log
      await db.auditLog.create({
        data: {
          action: "email_poller_stopped",
          entityType: "system",
          details: JSON.stringify({}),
          status: "SUCCESS",
          processedBy: "MANUAL",
        },
      });

      return NextResponse.json({
        success: true,
        message: "Email poller stopped",
        enabled: false,
      });
    }

    return NextResponse.json(
      { error: "Invalid action. Use 'start' or 'stop'" },
      { status: 400 }
    );
  } catch (error) {
    console.error("Scheduler control error:", error);
    return NextResponse.json(
      { error: "Failed to control scheduler" },
      { status: 500 }
    );
  }
}
