import { NextRequest, NextResponse } from "next/server";
import supabase from "@/utils/supabase";
import { getUsdcPrice } from "@/lib/coingecko";

interface Plan {
  id: string;
  plan_type: string;
  name: string;
  wallets: WalletData[];
}

interface WalletData {
  id: string;
  address: string;
  created_at: string;
  balance: string | number;
}

// Strict CORS allowlist (aligned with other routes)
const ALLOWED_ORIGINS = new Set<string>([
  "https://liquid-frontend-gray.vercel.app",
  "https://liquid-frontend-aq6izit64-pleaseamsorry3-gmailcoms-projects.vercel.app",
  "https://savewithliquid.xyz",
  "https://savewithliquid.com",
  "http://localhost:3000",
]);

function createCorsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    Vary: "Origin",
  };
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get("origin");
  const headers = createCorsHeaders(origin);
  headers["Access-Control-Max-Age"] = "600";
  return new NextResponse(null, { status: 204, headers });
}

export async function GET(request: NextRequest) {
  const origin = request.headers.get("origin");
  const corsHeaders = createCorsHeaders(origin);
  try {
    // Enforce allowlist only when Origin header is present (browser requests)
    if (origin && !ALLOWED_ORIGINS.has(origin)) {
      return NextResponse.json(
        { error: "Origin not allowed" },
        { status: 403, headers: corsHeaders }
      );
    }
    // 1. Extract and validate the Bearer token from the header
    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json(
        { error: "Unauthorized: Missing or invalid Authorization header" },
        { status: 401, headers: corsHeaders }
      );
    }
    const token = authHeader.split(" ")[1];

    // 2. Verify the token and retrieve the authenticated user
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json(
        { error: "Unauthorized: Invalid or expired token" },
        { status: 401, headers: corsHeaders }
      );
    }

    // 3. Fetch user's wallets and associated plan types
    const { data: plans, error: plansError } = await supabase
      .from("plans")
      .select(
        `
        id,
        plan_type,
        name,
        wallets (
          id,
          address,
          created_at,
          balance
        )
      `
      )
      .eq("user_id", user.id);

    if (plansError) {
      console.error("Error fetching wallets:", plansError);
      return NextResponse.json(
        { error: "Failed to fetch user wallets" },
        { status: 500, headers: corsHeaders }
      );
    }

    // 5. Fetch real-time USDC price
    const usdcPrice = await getUsdcPrice();
    if (usdcPrice === null) {
      // Default to 1 if the price fetch fails, to avoid breaking the balance calculation
      return NextResponse.json(
        { error: "Failed to fetch USDC price" },
        { status: 500, headers: corsHeaders }
      );
    }

    // 6. Process wallets and calculate USD value
    const walletDetails =
      plans?.flatMap((plan: Plan) =>
        plan.wallets.map((wallet: WalletData) => {
          const balance = Number(wallet.balance) || 0;
          const usdValue = balance * usdcPrice;
          return {
            wallet_id: wallet.id,
            name: plan.name,
            user_id: user.id,
            address: wallet.address,
            balance: balance.toString(),
            usd_value: usdValue.toString(),
            currency: "USDC",
            created_at: wallet.created_at,
            plan_type: plan.plan_type,
            plan_id: plan.id,
          };
        })
      ) || [];

    // 7. Return response
    return NextResponse.json(walletDetails, {
      status: 200,
      headers: corsHeaders,
    });
  } catch (err) {
    console.error("Unexpected error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers: corsHeaders }
    );
  }
}
