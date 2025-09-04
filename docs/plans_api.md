# Plans API Documentation

This documentation provides details on how to interact with the plans API endpoints.

## Fetch User's Plans

This endpoint retrieves all plans and their associated wallets for the authenticated user.

- **URL:** `/api/plans/fetch`
- **Method:** `GET`
- **Headers:**
  - `Authorization`: `Bearer <YOUR_AUTH_TOKEN>`

### Responses

- **200 OK:**
  ```json
  [
    {
      "id": "plan_uuid",
      "user_id": "user_uuid",
      "plan_type": "locked",
      "received_amount": 1000,
      "recurrent_payout": 100,
      "frequency": "monthly",
      "payout_time": "10:00",
      "created_at": "2023-10-27T10:00:00Z",
      "wallets": [
        {
          "id": "wallet_uuid",
          "plan_id": "plan_uuid",
          "address": "wallet_address",
          "created_at": "2023-10-27T10:00:00Z"
        }
      ]
    }
  ]
  ```
- **401 Unauthorized:** If the authentication token is missing or invalid.
- **500 Internal Server Error:** If there's a server-side error.

### JavaScript Example

```javascript
async function fetchPlans(authToken) {
  try {
    const response = await fetch('/api/plans/fetch', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${authToken}`
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const plans = await response.json();
    console.log('Fetched plans:', plans);
    return plans;
  } catch (error) {
    console.error('Error fetching plans:', error);
  }
}
```

## Update a Plan

This endpoint updates an existing plan for the authenticated user.

- **URL:** `/api/plans/update`
- **Method:** `POST`
- **Headers:**
  - `Authorization`: `Bearer <YOUR_AUTH_TOKEN>`
  - `Content-Type`: `application/json`
- **Body:**
  ```json
  {
    "plan_id": "plan_uuid_to_update",
    "frequency": "weekly",
    "recurrent_payout": 150
  }
  ```
  *Note: Only include the fields you want to update. `plan_id` is required.*

### Responses

- **200 OK:** Returns the updated plan object.
- **400 Bad Request:** If the request body is invalid.
- **401 Unauthorized:** If the authentication token is missing or invalid.
- **500 Internal Server Error:** If the plan is not found or a server-side error occurs.

### JavaScript Example

```javascript
async function updatePlan(authToken, planId, updateData) {
  try {
    const response = await fetch('/api/plans/update', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        plan_id: planId,
        ...updateData
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const updatedPlan = await response.json();
    console.log('Updated plan:', updatedPlan);
    return updatedPlan;
  } catch (error) {
    console.error('Error updating plan:', error);
  }
}

// Example usage:
// updatePlan('your_auth_token', 'plan_uuid_to_update', { frequency: 'weekly', recurrent_payout: 150 });
