# Transaction History API Documentation

This document provides instructions on how to integrate the transaction history feature into the frontend application.

## Endpoint

- **URL:** `/api/transactions/fetch`
- **Method:** `POST`

## Authorization

This is a protected endpoint and requires a valid user authentication token.

- **Header:** `Authorization: Bearer <YOUR_USER_JWT_TOKEN>`

Replace `<YOUR_USER_JWT_TOKEN>` with the user's session token provided by Supabase Auth.

## Request Body

The request body must be a JSON object containing the `wallet_id` for which to fetch the history.

- **Content-Type:** `application/json`

### Example Request Body:

```json
{
  "wallet_id": "a1b2c3d4-e5f6-7890-1234-567890abcdef"
}
```

## Responses

### Success Response (Status 200)

On a successful request, the API will return a JSON object containing an array of transaction objects. The transactions will be ordered from newest to oldest.

#### Example Success Response Body:

```json
{
  "transactions": [
    {
      "id": 101,
      "wallet_id": "a1b2c3d4-e5f6-7890-1234-567890abcdef",
      "type": "debit",
      "amount": 200,
      "currency": "USDC",
      "description": "Sent to EPwlk2uuQhXkg3...Sfn",
      "solana_signature": "2jACEzJHmQtnsuE5SLnEvuCGjfXzNr34atPSFcYoAzc5...",
      "created_at": "2025-09-07T05:20:00.123Z"
    },
    {
      "id": 100,
      "wallet_id": "a1b2c3d4-e5f6-7890-1234-567890abcdef",
      "type": "credit",
      "amount": 500,
      "currency": "USDC",
      "description": "Received from webhook",
      "solana_signature": null,
      "created_at": "2025-09-07T04:15:00.456Z"
    }
  ]
}
```

### Error Responses

- **Status 400 (Bad Request):** The `wallet_id` was not provided in the request body.
  ```json
  { "error": "Missing wallet_id" }
  ```
- **Status 401 (Unauthorized):** The `Authorization` header is missing or the token is invalid.
  ```json
  { "error": "Unauthorized" }
  ```
- **Status 403 (Forbidden):** The user does not own the wallet for which they are requesting history.
  ```json
  { "error": "Forbidden or wallet not found" }
  ```
- **Status 500 (Internal Server Error):** A database error or other unexpected server error occurred.
  ```json
  { "error": "Failed to fetch transaction history" }
  ```

## Frontend Integration Example (React/Next.js)

Here is an example of how you might fetch and display the transaction history in a React component.

```jsx
import { useState, useEffect } from 'react';

// Assume you have a way to get the user's token and wallet ID
const USER_TOKEN = 'your-supabase-jwt';
const WALLET_ID = 'your-wallet-uuid';

const TransactionHistory = () => {
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchHistory = async () => {
      try {
        setLoading(true);
        const response = await fetch('/api/transactions/fetch', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${USER_TOKEN}`,
          },
          body: JSON.stringify({ wallet_id: WALLET_ID }),
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || 'Failed to fetch data');
        }

        const data = await response.json();
        setTransactions(data.transactions);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchHistory();
  }, []);

  if (loading) return <div>Loading...</div>;
  if (error) return <div>Error: {error}</div>;

  return (
    <div>
      {transactions.map((tx) => (
        <div key={tx.id} style={{ border: '1px solid #ccc', margin: '10px', padding: '10px' }}>
          <p><strong>Type:</strong> {tx.type}</p>
          <p><strong>Amount:</strong> {tx.type === 'debit' ? '-' : '+'}${tx.amount} {tx.currency}</p>
          <p><strong>Description:</strong> {tx.description}</p>
          <p><strong>Date:</strong> {new Date(tx.created_at).toLocaleString()}</p>
        </div>
      ))}
    </div>
  );
};

export default TransactionHistory;
