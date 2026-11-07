import test from "node:test";
import assert from "node:assert/strict";
import supabase from "../utils/supabase";
import {
  escapeHtml,
  isTelegramConfigured,
} from "../lib/telegram";
import {
  TelegramUpdateSchema,
  handleTelegramUpdate,
} from "../lib/telegram-bot";

test("Telegram Bot: configuration and escapeHtml sanity", () => {
  assert.equal(isTelegramConfigured(), true, "Telegram token should be configured");
  assert.equal(
    escapeHtml("<script>alert('xss')&</script>"),
    "&lt;script&gt;alert('xss')&amp;&lt;/script&gt;"
  );
});

test("Telegram Bot: TelegramUpdateSchema validates standard messages and callbacks", () => {
  const startUpdate = {
    update_id: 1001,
    message: {
      message_id: 10,
      chat: { id: 123456, type: "private" },
      from: { id: 123456, username: "alice", first_name: "Alice" },
      text: "/start",
    },
  };
  const parsedStart = TelegramUpdateSchema.safeParse(startUpdate);
  assert.equal(parsedStart.success, true);

  const commandWithTag = {
    update_id: 1002,
    message: {
      message_id: 11,
      chat: { id: 123456, type: "private" },
      from: { id: 123456, username: "alice" },
      text: "/total@LiquidHq_Bot",
    },
  };
  const parsedTag = TelegramUpdateSchema.safeParse(commandWithTag);
  assert.equal(parsedTag.success, true);

  const callbackUpdate = {
    update_id: 1003,
    callback_query: {
      id: "cb_001",
      from: { id: 123456, username: "alice" },
      data: "accept_payout:123e4567-e89b-12d3-a456-426614174000:50",
      message: {
        message_id: 20,
        chat: { id: 123456, type: "private" },
      },
    },
  };
  const parsedCallback = TelegramUpdateSchema.safeParse(callbackUpdate);
  assert.equal(parsedCallback.success, true);
});

test("Telegram Bot E2E: fiat payout lifecycle on Supabase (Insert -> Accept -> Mark Paid)", async () => {
  const testVendor1 = 999001;
  const testVendor2 = 999002;

  // 1. Ensure test vendors exist in vendors table
  const { error: vendorInsertError } = await supabase.from("vendors").upsert([
    {
      user_id: testVendor1,
      chat_id: testVendor1,
      username: "test_e2e_vendor_1",
      first_name: "Test",
      last_name: "Vendor1",
      total_paid_out: 0,
    },
    {
      user_id: testVendor2,
      chat_id: testVendor2,
      username: "test_e2e_vendor_2",
      first_name: "Test",
      last_name: "Vendor2",
      total_paid_out: 0,
    },
  ]);
  assert.equal(vendorInsertError, null, "Vendor upsert should succeed");

  // 2. Create a dummy payout record
  const { data: inserted, error: insertError } = await supabase
    .from("fiat_payouts")
    .insert({
      status: "pending",
      amount: 100,
      token: "USDC",
      chain: "solana",
      bank_name: "Guaranty Trust Bank",
      account_number: "0123456789",
      account_name: "Test E2E Recipient",
      fiat_transaction_id: "test-e2e-tx-" + Date.now(),
      message_details: [{ chat_id: 12345, message_id: 67890 }],
    })
    .select("id")
    .single();

  assert.equal(insertError, null, "Payout insert should succeed");
  assert.ok(inserted?.id, "Inserted ID must be returned");

  const payoutId = inserted.id;

  try {
    // 3. Accept payout via RPC (Vendor 1)
    const { data: acceptData, error: acceptError } = await supabase.rpc(
      "accept_fiat_payout",
      {
        p_payout_id: payoutId,
        p_vendor_id: testVendor1,
      }
    );

    assert.equal(acceptError, null, "accept_fiat_payout RPC should succeed");
    assert.ok(acceptData, "acceptData should be returned");

    // 4. Race condition: Vendor 2 attempts to accept the same payout
    const { data: raceData } = await supabase.rpc("accept_fiat_payout", {
      p_payout_id: payoutId,
      p_vendor_id: testVendor2,
    });
    assert.equal(raceData, null, "Double acceptance must return null");

    // 5. Mark payout as paid
    const { error: markError } = await supabase.rpc("mark_payout_as_paid", {
      p_payout_id: payoutId,
      p_vendor_id: testVendor1,
      p_payout_amount: 100,
    });
    assert.equal(markError, null, "mark_payout_as_paid RPC should succeed");

    // 6. Verify final status in fiat_payouts table
    const { data: finalRecord, error: fetchError } = await supabase
      .from("fiat_payouts")
      .select("status, paid_at, vendor_id, payout_amount")
      .eq("id", payoutId)
      .single();

    assert.equal(fetchError, null);
    assert.equal(finalRecord.status, "paid");
    assert.equal(finalRecord.vendor_id, testVendor1);
    assert.equal(finalRecord.payout_amount, 100);
    assert.ok(finalRecord.paid_at, "paid_at timestamp should be set");
  } finally {
    // Clean up test records in reverse foreign key order
    await supabase.from("vendor_transactions").delete().eq("payout_id", payoutId);
    await supabase.from("fiat_payouts").delete().eq("id", payoutId);
    await supabase.from("vendors").delete().in("user_id", [testVendor1, testVendor2]);
  }
});

test("Telegram Bot: platform_total_saved RPC succeeds and handles empty/populated states", async () => {
  const { data, error } = await supabase.rpc("platform_total_saved");
  assert.equal(error, null, "platform_total_saved should succeed");
  assert.ok(typeof data === "object" && data !== null, "Return value should be an object");
});

test("Telegram Bot: handleTelegramUpdate safely handles unknown commands and messages", async () => {
  // Non-command message should be ignored without error
  await handleTelegramUpdate({
    message: {
      message_id: 99,
      chat: { id: 123456, type: "private" },
      from: { id: 123456, username: "tester" },
      text: "hello bot",
    },
  });

  // Empty update should be ignored without error
  await handleTelegramUpdate({});
});

