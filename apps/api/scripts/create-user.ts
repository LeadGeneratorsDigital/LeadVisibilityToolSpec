/**
 * Self-registration is disabled (spec section 7), so users are added here or in the Supabase dashboard.
 * Usage: pnpm create-user <email> <password>
 */
import { createClient } from "@supabase/supabase-js";
import { loadConfig } from "../src/config";

const [email, password] = process.argv.slice(2);
if (!email || !password) {
  console.error("Usage: pnpm create-user <email> <password>");
  process.exit(1);
}

const config = loadConfig();
const db = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true });
if (error) {
  console.error(`Could not create ${email}: ${error.message}`);
  process.exit(1);
}
console.log(`Created ${data.user.email}`);
