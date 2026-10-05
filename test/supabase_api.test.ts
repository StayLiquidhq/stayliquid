import test from "node:test";
import assert from "node:assert/strict";
import supabase from "../utils/supabase";

test("Supabase API: should query wallets table and parse typed records", async () => {
  const startTime = Date.now();
  const { data, error } = await supabase
    .from("wallets")
    .select("id, address, plan_id, has_webhook, balance")
    .limit(2);

  console.log("✔ [Supabase API Response] wallets query:", {
    recordsFound: data?.length ?? 0,
    records: data,
    error,
    latencyMs: Date.now() - startTime,
  });

  assert.equal(error, null);
  assert.ok(Array.isArray(data));
});

test("Supabase API: should query plans table and parse typed records", async () => {
  const startTime = Date.now();
  const { data, error } = await supabase
    .from("plans")
    .select("id, user_id, plan_type, target_amount, status")
    .limit(2);

  console.log("✔ [Supabase API Response] plans query:", {
    recordsFound: data?.length ?? 0,
    records: data,
    error,
    latencyMs: Date.now() - startTime,
  });

  assert.equal(error, null);
  assert.ok(Array.isArray(data));
});

test("Supabase API: should query audit_logs table and parse typed records", async () => {
  const startTime = Date.now();
  const { data, error } = await supabase
    .from("audit_logs")
    .select("id, action, resource_type, ip_address")
    .limit(2);

  console.log("✔ [Supabase API Response] audit_logs query:", {
    recordsFound: data?.length ?? 0,
    records: data,
    error,
    latencyMs: Date.now() - startTime,
  });

  assert.equal(error, null);
  assert.ok(Array.isArray(data));
});
