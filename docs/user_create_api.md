# API Documentation: Create User

This document provides instructions for frontend developers on how to integrate with the `POST /api/user/create` endpoint.

## Endpoint Overview

This endpoint is responsible for creating a new user in the system or updating an existing user's information. It's designed to be called after a user successfully authenticates with Supabase on the client-side. The endpoint uses the user's Supabase JWT to securely identify them and retrieve their information.

- **URL:** `/api/user/create`
- **HTTP Method:** `POST`

---

## Authentication

The endpoint requires a bearer token for authentication. The token is the JSON Web Token (JWT) obtained from Supabase after a user logs in.

The token must be included in the `Authorization` header of the request.

**Header Example:**
```
Authorization: Bearer <your_supabase_jwt>
```

---

## Request

This endpoint does not require a request body. All necessary user information is extracted from the Supabase JWT provided in the `Authorization` header.

---

## Data Collection

The endpoint extracts the following information from the user's Supabase JWT payload:

- **Email:** The user's email address.
- **Full Name:** The user's full name from their user metadata.
- **Avatar URL:** The URL for the user's profile picture from their user metadata.
- **Google ID (`sub`):** The user's unique Google ID from their user metadata, if they signed in with Google.

This information is then used to create or update the user's profile in the database. A `username` is generated from the email, and a Privy wallet is created for the user, providing a `privy_id` and `wallet_address`.

---

## Responses

### Success Response

- **Status Code:** `200 OK`
- **Content:**
  ```json
  {
    "error": null,
    "data": {
      "id": "user_id",
      "email": "user@example.com",
      "privy_id": "privy_wallet_id",
      "name": "User Name",
      "wallet_address": "solana_wallet_address",
      "username": "username",
      "picture": "http://example.com/avatar.png",
      "google_id": "google_user_id",
      "plan_created": false,
      "created_at": "timestamp"
    },
    "new": true
  }
  ```
- **Description:**
  - `data`: Contains the user object from the database.
  - `new`: A boolean value indicating whether a new user was created (`true`) or an existing user was found/updated (`false`).

### Error Responses

- **Status Code:** `400 Bad Request`
  - **Content:** `{ "error": "Email not found in token payload", "data": null }`
  - **Reason:** The user's email could not be found in the JWT payload.

- **Status Code:** `401 Unauthorized`
  - **Content:** `{ "error": "Unauthorized: Missing or invalid Authorization header", "data": null }`
  - **Reason:** The `Authorization` header is missing or not correctly formatted.
  - **Content:** `{ "error": "Unauthorized: Invalid or expired token", "data": null }`
  - **Reason:** The provided JWT is invalid or has expired.

- **Status Code:** `500 Internal Server Error`
  - **Content:** `{ "error": "Failed to create user account", "data": null }`
  - **Reason:** An error occurred while trying to insert the new user into the database.
  - **Content:** `{ "error": "Database error occurred", "data": null }`
  - **Reason:** A generic database error occurred.
  - **Content:** `{ "error": "Internal server error", "data": null }`
  - **Reason:** An unexpected error occurred on the server.

---

## Frontend Integration Example

Here is an example of how to call this endpoint from a frontend application using `fetch` after getting the session from the Supabase client library.

```javascript
// This function should be called after the user has logged in
// and you have access to the Supabase session.

async function createUserOrUpdateUser(supabase) {
  try {
    // 1. Get the current session from Supabase
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();

    if (sessionError) {
      console.error('Error getting session:', sessionError);
      return;
    }

    if (!session) {
      console.error('No active session found. User needs to log in.');
      return;
    }

    const accessToken = session.access_token;

    // 2. Call the create user endpoint
    const response = await fetch('/api/user/create', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
    });

    const result = await response.json();

    if (!response.ok) {
      // Handle API errors (e.g., 401, 500)
      console.error(`API Error: ${response.status}`, result.error);
      // Optionally, show an error message to the user
      return;
    }

    // 3. Handle the successful response
    if (result.new) {
      console.log('A new user was created:', result.data);
      // You might want to trigger a welcome flow for new users
    } else {
      console.log('Existing user data:', result.data);
      // User already existed, maybe just update local state
    }

    // Store or use the user data in your application state
    // e.g., setCurrentUser(result.data);

  } catch (error) {
    // Handle network errors or other unexpected issues
    console.error('An unexpected error occurred:', error);
  }
}

// Example usage with your Supabase client instance
// import { createClient } from '@supabase/supabase-js';
// const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
// createUserOrUpdateUser(supabase);
