import { createClient } from "@supabase/supabase-js";
import { Database } from "@/lib/supabase/types";
import { requireEnv } from "@/lib/env";

const SUPABASE_URL = requireEnv("SUPABASE_URL");

const SUPABASE_SECRET_KEY = requireEnv("SUPABASE_SECRET_KEY");

const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_SECRET_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

export default supabase;
