# Break Plan API

This document provides instructions on how to integrate the "break plan" endpoint into your frontend application.

## Endpoint

`POST /api/plans/break`

## Description

This endpoint allows an authenticated user to break their savings plan. It calculates the final payout amount (total balance minus a 2% fee) and transfers the funds from the central payout wallet to the user's designated payout address.

## Request

### Headers

| Header        | Description                                                                      |
|---------------|----------------------------------------------------------------------------------|
| `Authorization` | **Required.** A Bearer token for the authenticated user. Format: `Bearer <token>` |
| `Content-Type`  | **Required.** Must be `application/json`.                                        |

### Body

| Field     | Type     | Description                               |
|-----------|----------|-------------------------------------------|
| `plan_id` | `string` | **Required.** The UUID of the plan to break. |

### Example Request

Here is an example of how to call this endpoint using `fetch` in a JavaScript/TypeScript frontend application:

```javascript
async function breakPlan(authToken, planId) {
  const url = '/api/plans/break';
  const options = {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${authToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ plan_id: planId })
  };

  try {
    const response = await fetch(url, options);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || `HTTP error! status: ${response.status}`);
    }

    console.log('Plan broken successfully:', data);
    // Returns { success: true, signature: "..." }
    return data;
  } catch (error) {
    console.error('Failed to break plan:', error);
    // Handle errors appropriately in your UI
  }
}

// Usage:
// const userAuthToken = 'your-user-auth-token';
// const planToBreak = 'the-uuid-of-the-plan';
// breakPlan(userAuthToken, planToBreak);
```

## Responses

### Success Response (200 OK)

A successful request will return a JSON object containing the transaction signature.

**Example:**

```json
{
  "success": true,
  "signature": "5NG7iQ9JHHcrLa8EghbqGMY15zjoyEg9QKi1QoWCBYjbBTgwyJTx2RXvRkALGte8gNSRhuUUnTTQuswyHFzzSijf"
}
```

### Error Responses

- **400 Bad Request:** Returned if the `plan_id` is missing from the request body, if the plan has no balance to break, or if a payout address is not set for the plan.
- **401 Unauthorized:** Returned if the `Authorization` header is missing, invalid, or the token is expired.
- **404 Not Found:** Returned if the specified `plan_id` does not exist or does not belong to the authenticated user.
- **500 Internal Server Error:** Returned for any unexpected server-side errors, such as a misconfigured payout wallet or a failed transaction.
