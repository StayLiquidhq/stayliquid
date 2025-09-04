# Create Plan API Documentation

This document provides instructions for frontend developers on how to integrate with the `plans/create` endpoint to create a new savings plan for a user.

## Endpoint

- **URL**: `/api/plans/create`
- **Method**: `POST`
- **Description**: Creates a new savings plan and an associated wallet for the authenticated user.

## Authentication

This endpoint requires user authentication. You must include a valid Supabase JSON Web Token (JWT) in the `Authorization` header of your request.

- **Header**: `Authorization: Bearer YOUR_SUPABASE_JWT`

Replace `YOUR_SUPABASE_JWT` with the user's actual JWT.

## Request Body

The request body must be a JSON object containing the plan details and payout information. The structure of the body depends on the `plan_type` and `payout_method`.

### Plan Types

There are three types of plans: `locked`, `flexible`, and `target`.

#### 1. Locked Plan

A plan with a fixed recurring payout amount and frequency.

**Required Fields**:
- `plan_type`: `"locked"`
- `received_amount`: `number` (The amount the user will receive)
- `recurrent_payout`: `number` (The recurring payout amount)
- `frequency`: `string` (e.g., "monthly", "weekly")
- `payout_time`: `string` (e.g., "10:00 AM")

#### 2. Flexible Plan

Similar to a locked plan but allows for more flexibility.

**Required Fields**:
- `plan_type`: `"flexible"`
- `received_amount`: `number`
- `recurrent_payout`: `number`
- `frequency`: `string`
- `payout_time`: `string`

#### 3. Target Plan

A plan where the user saves towards a specific amount or by a certain date.

**Required Fields**:
- `plan_type`: `"target"`
- `target_type`: `enum("amount", "date")`
- `target_amount`: `number` (Required if `target_type` is "amount")
- `target_date`: `string` (Required if `target_type` is "date", e.g., "2024-12-31")

### Payout Methods

There are two payout methods: `fiat` and `crypto`.

#### 1. Fiat Payout

For payouts to a traditional bank account.

**Required Fields**:
- `payout_method`: `"fiat"`
- `payout_account_number`: `string`
- `bank_name`: `string`
- `account_name`: `string`

#### 2. Crypto Payout

For payouts to a cryptocurrency wallet.

**Required Fields**:
- `payout_method`: `"crypto"`
- `payout_wallet_address`: `string`

---

## Example Requests

Below are example request bodies for different scenarios.

### Example 1: Locked Plan with Fiat Payout

```json
{
  "plan_type": "locked",
  "received_amount": 1000,
  "recurrent_payout": 100,
  "frequency": "monthly",
  "payout_time": "09:00",
  "payout_method": "fiat",
  "payout_account_number": "1234567890",
  "bank_name": "Example Bank",
  "account_name": "John Doe"
}
```

### Example 2: Target Plan (Amount) with Crypto Payout

```json
{
  "plan_type": "target",
  "target_type": "amount",
  "target_amount": 5000,
  "payout_method": "crypto",
  "payout_wallet_address": "0xAbCdEfGhIjKlMnOpQrStUvWxYz1234567890"
}
```

### Example 3: Target Plan (Date) with Fiat Payout

```json
{
  "plan_type": "target",
  "target_type": "date",
  "target_date": "2025-01-01",
  "payout_method": "fiat",
  "payout_account_number": "0987654321",
  "bank_name": "Another Bank",
  "account_name": "Jane Smith"
}
```

---

## Example `curl` Request

Here is a complete `curl` command to test the endpoint. Remember to replace `YOUR_SUPABASE_JWT` with a valid token.

```bash
curl -X POST http://localhost:3000/api/plans/create \
-H "Authorization: Bearer YOUR_SUPABASE_JWT" \
-H "Content-Type: application/json" \
-d '{
  "plan_type": "locked",
  "received_amount": 1000,
  "recurrent_payout": 100,
  "frequency": "monthly",
  "payout_time": "09:00",
  "payout_method": "fiat",
  "payout_account_number": "1234567890",
  "bank_name": "Example Bank",
  "account_name": "John Doe"
}'
```

---

## Responses

### Success Response (Status 201)

A successful request will return a JSON object containing the newly created plan and wallet.

```json
{
  "plan": {
    "id": 1,
    "user_id": 123,
    "plan_type": "locked",
    "details": {
      "plan_type": "locked",
      "received_amount": 1000,
      "recurrent_payout": 100,
      "frequency": "monthly",
      "payout_time": "09:00",
      "payout_method": "fiat",
      "payout_account_number": "1234567890",
      "bank_name": "Example Bank",
      "account_name": "John Doe"
    },
    "created_at": "2023-10-27T10:00:00Z"
  },
  "wallet": {
    "id": 1,
    "plan_id": 1,
    "privy_id": "privy-wallet-id-123",
    "address": "0xWalletAddress...",
    "chain_type": "solana",
    "created_at": "2023-10-27T10:00:00Z"
  }
}
```

### Error Responses

- **Status 400 (Bad Request)**: The request body is invalid. The response will contain details about the validation error.
- **Status 401 (Unauthorized)**: The JWT is missing, invalid, or expired.
- **Status 404 (Not Found)**: The authenticated user was not found in the internal database.
- **Status 500 (Internal Server Error)**: An unexpected error occurred on the server.
