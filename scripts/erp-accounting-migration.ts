/**
 * ERP Accounting Enhancement — Database Migration
 * Adds professional GL features: fiscal years, budgets, audit logs, enhanced journal entries
 */
import { pool } from "../server-db.js";

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    console.log("🔧 Running ERP Accounting Migration...");

    // 1. Add period_id and enhanced fields to journal_entries
    await client.query(`
      ALTER TABLE journal_entries 
        ADD COLUMN IF NOT EXISTS period_id INTEGER REFERENCES financial_periods(id),
        ADD COLUMN IF NOT EXISTS source_type VARCHAR(50) DEFAULT 'manual',
        ADD COLUMN IF NOT EXISTS source_id INTEGER,
        ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'draft',
        ADD COLUMN IF NOT EXISTS total_debit DECIMAL(15,2) DEFAULT 0,
        ADD COLUMN IF NOT EXISTS total_credit DECIMAL(15,2) DEFAULT 0,
        ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id),
        ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES branches(id),
        ADD COLUMN IF NOT EXISTS approved_by INTEGER REFERENCES users(id),
        ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP
    `);

    // 2. Fiscal Years table
    await client.query(`
      CREATE TABLE IF NOT EXISTS fiscal_years (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        start_date DATE NOT NULL,
        end_date DATE NOT NULL,
        status VARCHAR(20) DEFAULT 'open',
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        closed_at TIMESTAMP
      )
    `);

    // 3. Enhance financial_periods
    await client.query(`
      ALTER TABLE financial_periods 
        ADD COLUMN IF NOT EXISTS fiscal_year_id INTEGER REFERENCES fiscal_years(id),
        ADD COLUMN IF NOT EXISTS start_date DATE,
        ADD COLUMN IF NOT EXISTS end_date DATE,
        ADD COLUMN IF NOT EXISTS closed_by INTEGER REFERENCES users(id)
    `);

    // 4. GL Audit Logs
    await client.query(`
      CREATE TABLE IF NOT EXISTS gl_audit_logs (
        id SERIAL PRIMARY KEY,
        table_name VARCHAR(50) NOT NULL,
        record_id INTEGER NOT NULL,
        action VARCHAR(20) NOT NULL,
        old_values JSONB,
        new_values JSONB,
        user_id INTEGER REFERENCES users(id),
        ip_address VARCHAR(45),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await client.query("CREATE INDEX IF NOT EXISTS idx_gl_audit_table_record ON gl_audit_logs(table_name, record_id)");
    await client.query("CREATE INDEX IF NOT EXISTS idx_gl_audit_created ON gl_audit_logs(created_at DESC)");

    // 5. Budget Management
    await client.query(`
      CREATE TABLE IF NOT EXISTS budgets (
        id SERIAL PRIMARY KEY,
        name VARCHAR(200) NOT NULL,
        fiscal_year_id INTEGER NOT NULL REFERENCES fiscal_years(id),
        account_id INTEGER NOT NULL REFERENCES accounts(id),
        cost_center_id INTEGER REFERENCES cost_centers(id),
        branch_id INTEGER REFERENCES branches(id),
        monthly_amount DECIMAL(15,2) DEFAULT 0,
        annual_amount DECIMAL(15,2) DEFAULT 0,
        actual_amount DECIMAL(15,2) DEFAULT 0,
        notes TEXT,
        status VARCHAR(20) DEFAULT 'active',
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await client.query("CREATE INDEX IF NOT EXISTS idx_budgets_fiscal_year ON budgets(fiscal_year_id)");
    await client.query("CREATE INDEX IF NOT EXISTS idx_budgets_account ON budgets(account_id)");

    // 6. Account Configuration (default GL accounts for auto-posting)
    await client.query(`
      CREATE TABLE IF NOT EXISTS account_config (
        key VARCHAR(100) PRIMARY KEY,
        account_id INTEGER REFERENCES accounts(id),
        description TEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 7. Sub-ledger tracking (AR/AP)
    await client.query(`
      CREATE TABLE IF NOT EXISTS sub_ledger_entries (
        id SERIAL PRIMARY KEY,
        journal_item_id INTEGER NOT NULL REFERENCES journal_items(id),
        partner_type VARCHAR(20) NOT NULL,
        partner_id INTEGER NOT NULL,
        partner_name VARCHAR(255),
        due_date DATE,
        amount DECIMAL(15,2) NOT NULL,
        remaining_amount DECIMAL(15,2) NOT NULL,
        status VARCHAR(20) DEFAULT 'open',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await client.query("CREATE INDEX IF NOT EXISTS idx_sub_ledger_partner ON sub_ledger_entries(partner_type, partner_id)");
    await client.query("CREATE INDEX IF NOT EXISTS idx_sub_ledger_status ON sub_ledger_entries(status)");

    // 8. Document sequencing
    await client.query(`
      CREATE TABLE IF NOT EXISTS document_sequences (
        id SERIAL PRIMARY KEY,
        document_type VARCHAR(50) NOT NULL UNIQUE,
        prefix VARCHAR(20) DEFAULT '',
        current_number INTEGER DEFAULT 0,
        padding INTEGER DEFAULT 6,
        reset_period VARCHAR(20) DEFAULT 'yearly',
        last_reset_date DATE
      )
    `);

    // 9. Seed default fiscal year
    const currentYear = new Date().getFullYear();
    const existingFY = await client.query("SELECT id FROM fiscal_years WHERE name = $1", [`FY ${currentYear}`]);
    if (existingFY.rows.length === 0) {
      await client.query(
        "INSERT INTO fiscal_years (name, start_date, end_date) VALUES ($1, $2, $3)",
        [`FY ${currentYear}`, `${currentYear}-01-01`, `${currentYear}-12-31`]
      );
      console.log(`  ✅ Created default fiscal year: FY ${currentYear}`);
    }

    // 10. Seed default account configurations
    const defaultConfigs = [
      ['sales_revenue_account', 'Default sales revenue GL account'],
      ['sales_discount_account', 'Default sales discount (contra-revenue)'],
      ['purchases_expense_account', 'Default purchases/COGS GL account'],
      ['cash_account', 'Default cash/bank GL account for treasury'],
      ['accounts_receivable_account', 'Default AR control account'],
      ['accounts_payable_account', 'Default AP control account'],
      ['payroll_expense_account', 'Default salaries & wages expense'],
      ['inventory_asset_account', 'Default inventory asset account'],
      ['cost_of_goods_sold_account', 'Default COGS account'],
      ['tax_payable_account', 'Default tax liability account'],
      ['retained_earnings_account', 'Retained earnings for period closing'],
      ['income_summary_account', 'Income summary for P&L closing'],
    ];
    for (const [key, desc] of defaultConfigs) {
      await client.query(`
        INSERT INTO account_config (key, description) 
        VALUES ($1, $2) 
        ON CONFLICT (key) DO NOTHING
      `, [key, desc]);
    }

    // 11. Seed default document sequences
    const defaultSeqs = [
      ['journal_entry', 'JE', 0, 6, 'yearly'],
      ['receipt_voucher', 'RV', 0, 6, 'yearly'],
      ['payment_voucher', 'PV', 0, 6, 'yearly'],
    ];
    for (const [docType, prefix, num, padding, period] of defaultSeqs) {
      await client.query(`
        INSERT INTO document_sequences (document_type, prefix, current_number, padding, reset_period) 
        VALUES ($1, $2, $3, $4, $5) 
        ON CONFLICT (document_type) DO NOTHING
      `, [docType, prefix, num, padding, period]);
    }

    await client.query("COMMIT");
    console.log("  ✅ ERP Accounting Migration completed successfully!");
    console.log("");
    console.log("  New tables: fiscal_years, gl_audit_logs, budgets, account_config, sub_ledger_entries, document_sequences");
    console.log("  Enhanced: journal_entries (period_id, source_type, status, approval)");
    console.log("  Enhanced: financial_periods (fiscal_year_id, date ranges, closed_by)");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("  ❌ Migration failed:", error);
    throw error;
  } finally {
    client.release();
  }
}

migrate().then(() => process.exit(0)).catch(() => process.exit(1));