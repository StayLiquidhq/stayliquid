import cdp from "@/utils/cdp";
import { SupportedChain } from "./tokens";
import { logger } from "./logger";

export interface CreateWalletOptions {
  chain?: SupportedChain;
}

export interface CdpWallet {
  address: string;
  chain_type: SupportedChain;
}

export async function createWallet(options?: CreateWalletOptions): Promise<CdpWallet> {
  const chain: SupportedChain = options?.chain ?? "solana";

  try {
    let address: string;

    if (chain === "base") {
      const account = await cdp.evm.createAccount();

      if (!account || !account.address) {
        throw new Error("Failed to create Base wallet: account or address is missing from CDP response.");
      }

      address = account.address;
    } else {
      const account = await cdp.solana.createAccount();

      if (!account || !account.address) {
        throw new Error("Failed to create Solana wallet: account or address is missing from CDP response.");
      }

      address = account.address;
    }

    logger.info("Successfully created new Coinbase CDP wallet", {
      module: "cdp/create-wallet",
      chain,
      address,
    });

    return {
      address,
      chain_type: chain,
    };
  } catch (error) {
    const errorObj = error instanceof Error ? error : new Error(String(error));
    logger.error("Error creating Coinbase CDP wallet", {
      module: "cdp/create-wallet",
      chain,
    }, errorObj);
    throw new Error(
      `Failed to create ${chain} wallet: ${errorObj.message}`
    );
  }
}
