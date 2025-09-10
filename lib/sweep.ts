import { Connection, PublicKey, Transaction, Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { 
  getAssociatedTokenAddress, 
  createAssociatedTokenAccountInstruction, 
  createTransferInstruction 
} from "@solana/spl-token";

const SOLANA_DEVNET = "https://api.devnet.solana.com";
const USDC_DEVNET_MINT = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");

export async function sweepFunds(userPrivyId: string, userWalletAddress: string, amount: number) {
  const devPrivateKey = process.env.DEV_WALLET_PRIVATE_KEY;
  const privyAppId = process.env.PRIVY_APP_ID;
  const privyAppSecret = process.env.PRIVY_APP_SECRET;
  const devWalletPublicKey = process.env.DEV_WALLET_PUBLIC_KEY;

  if (!devPrivateKey || !privyAppId || !privyAppSecret || !devWalletPublicKey) {
    throw new Error("Missing server configuration for sweeping funds.");
  }

  const connection = new Connection(SOLANA_DEVNET);
  const devKeypair = Keypair.fromSecretKey(bs58.decode(devPrivateKey));
  const sender = new PublicKey(userWalletAddress);
  const recipient = new PublicKey(devWalletPublicKey);

  const senderTokenAccount = await getAssociatedTokenAddress(USDC_DEVNET_MINT, sender);
  const recipientTokenAccount = await getAssociatedTokenAddress(USDC_DEVNET_MINT, recipient);

  const sweepAmount = amount;

  const tx = new Transaction();

  const recipientInfo = await connection.getAccountInfo(recipientTokenAccount);
  if (!recipientInfo) {
    tx.add(
      createAssociatedTokenAccountInstruction(
        devKeypair.publicKey,
        recipientTokenAccount,
        recipient,
        USDC_DEVNET_MINT
      )
    );
  }

  tx.add(
    createTransferInstruction(
      senderTokenAccount,
      recipientTokenAccount,
      sender,
      sweepAmount * 10 ** 6
    )
  );

  tx.feePayer = devKeypair.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

  const encoded = Buffer.from(`${privyAppId}:${privyAppSecret}`).toString("base64");
  const privyResponse = await fetch(`https://api.privy.io/v1/wallets/${userPrivyId}/rpc`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Basic ${encoded}`,
      "privy-app-id": privyAppId,
    },
    body: JSON.stringify({
      method: "signTransaction",
      params: {
        transaction: tx.serialize({ requireAllSignatures: false }).toString("base64"),
        encoding: "base64",
      },
    }),
  });

  const privyData = await privyResponse.json();
  if (!privyData.data?.signed_transaction) {
    console.error("Privy signing failed during sweep:", privyData);
    throw new Error("User failed to sign sweep transaction via Privy");
  }

  const signedTx = Transaction.from(Buffer.from(privyData.data.signed_transaction, "base64"));
  signedTx.partialSign(devKeypair);
  
  const signature = await connection.sendRawTransaction(signedTx.serialize());
  await connection.confirmTransaction(signature, "confirmed");

  console.log(`Successfully swept ${sweepAmount} USDC from ${userWalletAddress}. Signature: ${signature}`);
  return { signature, sweepAmount };
}

export async function checkUsdcBalance(userWalletAddress: string) {
  const connection = new Connection(SOLANA_DEVNET);
  const userPublicKey = new PublicKey(userWalletAddress);

  try {
    const userTokenAccount = await getAssociatedTokenAddress(USDC_DEVNET_MINT, userPublicKey);
    const tokenBalance = await connection.getTokenAccountBalance(userTokenAccount);

    if (!tokenBalance.value.uiAmount) {
      return 0;
    }

    return tokenBalance.value.uiAmount;
  } catch (error) {
    // If the token account does not exist, it means the balance is 0.
    return 0;
  }
}

export async function sweepAllFunds(userPrivyId: string, userWalletAddress: string) {
  const devPrivateKey = process.env.DEV_WALLET_PRIVATE_KEY;
  const privyAppId = process.env.PRIVY_APP_ID;
  const privyAppSecret = process.env.PRIVY_APP_SECRET;
  const devWalletPublicKey = process.env.DEV_WALLET_PUBLIC_KEY;

  if (!devPrivateKey || !privyAppId || !privyAppSecret || !devWalletPublicKey) {
    throw new Error("Missing server configuration for sweeping funds.");
  }

  const connection = new Connection(SOLANA_DEVNET);
  const devKeypair = Keypair.fromSecretKey(bs58.decode(devPrivateKey));
  const sender = new PublicKey(userWalletAddress);
  const recipient = new PublicKey(devWalletPublicKey);

  const senderTokenAccount = await getAssociatedTokenAddress(USDC_DEVNET_MINT, sender);
  const recipientTokenAccount = await getAssociatedTokenAddress(USDC_DEVNET_MINT, recipient);

  const userAvailableBalance = await checkUsdcBalance(userWalletAddress);
  console.log(`User ${userWalletAddress} has ${userAvailableBalance} USDC available.`);

  if (userAvailableBalance === 0) {
    console.log(`No funds to sweep for wallet ${userWalletAddress}.`);
    return { signature: null, sweepAmount: 0 };
  }

  const tx = new Transaction();

  const recipientInfo = await connection.getAccountInfo(recipientTokenAccount);
  if (!recipientInfo) {
    tx.add(
      createAssociatedTokenAccountInstruction(
        devKeypair.publicKey,
        recipientTokenAccount,
        recipient,
        USDC_DEVNET_MINT
      )
    );
  }

  tx.add(
    createTransferInstruction(
      senderTokenAccount,
      recipientTokenAccount,
      sender,
      userAvailableBalance * 10 ** 6
    )
  );

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  tx.feePayer = devKeypair.publicKey;
  tx.recentBlockhash = blockhash;

  const encoded = Buffer.from(`${privyAppId}:${privyAppSecret}`).toString("base64");
  console.log(`Sweeping all funds for ${userWalletAddress} with Privy App ID: ${privyAppId}`);
  const privyResponse = await fetch(`https://api.privy.io/v1/wallets/${userPrivyId}/rpc`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Basic ${encoded}`,
      "privy-app-id": privyAppId,
    },
    body: JSON.stringify({
      method: "signTransaction",
      params: {
        transaction: tx.serialize({ requireAllSignatures: false }).toString("base64"),
        encoding: "base64",
      },
    }),
  });

  const privyData = await privyResponse.json();
  if (!privyData.data?.signed_transaction) {
    console.error("Privy signing failed during sweep:", privyData);
    throw new Error("User failed to sign sweep transaction via Privy");
  }

  const signedTx = Transaction.from(Buffer.from(privyData.data.signed_transaction, "base64"));
  signedTx.partialSign(devKeypair);
  
  const signature = await connection.sendRawTransaction(signedTx.serialize());
  await connection.confirmTransaction({
    signature,
    blockhash,
    lastValidBlockHeight,
  });

  console.log(`Successfully swept ${userAvailableBalance} USDC from ${userWalletAddress}. Signature: ${signature}`);
  return { signature, sweepAmount: userAvailableBalance };
}
