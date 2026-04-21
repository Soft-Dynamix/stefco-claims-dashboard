import { NextRequest, NextResponse } from "next/server";
import { fetchEmails, getPollingStatus } from "@/lib/email-poller";
import { db } from "@/lib/db";

// GET - Get polling status
export async function GET() {
  try {
    const status = await getPollingStatus();
    
    // Get scheduler status from system config
    const schedulerConfig = await db.systemConfig.findUnique({
      where: { key: "EMAIL_POLLER_ENABLED" },
    });
    
    const intervalConfig = await db.systemConfig.findUnique({
      where: { key: "AUTO_POLL_INTERVAL" },
    });

    return NextResponse.json({
      ...status,
      schedulerEnabled: schedulerConfig?.value === "true",
      pollInterval: parseInt(intervalConfig?.value || "5"),
    });
  } catch (error) {
    console.error("Failed to get polling status:", error);
    return NextResponse.json(
      { error: "Failed to get polling status" },
      { status: 500 }
    );
  }
}

// POST - Trigger manual email poll
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const limit = body.limit || 50;

    const result = await fetchEmails(limit);

    return NextResponse.json({
      success: result.success,
      message: result.success
        ? `Fetched ${result.fetched} new emails`
        : "Failed to fetch emails",
      ...result,
    });
  } catch (error) {
    console.error("Email poll error:", error);
    return NextResponse.json(
      { error: "Failed to poll emails", details: String(error) },
      { status: 500 }
    );
  }
}
