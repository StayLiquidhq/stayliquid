import test from "node:test";
import assert from "node:assert/strict";
import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import {
  getOnChainUsdcBalance,
  getMultipleOnChainUsdcBalances,
  SolanaRpcError,
  USDC_MINT,
} from "../lib/solana";

const RPC_ENDPOINT = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";

test("Solana RPC: should fetch latest blockhash and parse block height", async () => {
  const connection = new Connection(RPC_ENDPOINT, "confirmed");
  const startTime = Date.now();
  const latestBlock = await connection.getLatestBlockhash("confirmed");

  console.log("✔ [Solana RPC Response] getLatestBlockhash:", {
    endpoint: RPC_ENDPOINT,
    blockhash: latestBlock.blockhash,
    lastValidBlockHeight: latestBlock.lastValidBlockHeight,
    latencyMs: Date.now() - startTime,
  });

  assert.equal(typeof latestBlock.blockhash, "string");
  assert.ok(latestBlock.blockhash.length > 30);
  assert.equal(typeof latestBlock.lastValidBlockHeight, "number");
  assert.ok(latestBlock.lastValidBlockHeight > 0);
});

test("Solana RPC: should query uninitialized wallet and return 0 USDC without throwing", async () => {
  // Fresh random wallet that has never initialized a USDC token account
  const freshWallet = Keypair.generate().publicKey.toBase58();
  const startTime = Date.now();
  const balance = await getOnChainUsdcBalance(freshWallet);

  console.log("✔ [Solana RPC Response] Uninitialized wallet on-chain balance (handled cleanly as 0):", {
    wallet: freshWallet,
    balanceUsdc: balance,
    latencyMs: Date.now() - startTime,
  });

  assert.equal(balance, 0);
});

test("Solana RPC: should query active wallet and parse live USDC balance", async () => {
  const knownActiveWallet = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
  const startTime = Date.now();
  const balance = await getOnChainUsdcBalance(knownActiveWallet);

  console.log("✔ [Solana RPC Response] Verified active wallet live on-chain balance:", {
    wallet: knownActiveWallet,
    balanceUsdc: balance,
    latencyMs: Date.now() - startTime,
  });

  assert.ok(balance > 0, "Expected active wallet to hold USDC on-chain");
});

test("Solana RPC: should derive Associated Token Address (ATA) for USDC mint", async () => {
  const knownAddress = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
  const parsedAta = await getAssociatedTokenAddress(USDC_MINT, knownAddress);

  console.log("✔ [Solana RPC Derived ATA]:", {
    owner: knownAddress.toBase58(),
    mint: USDC_MINT.toBase58(),
    ata: parsedAta.toBase58(),
  });

  assert.ok(parsedAta.toBase58().length > 30);
});

test("Solana RPC: should batch query multiple wallet balances via getMultipleAccountsInfo", async () => {
  const wallets = [
    "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
    Keypair.generate().publicKey.toBase58(),
  ];

  const startTime = Date.now();
  const balances = await getMultipleOnChainUsdcBalances(wallets);

  console.log("✔ [Solana RPC Response] Batch getMultipleAccountsInfo parsed:", {
    totalQueried: balances.size,
    results: Object.fromEntries(balances),
    latencyMs: Date.now() - startTime,
  });

  assert.equal(balances.size, 2);
  assert.ok((balances.get(wallets[0]) ?? 0) > 0);
  assert.equal(balances.get(wallets[1]), 0);
});

test("Solana RPC: should handle invalid address and throw typed SolanaRpcError", async () => {
  const invalidAddress = "not-a-valid-solana-address";

  await assert.rejects(
    async () => {
      await getOnChainUsdcBalance(invalidAddress);
    },
    (err: Error) => {
      assert.ok(err instanceof SolanaRpcError);
      assert.equal(err.code, "INVALID_ADDRESS");
      console.log("✔ [Solana RPC Error Handling] Caught expected typed error:", {
        name: err.name,
        code: err.code,
        message: err.message,
      });

      return true;
    }
  );
});
