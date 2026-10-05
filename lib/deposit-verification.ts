import { PublicKey, ParsedInstruction, PartiallyDecodedInstruction } from "@solana/web3.js";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import { z } from "zod";

import { getSolanaConnection } from "@/lib/solana";
import { getTokenConfig, SupportedChain, SupportedToken } from "@/lib/tokens";
import { optionalEnv } from "@/lib/env";
import { logger } from "@/lib/logger";

interface VerifyDepositParams {
  txId: string;
  walletAddress: string;
  chain: SupportedChain;
  token: SupportedToken;
  amount: number;
}

const SplInstructionSchema = z.object({
  type: z.string().optional(),
  info: z.object({
    destination: z.string().optional(),
    mint: z.string().optional(),
    amount: z.string().optional(),
    tokenAmount: z.object({
      amount: z.string().optional(),
    }).optional(),
  }).optional(),
}).passthrough();

const BaseReceiptSchema = z.object({
  status: z.string().optional(),
  logs: z.array(z.object({
    address: z.string().optional(),
    topics: z.array(z.string()).optional(),
    data: z.string().optional(),
  })).optional(),
}).nullable();

type BaseReceipt = z.infer<typeof BaseReceiptSchema>;

function amountToBaseUnits(amount: number, decimals: number): bigint {
  return BigInt(Math.round(amount * 10 ** decimals));
}

function isParsedInstruction(
  instruction: ParsedInstruction | PartiallyDecodedInstruction
): instruction is ParsedInstruction {
  return "parsed" in instruction;
}

function readSplTransferAmount(instruction: ParsedInstruction, destinationAta: string, mint: string): bigint {
  if (instruction.program !== "spl-token") return 0n;

  const parsed = SplInstructionSchema.safeParse(instruction.parsed);

  if (!parsed.success) return 0n;

  const typed = parsed.data;
  const info = typed.info;

  if (!info || info.destination !== destinationAta) return 0n;

  if (typed.type === "transferChecked" && info.mint === mint) {
    return info.tokenAmount?.amount ? BigInt(info.tokenAmount.amount) : 0n;
  }

  if (typed.type === "transfer" && info.amount) {
    return BigInt(info.amount);
  }

  return 0n;
}

async function verifySolanaDeposit(params: VerifyDepositParams): Promise<boolean> {
  const config = getTokenConfig(params.chain, params.token);

  const destinationAta = await getAssociatedTokenAddress(
    new PublicKey(config.contractOrMint),
    new PublicKey(params.walletAddress)
  );

  const transaction = await getSolanaConnection("confirmed").getParsedTransaction(params.txId, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });

  if (!transaction || transaction.meta?.err) return false;

  const instructions = transaction.transaction.message.instructions.filter(isParsedInstruction);

  const innerInstructions = (transaction.meta?.innerInstructions ?? [])
    .flatMap((entry) => entry.instructions)
    .filter(isParsedInstruction);

  const transferred = [...instructions, ...innerInstructions].reduce(
    (total, instruction) => total + readSplTransferAmount(
      instruction,
      destinationAta.toBase58(),
      config.contractOrMint
    ),
    0n
  );

  return transferred >= amountToBaseUnits(params.amount, config.decimals);
}

async function fetchBaseReceipt(txId: string): Promise<BaseReceipt> {
  const response = await fetch(optionalEnv("BASE_RPC_URL") ?? "https://mainnet.base.org", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getTransactionReceipt", params: [txId] }),
  });

  if (!response.ok) throw new Error(`Base RPC request failed with status ${response.status}`);

  const payload = await response.json();

  if (payload.error) throw new Error(payload.error.message ?? "Base RPC error");

  const parsed = BaseReceiptSchema.safeParse(payload.result);

  if (!parsed.success) throw new Error("Base RPC returned an invalid transaction receipt");

  return parsed.data;
}

async function verifyBaseDeposit(params: VerifyDepositParams): Promise<boolean> {
  const config = getTokenConfig(params.chain, params.token);
  const receipt = await fetchBaseReceipt(params.txId);

  if (!receipt || receipt.status !== "0x1" || !Array.isArray(receipt.logs)) return false;

  const transferTopic = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
  const normalizedContract = config.contractOrMint.toLowerCase();
  const normalizedRecipient = params.walletAddress.toLowerCase().replace(/^0x/, "");
  const recipientTopic = `0x${normalizedRecipient.padStart(64, "0")}`;
  const expectedAmount = amountToBaseUnits(params.amount, config.decimals);

  for (const log of receipt.logs) {
    if (log.address?.toLowerCase() !== normalizedContract) continue;

    if (log.topics?.[0]?.toLowerCase() !== transferTopic) continue;

    if (log.topics?.[2]?.toLowerCase() !== recipientTopic) continue;

    if (!log.data) continue;

    if (BigInt(log.data) >= expectedAmount) return true;
  }

  return false;
}

export async function verifyDepositTransaction(params: VerifyDepositParams): Promise<boolean> {
  if (!Number.isFinite(params.amount) || params.amount <= 0) return false;

  try {
    return params.chain === "solana"
      ? await verifySolanaDeposit(params)
      : await verifyBaseDeposit(params);
  } catch (err) {
    const errorObj = err instanceof Error ? err : new Error(String(err));
    logger.warn("Deposit transaction verification failed", {
      module: "deposit-verification",
      chain: params.chain,
      token: params.token,
      txId: params.txId,
    }, errorObj);

    return false;
  }
}
