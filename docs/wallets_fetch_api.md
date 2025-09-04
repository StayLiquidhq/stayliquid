# Fetch User Wallets API

This document provides instructions on how to integrate the fetch user wallets endpoint into your frontend application.

## Endpoint

`GET /api/wallets/fetch`

## Description

This endpoint retrieves a list of wallets associated with the authenticated user, including their real-time balances fetched from the Privy API.

## Request

### Headers

| Header        | Description                                                                      |
|---------------|----------------------------------------------------------------------------------|
| `Authorization` | **Required.** A Bearer token for the authenticated user. Format: `Bearer <token>` |

### Example Request

Here is an example of how to call this endpoint using `fetch` in a JavaScript/TypeScript frontend application:

```javascript
async function fetchUserWallets(authToken) {
  const url = '/api/wallets/fetch';
  const options = {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${authToken}`,
      'Content-Type': 'application/json'
    }
  };

  try {
    const response = await fetch(url, options);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    console.log('User Wallets:', data);
    return data;
  } catch (error) {
    console.error('Failed to fetch user wallets:', error);
    // Handle errors appropriately in your UI
  }
}

// Usage:
// const userAuthToken = 'your-user-auth-token';
// fetchUserWallets(userAuthToken);
```

## Responses

### Success Response (200 OK)

A successful request will return a JSON array of wallet objects.

**Example:**

```json
[
  {
    "wallet_id": "a1b2c3d4-e5f6-g7h8-i9j0-k1l2m3n4o5p6",
    "user_id": "123e4567-e89b-12d3-a456-426614174000",
    "address": "0x123...",
    "balance": "1500.00",
    "currency": "USD",
    "created_at": "2023-10-27T10:00:00Z"
  },
  {
    "wallet_id": "b2c3d4e5-f6g7-h8i9-j0k1-l2m3n4o5p6q7",
    "user_id": "123e4567-e89b-12d3-a456-426614174000",
    "address": "0x456...",
    "balance": "3000.00",
    "currency": "USD",
    "created_at": "2023-10-28T11:00:00Z"
  }
]
```

### Error Responses

- **401 Unauthorized:** Returned if the `Authorization` header is missing, invalid, or the token is expired.

  ```json
  {
    "error": "Unauthorized: Missing or invalid Authorization header"
  }
  ```

- **500 Internal Server Error:** Returned if there is an unexpected server error, such as a failure to connect to the database or the Privy API.

  ```json
  {
    "error": "Internal server error"
  }
