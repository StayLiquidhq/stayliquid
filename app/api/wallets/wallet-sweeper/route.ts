import { NextRequest, NextResponse } from "next/server";
import { sweepAllFunds } from "../../../../lib/sweep";
import { z } from "zod";

const sweepSchema = z.object({
  privy_id: z.string(),
  wallet_address: z.string(),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const validation = sweepSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { error: validation.error.format() },
        { status: 400 }
      );
    }

    const { privy_id, wallet_address } = validation.data;
    const result = await sweepAllFunds(privy_id, wallet_address);

    return NextResponse.json(result);
  } catch (err: any) {
    console.error("Error sweeping wallet:", err);
    return NextResponse.json(
      { error: "Internal server error", details: err.message },
      { status: 500 }
    );
  }
}
