const coingeckoApi = process.env.COINGECKO_API_URL;
const coingeckoApiKey = process.env.COINGECKO_API_KEY;

export async function getUsdcPrice(retries = 3, delay = 2000): Promise<number | null> {
  const url = `${coingeckoApi}/simple/price?ids=usd-coin&vs_currencies=usd`;

  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, {
        headers: {
          "accept": "application/json",
          "x-cg-demo-api-key": coingeckoApiKey || '',
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch USDC price: ${response.statusText} (Status: ${response.status})`);
      }

      const data = await response.json();
      
      if (data && data['usd-coin'] && typeof data['usd-coin'].usd === "number") {
        return data['usd-coin'].usd;
      } else {
        throw new Error("Invalid data structure from CoinGecko API.");
      }

    } catch (error: any) {
      console.error(`\n❌ PRICE FETCH ERROR (Attempt ${i + 1}/${retries}):`, error.message);
      if (i < retries - 1) {
        console.log(`Retrying in ${delay / 1000} seconds...`);
        await new Promise(res => setTimeout(res, delay));
        delay *= 2;
      } else {
        console.error("\n❌ All attempts to fetch USDC price failed.");
        return null;
      }
    }
  }
  return null;
}
