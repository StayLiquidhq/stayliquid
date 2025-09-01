import privy from "../utils/privy";

interface PrivyWallet {
  privyId: string;
  address: string;
}

/**
 * Creates a new Solana wallet using the Privy service.
 * This function centralizes the wallet creation logic, making it reusable and easier to manage.
 *
 * @returns {Promise<PrivyWallet>} A promise that resolves to an object containing the new wallet's Privy ID and address.
 * @throws Will throw an error if the wallet creation fails or if the API response is invalid.
 */
export async function createWallet(): Promise<PrivyWallet> {
  try {
    // Call the Privy API to create a new wallet for the user.
    const wallet = await privy.walletApi.createWallet({
      chainType: "solana",
    });

    const { id, address } = wallet;
    if (!id || !address) {
      throw new Error("Privy API did not return a valid wallet ID or address.");
    }

    return { privyId: id, address };
  } catch (error) {
    console.error("Failed to create Privy wallet:", error);
    throw new Error("An error occurred during the wallet creation process.");
  }
}