import cdp from "@/utils/cdp";
import { SupportedChain, SupportedToken, getTokenConfig } from "./tokens";
import { getOnChainSplBalance, getMultipleOnChainSplBalances, USDC_MINT, USDT_MINT } from "./solana";
import { logger } from "./logger";

export interface GetTokenBalanceParams {
  address: string;
  chain: SupportedChain;
  token: SupportedToken;
}

export interface WalletTokenTarget {
  address: string;
  chain: SupportedChain;
  token: SupportedToken;
}

export async function getOnChainTokenBalance(params: GetTokenBalanceParams): Promise<number> {
  const { address, chain, token } = params;
  const config = getTokenConfig(chain, token);
  const startTime = Date.now();

  if (chain === "base") {
    try {
      // SAFETY: this branch only runs when chain === "base", so address is an EVM 0x-hex address
      const evmAddress = address as `0x${string}`;

      const response = await cdp.evm.listTokenBalances({
        address: evmAddress,
        network: "base",
      });

      if (!response || !Array.isArray(response.balances) || response.balances.length === 0) {
        return 0;
      }

      const match = response.balances.find((b) =>
        b.token.contractAddress.toLowerCase() === config.contractOrMint.toLowerCase()
      );

      if (!match) {
        return 0;
      }

      const rawAmount = match.amount.amount;
      const decimals = match.amount.decimals ?? config.decimals;
      const amountNumber = Number(rawAmount) / (10 ** decimals);

      logger.debug("Retrieved on-chain Base token balance via CDP", {
        module: "cdp/balance",
        chain,
        token,
        address,
        balance: amountNumber,
        durationMs: Date.now() - startTime,
      });

      return amountNumber;
    } catch (err) {
      const errorObj = err instanceof Error ? err : new Error(String(err));
      logger.error("Failed to query Base token balance via CDP", {
        module: "cdp/balance",
        chain,
        token,
        address,
      }, errorObj);
      throw errorObj;
    }
  }

  try {
    const mintPubkey = token === "USDC" ? USDC_MINT : USDT_MINT;
    const balance = await getOnChainSplBalance(address, mintPubkey);

    logger.debug("Retrieved on-chain Solana token balance", {
      module: "cdp/balance",
      chain,
      token,
      address,
      balance,
      durationMs: Date.now() - startTime,
    });

    return balance;
  } catch (err) {
    const errorObj = err instanceof Error ? err : new Error(String(err));
    logger.error("Failed to query Solana token balance", {
      module: "cdp/balance",
      chain,
      token,
      address,
    }, errorObj);
    throw errorObj;
  }
}

export async function getMultipleOnChainTokenBalances(
  targets: WalletTokenTarget[]
): Promise<Map<string, number>> {
  const balanceMap = new Map<string, number>();

  if (targets.length === 0) return balanceMap;

  const solanaUsdcAddresses: string[] = [];
  const solanaUsdtAddresses: string[] = [];
  const baseTargets: WalletTokenTarget[] = [];

  for (const t of targets) {
    if (t.chain === "solana") {
      if (t.token === "USDC") {
        solanaUsdcAddresses.push(t.address);
      } else {
        solanaUsdtAddresses.push(t.address);
      }
    } else {
      baseTargets.push(t);
    }
  }

  const promises: Promise<void>[] = [];

  if (solanaUsdcAddresses.length > 0) {
    promises.push(
      getMultipleOnChainSplBalances(solanaUsdcAddresses, USDC_MINT).then((map) => {
        for (const [addr, bal] of map.entries()) {
          balanceMap.set(addr, bal);
        }
      })
    );
  }

  if (solanaUsdtAddresses.length > 0) {
    promises.push(
      getMultipleOnChainSplBalances(solanaUsdtAddresses, USDT_MINT).then((map) => {
        for (const [addr, bal] of map.entries()) {
          balanceMap.set(addr, bal);
        }
      })
    );
  }

  for (const bt of baseTargets) {
    promises.push(
      getOnChainTokenBalance(bt)
        .then((bal) => {
          balanceMap.set(bt.address, bal);
        })
        .catch(() => {
          balanceMap.set(bt.address, 0);
        })
    );
  }

  await Promise.all(promises);

  return balanceMap;
}
