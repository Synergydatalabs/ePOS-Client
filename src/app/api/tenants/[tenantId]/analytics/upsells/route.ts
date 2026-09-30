// GET /api/tenants/[tenantId]/analytics/upsells - Get upsell analytics

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";

// GET - Get upsell analytics
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;

    const validation = await validateRequest(request, tenantId, "POS_MANAGER");
    if (!validation.success) {
      return validation.response;
    }

    const { searchParams } = new URL(request.url);
    const days = parseInt(searchParams.get("days") || "30");

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    // Get upsell rules with their performance
    const rules = await prisma.upsellRule.findMany({
      where: { tenantId },
      select: {
        id: true,
        name: true,
        triggerType: true,
        isActive: true,
        impressions: true,
        acceptances: true,
        createdAt: true,
      },
    });

    // Calculate metrics for each rule
    const ruleMetrics = rules.map((rule) => {
      const conversionRate =
        rule.impressions > 0
          ? ((rule.acceptances / rule.impressions) * 100).toFixed(1)
          : "0.0";

      return {
        id: rule.id,
        name: rule.name,
        triggerType: rule.triggerType,
        isActive: rule.isActive,
        impressions: rule.impressions,
        acceptances: rule.acceptances,
        conversionRate: parseFloat(conversionRate),
        createdAt: rule.createdAt,
      };
    });

    // Sort by conversion rate
    const topPerformers = [...ruleMetrics]
      .sort((a, b) => b.conversionRate - a.conversionRate)
      .slice(0, 5);

    // Summary metrics
    const totalImpressions = rules.reduce((sum, r) => sum + r.impressions, 0);
    const totalAcceptances = rules.reduce((sum, r) => sum + r.acceptances, 0);
    const overallConversionRate =
      totalImpressions > 0
        ? ((totalAcceptances / totalImpressions) * 100).toFixed(1)
        : "0.0";

    return NextResponse.json({
      success: true,
      analytics: {
        summary: {
          totalRules: rules.length,
          activeRules: rules.filter((r) => r.isActive).length,
          totalImpressions,
          totalAcceptances,
          overallConversionRate: parseFloat(overallConversionRate),
        },
        rules: ruleMetrics,
        topPerformers,
        period: {
          days,
          startDate: startDate.toISOString(),
          endDate: new Date().toISOString(),
        },
      },
    });
  } catch (error: any) {
    console.error("[TAP API] Get upsell analytics error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
