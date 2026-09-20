import { pool } from "./server-db.js";

async function optimize() {
  console.log("Adding indexes...");
  try {
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_orders_timestamp_desc ON orders(timestamp DESC);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_orders_branch_id ON orders(branch_id);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_orders_composite ON orders(timestamp DESC, branch_id, status);`);
    console.log("Successfully added indexes!");
  } catch (error) {
    console.error("Error adding indexes:", error);
  } finally {
    process.exit(0);
  }
}

optimize();
