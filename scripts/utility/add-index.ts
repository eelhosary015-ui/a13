import { pool } from "./server-db.js";
async function run() {
  await pool.query('CREATE INDEX IF NOT EXISTS idx_orders_timestamp_branch_status ON orders(timestamp DESC, branch_id, status)');
  console.log("Done");
  process.exit(0);
}
run();
