# API Documentation: Audit Logs

This document provides instructions for frontend developers on how to integrate with the audit log endpoints for user sign-ups and logins.

## Endpoints Overview

These endpoints are used to create security audit trails for important user authentication events. They should be called from the client-side immediately after a user successfully signs up or logs in.

The endpoints capture metadata from the user's session, such as IP address and user agent, to log where and from what device the event occurred.

### 1. Log a Signup Event

-   **URL:** `/api/audit_logs/signup_logs`
-   **HTTP Method:** `POST`
-   **Description:** Logs a new user registration event.

### 2. Log a Login Event

-   **URL:** `/api/audit_logs/login_logs`
-   **HTTP Method:** `POST`
-   **Description:** Logs a user login event.

---

## Authentication

Both endpoints require a bearer token for authentication. This token is the JSON Web Token (JWT) obtained from Supabase after a user authenticates.

The token must be included in the `Authorization` header of the request.

**Header Example:**
```
Authorization: Bearer <your_supabase_jwt>
```

---

## Request

These endpoints do not require a request body. All necessary information is derived from the user's JWT and the request headers on the server-side.

---

## Responses

### Success Response

-   **Status Code:** `200 OK`
-   **Content:**
    ```json
    {
      "error": null,
      "data": {
        "success": true,
        "event": "signup" // or "login"
      }
    }
    ```

### Error Responses

-   **Status Code:** `401 Unauthorized`
    -   **Reason:** The `Authorization` header is missing, or the provided JWT is invalid or expired.
-   **Status Code:** `500 Internal Server Error`
    -   **Reason:** The server failed to insert the audit log record into the database.

---

## Frontend Integration Example

Here is a reusable JavaScript function to call the audit log endpoints. This function should be triggered after a successful sign-up or login action in your application.

```javascript
/**
 * Logs a user authentication event (signup or login).
 * This should be called after the user successfully authenticates with Supabase.
 *
 * @param {object} supabase - The Supabase client instance.
 * @param {'signup' | 'login'} eventType - The type of event to log.
 */
async function logAuthEvent(supabase, eventType) {
  if (eventType !== 'signup' && eventType !== 'login') {
    console.error('Invalid eventType. Must be "signup" or "login".');
    return;
  }

  try {
    // 1. Get the current session from Supabase to ensure the user is logged in.
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();

    if (sessionError) {
      console.error('Error getting session:', sessionError);
      return;
    }

    if (!session) {
      console.error('No active session found. Cannot log event.');
      return;
    }

    const accessToken = session.access_token;
    const apiUrl = `/api/audit_logs/${eventType}_logs`;

    // 2. Call the appropriate audit log endpoint
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      const errorResult = await response.json();
      console.error(`API Error logging ${eventType}:`, errorResult.error);
      return;
    }

    const result = await response.json();
    console.log(`Successfully logged ${eventType} event.`, result.data);

  } catch (error) {
    // Handle network errors or other unexpected issues
    console.error(`An unexpected error occurred while logging ${eventType}:`, error);
  }
}

// --- Example Usage ---

// After a user signs up successfully:
// logAuthEvent(supabase, 'signup');

// After a user logs in successfully:
// logAuthEvent(supabase, 'login');
