import { encodeFunctionData } from "viem";
import cdp from "@/utils/cdp";
import {
  SupportedChain,
  SupportedToken,
  getTokenConfig,
  parseTokenAmountToBaseUnits,
} from "./tokens";
import {
  transferSplFromCdpWallet,
  USDC_MINT,
  USDT_MINT,
} from "./solana";
import { logger } from "./logger";
import { getPlatformFeesWallet } from "./treasury";

const ERC20_TRANSFER_ABI = [
  {
    name: "transfer",
    type: "function",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;

export interface ExecuteSplitPayoutParams {
  senderWalletAddress: string;
  recipientAddress: string;
  feeTreasuryAddress?: string;
  totalAmount: number;
  feePercent?: number; // e.g. 0.05 for 5%
  chain: SupportedChain;
  token: SupportedToken;
  idempotencyKey?: string;
}

export interface SplitPayoutResult {
  payoutTx: string;
  feeTx: string | null;
  payoutAmount: number;
  feeAmount: number;
  chain: SupportedChain;
  token: SupportedToken;
}

export interface ExecuteDirectTransferParams {
  senderWalletAddress: string;
  recipientAddress: string;
  amount: number;
  chain: SupportedChain;
  token: SupportedToken;
  idempotencyKey?: string;
}

export interface DirectTransferResult {
  tx: string;
  amount: number;
  chain: SupportedChain;
  token: SupportedToken;
}

export async function executeDirectTransfer(
  params: ExecuteDirectTransferParams
): Promise<DirectTransferResult> {
  const { senderWalletAddress, recipientAddress, amount, chain, token, idempotencyKey } = params;
  const config = getTokenConfig(chain, token);
  const startTime = Date.now();

  if (amount <= 0 || !isFinite(amount)) {
    throw new Error(`Direct transfer amount must be greater than zero. Received: ${amount}`);
  }

  logger.info("Executing direct token transfer", {
    module: "cdp/transfers",
    chain,
    token,
    senderWalletAddress,
    recipientAddress,
    amount,
  });

  if (chain === "base") {
    const baseUnits = parseTokenAmountToBaseUnits(amount, config.decimals);
    // SAFETY: recipientAddress is formatted as an EVM 0x-hex address
    const recipientEvmAddress = recipientAddress as `0x${string}`;
    // SAFETY: chain === "base"; sender wallet is an EVM 0x-hex address
    const senderEvmAddress = senderWalletAddress as `0x${string}`;
    // SAFETY: chain === "base"; token contract is an EVM 0x-hex address
    const contractEvmAddress = config.contractOrMint as `0x${string}`;

    const callData = encodeFunctionData({
      abi: ERC20_TRANSFER_ABI,
      functionName: "transfer",
      args: [recipientEvmAddress, baseUnits],
    });

    const result = await cdp.evm.sendTransaction({
      address: senderEvmAddress,
      network: "base",
      transaction: {
        to: contractEvmAddress,
        data: callData,
      },
      idempotencyKey,
    });

    logger.info("Base direct transfer confirmed and broadcasted", {
      module: "cdp/transfers",
      txHash: result.transactionHash,
      durationMs: Date.now() - startTime,
    });

    return {
      tx: result.transactionHash,
      amount,
      chain,
      token,
    };
  }

  const mint = token === "USDC" ? USDC_MINT : USDT_MINT;

  const solanaResult = await transferSplFromCdpWallet({
    senderWalletAddress,
    recipientAddress,
    amount,
    mint,
    idempotencyKey,
  });

  return {
    tx: solanaResult.signature,
    amount,
    chain,
    token,
  };
}

export async function executeSplitPayout(
  params: ExecuteSplitPayoutParams
): Promise<SplitPayoutResult> {
  const {
    senderWalletAddress,
    recipientAddress,
    totalAmount,
    feePercent = 0.05,
    chain,
    token,
    idempotencyKey,
  } = params;

  if (totalAmount <= 0 || !isFinite(totalAmount)) {
    throw new Error(`Total amount for payout must be greater than zero. Received: ${totalAmount}`);
  }

  const feeAmount = Number((totalAmount * feePercent).toFixed(6));
  const payoutAmount = Number((totalAmount - feeAmount).toFixed(6));

  const treasuryAddress = params.feeTreasuryAddress || getPlatformFeesWallet(chain);

  if (!treasuryAddress && feeAmount > 0) {
    throw new Error("Treasury wallet address is not configured for platform fee collection.");
  }

  const startTime = Date.now();
  logger.info("Executing split payout transactions (withdrawal + fee)", {
    module: "cdp/transfers",
    chain,
    token,
    senderWalletAddress,
    recipientAddress,
    treasuryAddress,
    totalAmount,
    payoutAmount,
    feeAmount,
  });

  if (chain === "base") {
    const config = getTokenConfig(chain, token);
    // SAFETY: chain === "base"; sender wallet is an EVM 0x-hex address
    const senderEvmAddress = senderWalletAddress as `0x${string}`;
    // SAFETY: chain === "base"; token contract is an EVM 0x-hex address
    const contractEvmAddress = config.contractOrMint as `0x${string}`;

    const payoutUnits = parseTokenAmountToBaseUnits(payoutAmount, config.decimals);
    // SAFETY: recipientAddress is formatted as an EVM 0x-hex address
    const recipientEvmAddress = recipientAddress as `0x${string}`;

    const payoutCallData = encodeFunctionData({
      abi: ERC20_TRANSFER_ABI,
      functionName: "transfer",
      args: [recipientEvmAddress, payoutUnits],
    });

    const payoutResult = await cdp.evm.sendTransaction({
      address: senderEvmAddress,
      network: "base",
      transaction: {
        to: contractEvmAddress,
        data: payoutCallData,
      },
      idempotencyKey: idempotencyKey ? `${idempotencyKey}:payout` : undefined,
    });

    let feeTxHash: string | null = null;

    if (feeAmount > 0 && treasuryAddress) {
      const feeUnits = parseTokenAmountToBaseUnits(feeAmount, config.decimals);
      // SAFETY: treasuryAddress is formatted as an EVM 0x-hex address
      const treasuryEvmAddress = treasuryAddress as `0x${string}`;

      const feeCallData = encodeFunctionData({
        abi: ERC20_TRANSFER_ABI,
        functionName: "transfer",
        args: [treasuryEvmAddress, feeUnits],
      });

      const feeResult = await cdp.evm.sendTransaction({
        address: senderEvmAddress,
        network: "base",
        transaction: {
          to: contractEvmAddress,
          data: feeCallData,
        },
        idempotencyKey: idempotencyKey ? `${idempotencyKey}:fee` : undefined,
      });

      feeTxHash = feeResult.transactionHash;
    }

    logger.info("Base split payout completed with multiple transactions", {
      module: "cdp/transfers",
      payoutTx: payoutResult.transactionHash,
      feeTx: feeTxHash,
      durationMs: Date.now() - startTime,
    });

    return {
      payoutTx: payoutResult.transactionHash,
      feeTx: feeTxHash,
      payoutAmount,
      feeAmount,
      chain,
      token,
    };
  }

  const mint = token === "USDC" ? USDC_MINT : USDT_MINT;

  const payoutResult = await transferSplFromCdpWallet({
    senderWalletAddress,
    recipientAddress,
    amount: payoutAmount,
    mint,
    idempotencyKey: idempotencyKey ? `${idempotencyKey}:payout` : undefined,
  });

  let feeSignature: string | null = null;

  if (feeAmount > 0 && treasuryAddress) {
    const feeResult = await transferSplFromCdpWallet({
      senderWalletAddress,
      recipientAddress: treasuryAddress,
      amount: feeAmount,
      mint,
      idempotencyKey: idempotencyKey ? `${idempotencyKey}:fee` : undefined,
    });

    feeSignature = feeResult.signature;
  }

  logger.info("Solana split payout completed with multiple sponsored transactions", {
    module: "cdp/transfers",
    payoutSignature: payoutResult.signature,
    feeSignature,
    durationMs: Date.now() - startTime,
  });

  return {
    payoutTx: payoutResult.signature,
    feeTx: feeSignature,
    payoutAmount,
    feeAmount,
    chain,
    token,
  };
}
