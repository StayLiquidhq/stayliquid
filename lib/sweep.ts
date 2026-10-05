export async function sweepFunds(
  _userWalletAddress?: string,
  _amount?: number
): Promise<never> {
  console.warn(
    "sweepFunds is DEPRECATED and disabled. Funds remain in the user's Coinbase wallet."
  );
  throw new Error(
    "Sweeping funds to dev wallet is disabled in production. Funds must remain in user wallet."
  );
}
