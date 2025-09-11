import cdp from "@/utils/cdp";

export interface CdpWallet {
  address: string;
}

export async function createWallet(): Promise<CdpWallet> {
  try {
    const account = await cdp.solana.createAccount();
    if (!account || !account.address) {
      throw new Error("Failed to create wallet or wallet is missing expected properties.");
    }
    return {
      address: account.address,
    };
  } catch (error) {
    console.error("Error creating wallet:", error);
    throw new Error("Failed to create wallet.");
  }
}
