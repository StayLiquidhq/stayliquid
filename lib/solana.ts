import {
  Connection,
  PublicKey,
  Transaction,
  ComputeBudgetProgram,
  Commitment,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  AccountLayout,
} from "@solana/spl-token";
import cdp from "@/utils/cdp";
import { logger } from "./logger";
import { getFeesPayerWallet } from "./treasury";

export interface RpcErrorDetails {
  status?: number;
  code?: string | number;
  message?: string;
  endpoint?: string;
  logs?: string[];
  [key: string]: string | number | boolean | null | undefined | string[];
}

export class SolanaRpcError extends Error {
  public readonly code: string;
  public readonly details?: RpcErrorDetails | Error | string;

  constructor(message: string, code: string = "RPC_ERROR", details?: RpcErrorDetails | Error | string) {
    super(message);
    this.name = "SolanaRpcError";
    this.code = code;
    this.details = details;
  }
}

export interface TransferResult {
  signature: string;
  transferredAmount: number;
}

export interface BreakPlanResult {
  signature: string;
  payoutAmount: number;
  feeAmount: number;
}

function getRpcUrl(): string {
  if (process.env.SOLANA_RPC_URL) {
    return process.env.SOLANA_RPC_URL;
  }

  return "https://api.mainnet-beta.solana.com";
}

export function getSolanaConnection(commitment: Commitment = "confirmed"): Connection {
  return new Connection(getRpcUrl(), {
    commitment,
    confirmTransactionInitialTimeout: 60000,
  });
}

export const USDC_MINT = new PublicKey(
  process.env.USDC_MINT || "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
);

export const USDT_MINT = new PublicKey(
  process.env.USDT_MINT || "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"
);

interface ObjectWithMessage {
  message: string;
}

function hasErrorMessage(err: Error | { message?: string } | null | undefined): err is ObjectWithMessage {
  return Boolean(err && typeof err === "object" && "message" in err && typeof err.message === "string");
}

function isTokenAccountNotFoundError(err: Error | { message?: string } | null | undefined): boolean {
  if (hasErrorMessage(err)) {
    const msg = err.message.toLowerCase();

    return (
      msg.includes("could not find account") ||
      msg.includes("account not found") ||
      msg.includes("failed to find token account") ||
      msg.includes("invalid param: could not find account")
    );
  }

  return false;
}

export async function getOnChainSplBalance(
  walletAddress: string,
  mint: PublicKey = USDC_MINT
): Promise<number> {
  const startTime = Date.now();
  let userPublicKey: PublicKey;

  try {
    userPublicKey = new PublicKey(walletAddress);
  } catch (parseError) {
    const errorObj = parseError instanceof Error ? parseError : new Error(String(parseError));
    logger.error("Invalid Solana wallet address format", {
      module: "solana",
      walletAddress,
    }, errorObj);
    throw new SolanaRpcError(`Invalid Solana address: ${walletAddress}`, "INVALID_ADDRESS", errorObj);
  }

  const connection = getSolanaConnection();

  try {
    const userAta = await getAssociatedTokenAddress(mint, userPublicKey);
    const balanceResp = await connection.getTokenAccountBalance(userAta);
    const uiAmount = balanceResp.value.uiAmount ?? 0;

    logger.debug("Successfully fetched on-chain SPL token balance", {
      module: "solana",
      walletAddress,
      mint: mint.toBase58(),
      ata: userAta.toBase58(),
      balance: uiAmount,
      durationMs: Date.now() - startTime,
    });

    return uiAmount;
  } catch (err) {
    const errorObj = err instanceof Error ? err : new Error(String(err));

    if (isTokenAccountNotFoundError(errorObj)) {
      logger.debug("Token account uninitialized, treating balance as 0", {
        module: "solana",
        walletAddress,
        mint: mint.toBase58(),
        durationMs: Date.now() - startTime,
      });

      return 0;
    }

    logger.error("Failed to query on-chain SPL token balance from Solana RPC", {
      module: "solana",
      walletAddress,
      mint: mint.toBase58(),
      durationMs: Date.now() - startTime,
    }, errorObj);

    throw new SolanaRpcError(
      `Failed to fetch on-chain balance for ${walletAddress}: ${errorObj.message}`,
      "RPC_FETCH_ERROR",
      errorObj
    );
  }
}

export async function getOnChainUsdcBalance(walletAddress: string): Promise<number> {
  return getOnChainSplBalance(walletAddress, USDC_MINT);
}

export async function getOnChainUsdtBalance(walletAddress: string): Promise<number> {
  return getOnChainSplBalance(walletAddress, USDT_MINT);
}

export async function getMultipleOnChainSplBalances(
  walletAddresses: string[],
  mint: PublicKey = USDC_MINT
): Promise<Map<string, number>> {
  const balanceMap = new Map<string, number>();

  if (walletAddresses.length === 0) return balanceMap;

  const connection = getSolanaConnection();
  const startTime = Date.now();

  const parsedWallets: { originalAddress: string; ata: PublicKey }[] = [];

  for (const addr of walletAddresses) {
    try {
      const pubkey = new PublicKey(addr);
      const ata = await getAssociatedTokenAddress(mint, pubkey);
      parsedWallets.push({ originalAddress: addr, ata });
    } catch {
      logger.warn("Skipping invalid wallet address during batch balance query", {
        module: "solana",
        address: addr,
      });
      balanceMap.set(addr, 0);
    }
  }

  const CHUNK_SIZE = 100;

  for (let i = 0; i < parsedWallets.length; i += CHUNK_SIZE) {
    const chunk = parsedWallets.slice(i, i + CHUNK_SIZE);
    const ataKeys = chunk.map((c) => c.ata);

    try {
      const accountsInfo = await connection.getMultipleAccountsInfo(ataKeys, "confirmed");

      for (let j = 0; j < chunk.length; j++) {
        const item = chunk[j];
        const accountInfo = accountsInfo[j];

        if (!accountInfo || !accountInfo.data) {
          balanceMap.set(item.originalAddress, 0);
          continue;
        }

        try {
          const rawAccount = AccountLayout.decode(accountInfo.data);
          const uiAmount = Number(rawAccount.amount) / 1_000_000;
          balanceMap.set(item.originalAddress, uiAmount);
        } catch (decodeErr) {
          const decodeErrObj = decodeErr instanceof Error ? decodeErr : new Error(String(decodeErr));
          logger.warn("Failed to decode token account data, defaulting to 0", {
            module: "solana",
            walletAddress: item.originalAddress,
            ata: item.ata.toBase58(),
          }, decodeErrObj);
          balanceMap.set(item.originalAddress, 0);
        }
      }
    } catch (rpcErr) {
      const rpcErrObj = rpcErr instanceof Error ? rpcErr : new Error(String(rpcErr));
      logger.error("Failed batch getMultipleAccountsInfo from Solana RPC", {
        module: "solana",
        chunkSize: chunk.length,
        durationMs: Date.now() - startTime,
      }, rpcErrObj);

      for (const item of chunk) {
        if (!balanceMap.has(item.originalAddress)) {
          balanceMap.set(item.originalAddress, 0);
        }
      }
    }
  }

  logger.debug("Batch queried on-chain balances", {
    module: "solana",
    totalWallets: walletAddresses.length,
    durationMs: Date.now() - startTime,
  });

  return balanceMap;
}

export async function getMultipleOnChainUsdcBalances(
  walletAddresses: string[]
): Promise<Map<string, number>> {
  return getMultipleOnChainSplBalances(walletAddresses, USDC_MINT);
}

export async function transferSplFromCdpWallet({
  senderWalletAddress,
  recipientAddress,
  amount,
  mint = USDC_MINT,
  idempotencyKey,
}: {
  senderWalletAddress: string;
  recipientAddress: string;
  amount: number;
  mint?: PublicKey;
  idempotencyKey?: string;
}): Promise<TransferResult> {
  const startTime = Date.now();

  if (amount <= 0 || !isFinite(amount)) {
    throw new SolanaRpcError(
      `Transfer amount must be a positive finite number. Received: ${amount}`,
      "INVALID_AMOUNT"
    );
  }

  logger.info("Initiating direct transfer from user Coinbase CDP wallet", {
    module: "solana",
    senderWalletAddress,
    recipientAddress,
    amount,
    mint: mint.toBase58(),
  });

  const connection = getSolanaConnection("confirmed");
  const sender = new PublicKey(senderWalletAddress);
  const recipient = new PublicKey(recipientAddress);
  const feePayer = new PublicKey(getFeesPayerWallet());

  const senderTokenAccount = await getAssociatedTokenAddress(mint, sender);
  const recipientTokenAccount = await getAssociatedTokenAddress(mint, recipient);

  const tx = new Transaction();

  tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50000 }));

  const recipientInfo = await connection.getAccountInfo(recipientTokenAccount);

  if (!recipientInfo) {
    logger.info("Recipient ATA does not exist. Adding creation instruction.", {
      module: "solana",
      recipientTokenAccount: recipientTokenAccount.toBase58(),
    });
    tx.add(
      createAssociatedTokenAccountInstruction(
        feePayer,
        recipientTokenAccount,
        recipient,
        mint
      )
    );
  }

  const baseUnits = Math.round(amount * 10 ** 6);
  tx.add(
    createTransferInstruction(
      senderTokenAccount,
      recipientTokenAccount,
      sender,
      baseUnits
    )
  );

  tx.feePayer = feePayer;
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;

  const serializedTx = Buffer.from(
    tx.serialize({ requireAllSignatures: false })
  ).toString("base64");

  const senderSignedResponse = await cdp.solana.signTransaction({
    address: senderWalletAddress,
    transaction: serializedTx,
    idempotencyKey: idempotencyKey ? `${idempotencyKey}:sender-sign` : undefined,
  });

  const feePayerSignedResponse = await cdp.solana.signTransaction({
    address: feePayer.toBase58(),
    transaction: senderSignedResponse.signature,
    idempotencyKey: idempotencyKey ? `${idempotencyKey}:fee-payer-sign` : undefined,
  });

  const rawTx = Buffer.from(feePayerSignedResponse.signature, "base64");

  const signature = await connection.sendRawTransaction(rawTx, {
    skipPreflight: false,
    preflightCommitment: "confirmed",
  });

  const confirmation = await connection.confirmTransaction(
    {
      signature,
      blockhash,
      lastValidBlockHeight,
    },
    "confirmed"
  );

  if (confirmation.value.err) {
    logger.error("Solana transaction confirmed with error", {
      module: "solana",
      signature,
      errorDetails: confirmation.value.err,
    });
    throw new SolanaRpcError(
      `Transaction ${signature} failed on-chain: ${JSON.stringify(confirmation.value.err)}`,
      "ONCHAIN_TX_FAILED",
      confirmation.value.err
    );
  }

  logger.info("Direct transfer confirmed successfully on Solana", {
    module: "solana",
    signature,
    senderWalletAddress,
    recipientAddress,
    amount,
    durationMs: Date.now() - startTime,
  });

  return { signature, transferredAmount: amount };
}

export async function transferUsdcFromCdpWallet(params: {
  senderWalletAddress: string;
  recipientAddress: string;
  amount: number;
}): Promise<TransferResult> {
  return transferSplFromCdpWallet({ ...params, mint: USDC_MINT });
}

export async function breakPlanFromCdpWallet({
  senderWalletAddress,
  recipientAddress,
  feeTreasuryAddress,
  totalBalance,
  feePercentage = 0.05,
  mint = USDC_MINT,
}: {
  senderWalletAddress: string;
  recipientAddress: string;
  feeTreasuryAddress: string;
  totalBalance: number;
  feePercentage?: number;
  mint?: PublicKey;
}): Promise<BreakPlanResult> {
  const startTime = Date.now();

  if (totalBalance <= 0 || !isFinite(totalBalance)) {
    throw new SolanaRpcError(
      `Break balance must be greater than zero. Received: ${totalBalance}`,
      "INVALID_AMOUNT"
    );
  }

  const feeAmount = Number((totalBalance * feePercentage).toFixed(6));
  const payoutAmount = Number((totalBalance - feeAmount).toFixed(6));
  const treasuryAddress = feeTreasuryAddress;

  logger.info("Initiating atomic plan break transaction", {
    module: "solana",
    senderWalletAddress,
    recipientAddress,
    treasuryAddress,
    totalBalance,
    payoutAmount,
    feeAmount,
    mint: mint.toBase58(),
  });

  const connection = getSolanaConnection("confirmed");
  const sender = new PublicKey(senderWalletAddress);
  const recipient = new PublicKey(recipientAddress);
  const treasury = new PublicKey(treasuryAddress);
  const feePayer = new PublicKey(getFeesPayerWallet());

  const senderTokenAccount = await getAssociatedTokenAddress(mint, sender);
  const recipientTokenAccount = await getAssociatedTokenAddress(mint, recipient);
  const treasuryTokenAccount = await getAssociatedTokenAddress(mint, treasury);

  const tx = new Transaction();
  tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50000 }));

  const recipientInfo = await connection.getAccountInfo(recipientTokenAccount);

  if (!recipientInfo) {
    tx.add(
      createAssociatedTokenAccountInstruction(
        feePayer,
        recipientTokenAccount,
        recipient,
        mint
      )
    );
  }

  const treasuryInfo = await connection.getAccountInfo(treasuryTokenAccount);

  if (!treasuryInfo) {
    tx.add(
      createAssociatedTokenAccountInstruction(
        feePayer,
        treasuryTokenAccount,
        treasury,
        mint
      )
    );
  }

  tx.add(
    createTransferInstruction(
      senderTokenAccount,
      recipientTokenAccount,
      sender,
      Math.round(payoutAmount * 10 ** 6)
    )
  );

  if (feeAmount > 0) {
    tx.add(
      createTransferInstruction(
        senderTokenAccount,
        treasuryTokenAccount,
        sender,
        Math.round(feeAmount * 10 ** 6)
      )
    );
  }

  tx.feePayer = feePayer;
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;

  const serializedTx = Buffer.from(
    tx.serialize({ requireAllSignatures: false })
  ).toString("base64");

  const senderSigned = await cdp.solana.signTransaction({
    address: senderWalletAddress,
    transaction: serializedTx,
  });

  const feePayerSigned = await cdp.solana.signTransaction({
    address: feePayer.toBase58(),
    transaction: senderSigned.signature,
  });

  const rawTx = Buffer.from(feePayerSigned.signature, "base64");

  const signature = await connection.sendRawTransaction(rawTx, {
    skipPreflight: false,
    preflightCommitment: "confirmed",
  });

  const confirmation = await connection.confirmTransaction(
    {
      signature,
      blockhash,
      lastValidBlockHeight,
    },
    "confirmed"
  );

  if (confirmation.value.err) {
    logger.error("Solana break transaction confirmed with error", {
      module: "solana",
      signature,
      errorDetails: confirmation.value.err,
    });
    throw new SolanaRpcError(
      `Break transaction ${signature} failed on-chain: ${JSON.stringify(confirmation.value.err)}`,
      "ONCHAIN_BREAK_FAILED",
      confirmation.value.err
    );
  }

  logger.info("Plan break transaction confirmed successfully on Solana", {
    module: "solana",
    signature,
    payoutAmount,
    feeAmount,
    durationMs: Date.now() - startTime,
  });

  return { signature, payoutAmount, feeAmount };
}
