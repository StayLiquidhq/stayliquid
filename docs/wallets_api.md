# Wallets API Documentation

This documentation provides details on how to interact with the wallets API endpoints.

## Fetch All User Wallets

This endpoint retrieves all wallet addresses and privy IDs for the authenticated user.

- **URL:** `/api/wallets/fetch-all`
- **Method:** `GET`
- **Headers:**
  - `Authorization`: `Bearer <YOUR_AUTH_TOKEN>`

### Responses

- **200 OK:**
  ```json
  [
    {
      "privy_id": "privy_id_1",
      "address": "wallet_address_1"
    },
    {
      "privy_id": "privy_id_2",
      "address": "wallet_address_2"
    }
  ]
  ```
- **401 Unauthorized:** If the authentication token is missing or invalid.
- **500 Internal Server Error:** If there's a server-side error.

### JavaScript Example

```javascript
async function fetchAllWallets(authToken) {
  try {
    const response = await fetch('/api/wallets/fetch-all', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${authToken}`
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const wallets = await response.json();
    console.log('Fetched wallets:', wallets);
    return wallets;
  } catch (error) {
    console.error('Error fetching wallets:', error);
  }
}
