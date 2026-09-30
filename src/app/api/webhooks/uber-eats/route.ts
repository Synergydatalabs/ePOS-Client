import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

const UBER_WH_CLIENT_SECRET =
  process.env.UBER_EATS_WH_CLIENT_SECRET ||
  "2f811c20e2c7b869e909f201672a4ffc66f3eb263d8ec8fa8985a80088a25888";

const JWT_SECRET = new TextEncoder().encode(UBER_WH_CLIENT_SECRET);

// Verify the Bearer token Uber sends with each webhook
async function verifyUberToken(request: NextRequest): Promise<boolean> {
  const authHeader = request.headers.get("authorization") || "";
  if (!authHeader.startsWith("Bearer ")) return false;

  const token = authHeader.slice(7);
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return payload.type === "uber_webhook";
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  try {
    // Verify authentication
    const isValid = await verifyUberToken(request);
    if (!isValid) {
      console.warn("[UBER WEBHOOK] Invalid or missing token");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const event = await request.json();
    console.log("[UBER WEBHOOK] Received event:", JSON.stringify(event, null, 2));

    // Handle different event types
    const eventType = event.event_type || event.type || "unknown";

    switch (eventType) {
      case "orders.notification":
        // New order from Uber Eats
        console.log("[UBER WEBHOOK] New order:", event.meta?.resource_id);
        // TODO: Create order in your system
        break;

      case "orders.cancel":
        // Order cancelled
        console.log("[UBER WEBHOOK] Order cancelled:", event.meta?.resource_id);
        // TODO: Cancel order in your system
        break;

      case "orders.payment":
        // Payment update
        console.log("[UBER WEBHOOK] Payment update:", event.meta?.resource_id);
        break;

      default:
        console.log("[UBER WEBHOOK] Unhandled event type:", eventType);
    }

    // Always return 200 to acknowledge receipt
    return NextResponse.json({ status: "ok" });
  } catch (error) {
    console.error("[UBER WEBHOOK] Error processing webhook:", error);
    // Return 200 anyway to prevent Uber from retrying
    return NextResponse.json({ status: "ok" });
  }
}
