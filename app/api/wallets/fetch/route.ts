import { NextRequest, NextResponse } from "next/server";
import supabase from "@/utils/supabase";
import { getUsdcPrice } from "@/lib/coingecko";

interface Wallet {
  id: string;
  privy_id: string;
  address: string;
  created_at: string;
  name?: string;
  plans: {
    plan_type: string;
  }[];
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

async function fetchSolanaUsdcBalance(walletAddress: string, usdcPrice: number) {
  try {
    // Using Helius API
    const heliusApiKey = process.env.HELIUS_API_KEY;
    if (heliusApiKey) {
      const response = await fetch(`https://api.helius.xyz/v0/addresses/${walletAddress}/balances?api-key=${heliusApiKey}`);
      if (response.ok) {
        const data = await response.json();
        const usdcToken = data.tokens?.find((token: any) => 
          token.mint === 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' 
        );
        if (usdcToken) {
          const balance = usdcToken.amount / Math.pow(10, 6);
          return {
            raw_value: usdcToken.amount.toString(),
            display_value: balance.toString(),
            usd_value: (balance * usdcPrice).toString()
          };
        } else {
          // Return a zero balance if no USDC token is found
          return {
            raw_value: '0',
            display_value: '0',
            usd_value: '0'
          };
        }
      } else {
        console.error(`Helius API request failed for ${walletAddress}: ${response.statusText}`);
      }
    } else {
        console.error('HELIUS_API_KEY environment variable not set.');
    }
    // Return zero balance on error as well, to avoid filtering out the wallet
    return {
      raw_value: '0',
      display_value: '0',
      usd_value: '0'
    };
  } catch (error) {
    console.error(`Exception in fetchSolanaUsdcBalance for ${walletAddress}:`, error);
    return {
      raw_value: '0',
      display_value: '0',
      usd_value: '0'
    };
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export async function GET(request: NextRequest) {
  try {
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
    const { data: wallets, error: walletsError } = await supabase
      .from('plans')
      .select(`
        plan_type,
        wallets (
          id,
          privy_id,
          address,
          created_at
        )
      `)
      .eq('user_id', user.id);

    if (walletsError) {
      console.error("Error fetching wallets:", walletsError);
      return NextResponse.json(
        { error: "Failed to fetch user wallets" },
        { status: 500, headers: corsHeaders }
      );
    }

    // 5. Fetch real-time USDC price
    const usdcPrice = await getUsdcPrice();
    if (usdcPrice === null) {
      // Default to 1 if the price fetch fails, to avoid breaking the balance calculation
      return NextResponse.json({ error: "Failed to fetch USDC price" }, { status: 500, headers: corsHeaders });
    }

    // 6. Process wallets and fetch balances
    const walletDetailsPromises = wallets?.flatMap((plan: any, planIndex: number) => 
      plan.wallets.map(async (wallet: any, walletIndex: number) => {
        const balanceData = await fetchSolanaUsdcBalance(wallet.address, usdcPrice);
        return {
          wallet_id: wallet.id,
          name: `vault ${planIndex * plan.wallets.length + walletIndex + 1}`,
          user_id: user.id,
          address: wallet.address,
          balance: balanceData.display_value,
          usd_value: balanceData.usd_value,
          currency: 'USDC',
          created_at: wallet.created_at,
          plan_type: plan.plan_type,
        };
      })
    ) || [];

    const walletDetails = await Promise.all(walletDetailsPromises);

    // 7. Return response
    return NextResponse.json(walletDetails, { status: 200, headers: corsHeaders });

  } catch (err) {
    console.error("Unexpected error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers: corsHeaders }
    );
  }
}
