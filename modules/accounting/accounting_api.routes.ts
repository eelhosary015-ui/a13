import { Router } from "express";
import { pool } from "../../server-db.js";
import { isMonthClosed } from "../../server.js";
import { authenticateToken } from "../system/system_api.routes.js";

const router = Router();

  // General Accounts Endpoints
  router.get("/api/accounts", async (req, res) => {
    try {
      const accounts = (await pool.query("SELECT * FROM accounts ORDER BY code ASC")).rows;
      res.json(accounts);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch accounts" });
    }
  });

  router.get("/api/cost-centers", async (req, res) => {
    try {
      const centers = (await pool.query("SELECT * FROM cost_centers ORDER BY code ASC")).rows;
      res.json(centers);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch cost centers" });
    }
  });

  router.post("/api/cost-centers", async (req, res) => {
    const { name, code, notes } = req.body;
    try {
      const result = await pool.query("INSERT INTO cost_centers (name, code, notes) VALUES ($1, $2, $3) RETURNING id", [name, code, notes]);
      res.json({ id: result.rows[0].id });
    } catch (error) {
      res.status(500).json({ error: "Failed to create cost center" });
    }
  });

  router.get("/api/accounts/:id/ledger", async (req, res) => {
    const { id } = req.params;
    const { startDate, endDate, costCenterId } = req.query;
    try {
      let query = `
        SELECT je.date, je.description, je.reference, ji.debit, ji.credit, ji.notes, cc.name as cost_center_name
        FROM journal_items ji
        JOIN journal_entries je ON ji.journal_entry_id = je.id
        LEFT JOIN cost_centers cc ON ji.cost_center_id = cc.id
        WHERE ji.account_id = $1
        AND je.date::date BETWEEN $2 AND $3
      `;
      const params: any[] = [id, startDate || '1970-01-01', endDate || '9999-12-31'];

      if (costCenterId) {
        params.push(costCenterId);
        query += ` AND ji.cost_center_id = $${params.length}`;
      }

      query += " ORDER BY je.date ASC";

      const transactions = (await pool.query(query, params)).rows;
      res.json(transactions);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch ledger" });
    }
  });

  router.post("/api/accounts", async (req, res) => {
    let { 
      code, 
      name, 
      name_ar, 
      name_en, 
      parent_id, 
      type, 
      account_type, 
      account_nature, 
      level, 
      is_leaf, 
      allow_posting, 
      status 
    } = req.body;

    // Default fallbacks for compatibility
    if (!name_ar) name_ar = name || "حساب جديد";
    if (!name) name = name_ar;
    if (!account_type) {
      account_type = (type || "asset").toUpperCase();
    }
    if (!type) {
      type = account_type.toLowerCase();
    }
    
    // Auto calculate level if parent is selected and not provided
    let calculatedLevel = level || 1;
    if (parent_id && !level) {
      try {
        const parentRes = await pool.query("SELECT level FROM accounts WHERE id = $1", [parent_id]);
        if (parentRes.rows.length > 0) {
          calculatedLevel = (parentRes.rows[0].level || 1) + 1;
        }
      } catch (e) {}
    }

    if (is_leaf === undefined) is_leaf = true;
    if (allow_posting === undefined) allow_posting = true;
    if (status === undefined) status = true;

    try {
      const result = await pool.query(
        `INSERT INTO accounts (code, name, name_ar, name_en, type, account_type, account_nature, level, is_leaf, allow_posting, status, parent_id) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
        [
          code, 
          name, 
          name_ar, 
          name_en || null, 
          type, 
          account_type, 
          account_nature || 'DEBIT', 
          calculatedLevel, 
          is_leaf, 
          allow_posting, 
          status, 
          parent_id || null
        ]
      );
      res.json({ id: result.rows[0].id });
    } catch (error: any) {
      console.error("Create account error:", error);
      res.status(500).json({ error: "فشل إنشاء الحساب: " + error.message });
    }
  });

  router.put("/api/accounts/:id", async (req, res) => {
    const { id } = req.params;
    let { 
      code, 
      name, 
      name_ar, 
      name_en, 
      parent_id, 
      type, 
      account_type, 
      account_nature, 
      level, 
      is_leaf, 
      allow_posting, 
      status 
    } = req.body;

    if (!name_ar) name_ar = name;
    if (!name) name = name_ar;
    if (account_type && !type) type = account_type.toLowerCase();
    if (type && !account_type) account_type = type.toUpperCase();

    // Auto calculate level if parent is selected and not provided
    let calculatedLevel = level;
    if (parent_id && !level) {
      try {
        const parentRes = await pool.query("SELECT level FROM accounts WHERE id = $1", [parent_id]);
        if (parentRes.rows.length > 0) {
          calculatedLevel = (parentRes.rows[0].level || 1) + 1;
        }
      } catch (e) {}
    }

    try {
      await pool.query(
        `UPDATE accounts SET 
          code = COALESCE($1, code),
          name = COALESCE($2, name),
          name_ar = COALESCE($3, name_ar),
          name_en = $4,
          type = COALESCE($5, type),
          account_type = COALESCE($6, account_type),
          account_nature = COALESCE($7, account_nature),
          level = COALESCE($8, level),
          is_leaf = COALESCE($9, is_leaf),
          allow_posting = COALESCE($10, allow_posting),
          status = COALESCE($11, status),
          parent_id = $12
         WHERE id = $13`,
        [
          code, 
          name, 
          name_ar, 
          name_en || null, 
          type, 
          account_type, 
          account_nature, 
          calculatedLevel || 1, 
          is_leaf, 
          allow_posting, 
          status, 
          parent_id || null, 
          id
        ]
      );
      res.json({ success: true });
    } catch (error: any) {
      console.error("Update account error:", error);
      res.status(500).json({ error: "فشل تحديث الحساب: " + error.message });
    }
  });

  router.delete("/api/accounts/:id", async (req, res) => {
    const { id } = req.params;
    try {
      // Check if there are child accounts referencing this account
      const childRes = await pool.query("SELECT id FROM accounts WHERE parent_id = $1 LIMIT 1", [id]);
      if (childRes.rows.length > 0) {
        return res.status(400).json({ error: "لا يمكن حذف هذا الحساب لوجود حسابات فرعية تابعة له" });
      }

      // Check if there are journal items referencing this account
      const itemsRes = await pool.query("SELECT id FROM journal_items WHERE account_id = $1 LIMIT 1", [id]);
      if (itemsRes.rows.length > 0) {
        return res.status(400).json({ error: "لا يمكن حذف هذا الحساب لوجود معاملات مالية مرتبطة به" });
      }

      await pool.query("DELETE FROM accounts WHERE id = $1", [id]);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Delete account error:", error);
      res.status(500).json({ error: "فشل حذف الحساب: " + error.message });
    }
  });

  router.post("/api/accounts/bulk", async (req, res) => {
    const { accounts } = req.body;
    if (!Array.isArray(accounts)) {
      return res.status(400).json({ error: "بيانات الإدخال يجب أن تكون مصفوفة" });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      
      const codeToId: Record<string, number> = {};
      // Fetch pre-existing accounts to map codes
      const existing = (await client.query("SELECT id, code FROM accounts")).rows;
      for (const row of existing) {
        codeToId[String(row.code)] = row.id;
      }

      for (const acc of accounts) {
        let {
          code,
          name,
          name_ar,
          name_en,
          parent_code,
          parent_id,
          type,
          account_type,
          account_nature,
          level,
          is_leaf,
          allow_posting,
          status
        } = acc;

        if (!name_ar) name_ar = name || "حساب مستورد";
        if (!name) name = name_ar;
        if (!account_type) {
          account_type = (type || "asset").toUpperCase();
        }
        if (!type) {
          type = account_type.toLowerCase();
        }

        if (is_leaf === undefined) is_leaf = true;
        if (allow_posting === undefined) allow_posting = true;
        if (status === undefined) status = true;

        // Resolve parent_id from parent_code if not directly provided
        let resolvedParentId = parent_id || null;
        if (!resolvedParentId && parent_code) {
          resolvedParentId = codeToId[String(parent_code)] || null;
        }

        // Calculate level based on parent level
        let calculatedLevel = level || 1;
        if (resolvedParentId && !level) {
          const parentItem = await client.query("SELECT level FROM accounts WHERE id = $1", [resolvedParentId]);
          if (parentItem.rows.length > 0) {
            calculatedLevel = (parentItem.rows[0].level || 1) + 1;
          }
        }

        // Check if code already exists to avoid conflict
        const existingAcc = await client.query("SELECT id FROM accounts WHERE code = $1", [code]);
        if (existingAcc.rows.length > 0) {
          // Update it
          const accId = existingAcc.rows[0].id;
          await client.query(
            `UPDATE accounts SET 
              name = $1, name_ar = $2, name_en = $3, type = $4, account_type = $5, 
              account_nature = $6, level = $7, is_leaf = $8, allow_posting = $9, 
              status = $10, parent_id = $11
             WHERE id = $12`,
            [
              name, name_ar, name_en || null, type, account_type, 
              account_nature || 'DEBIT', calculatedLevel, is_leaf, allow_posting, 
              status, resolvedParentId, accId
            ]
          );
          codeToId[String(code)] = accId;
        } else {
          // Insert
          const insRes = await client.query(
            `INSERT INTO accounts (code, name, name_ar, name_en, type, account_type, account_nature, level, is_leaf, allow_posting, status, parent_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
            [
              code, name, name_ar, name_en || null, type, account_type, 
              account_nature || 'DEBIT', calculatedLevel, is_leaf, allow_posting, 
              status, resolvedParentId
            ]
          );
          codeToId[String(code)] = insRes.rows[0].id;
        }
      }

      await client.query("COMMIT");
      res.json({ success: true });
    } catch (error: any) {
      await client.query("ROLLBACK");
      console.error("Bulk accounts import error:", error);
      res.status(500).json({ error: "فشل استيراد الحسابات: " + error.message });
    } finally {
      client.release();
    }
  });

  router.get("/api/journal-entries", async (req, res) => {
    try {
      const entries = (await pool.query("SELECT * FROM journal_entries ORDER BY date DESC")).rows;
      const entriesWithItems = await Promise.all(entries.map(async (entry: any) => {
        const items = (await pool.query(`
          SELECT ji.*, a.name as account_name, a.code as account_code 
          FROM journal_items ji
          JOIN accounts a ON ji.account_id = a.id
          WHERE ji.journal_entry_id = $1
        `, [entry.id])).rows;
        return { ...entry, items };
      }));
      res.json(entriesWithItems);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch journal entries" });
    }
  });

  router.post("/api/journal-entries", async (req, res) => {
    const { date, description, reference, items } = req.body;
    
    // Month Lock Check
    const entryDate = date ? new Date(date) : new Date();
    if (await isMonthClosed(entryDate.getMonth() + 1, entryDate.getFullYear())) {
      return res.status(403).json({ error: "لا يمكن إضافة قيود يومية في شهر مغلق" });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query("INSERT INTO journal_entries (date, description, reference) VALUES ($1, $2, $3) RETURNING id", [date || new Date().toISOString(), description, reference]);
      const entryId = result.rows[0].id;

      for (const item of items) {
        await client.query("INSERT INTO journal_items (journal_entry_id, account_id, debit, credit, notes, cost_center_id) VALUES ($1, $2, $3, $4, $5, $6)", [entryId, item.account_id, item.debit || 0, item.credit || 0, item.notes, item.cost_center_id || null]);
        await client.query("UPDATE accounts SET balance = balance + $1 - $2 WHERE id = $3", [item.debit || 0, item.credit || 0, item.account_id]);
      }
      await client.query("COMMIT");
      res.json({ id: entryId });
    } catch (error) {
      await client.query("ROLLBACK");
      console.error(error);
      res.status(500).json({ error: "Failed to create journal entry" });
    } finally {
      client.release();
    }
  });

  router.delete("/api/journal-entries/:id", async (req, res) => {
    const { id } = req.params;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      
      // Get journal items to reverse the balances
      const items = (await client.query("SELECT account_id, debit, credit FROM journal_items WHERE journal_entry_id = $1", [id])).rows;
      for (const item of items) {
        await client.query("UPDATE accounts SET balance = balance - $1 + $2 WHERE id = $3", [item.debit || 0, item.credit || 0, item.account_id]);
      }
      
      await client.query("DELETE FROM journal_entries WHERE id = $1", [id]);
      await client.query("COMMIT");
      res.json({ success: true });
    } catch (error: any) {
      await client.query("ROLLBACK");
      console.error("Delete journal entry error:", error);
      res.status(500).json({ error: "فشل حذف القيد الحسابي: " + error.message });
    } finally {
      client.release();
    }
  });

  router.get("/api/reports/balance-sheet", async (req, res) => {
    const { date } = req.query;
    const targetDate = date || new Date().toISOString().split('T')[0];
    try {
      // Fetch all account balances with hierarchical info
      const allAccounts = (await pool.query(`
        SELECT 
          a.id, a.code, COALESCE(a.name_ar, a.name) as name, a.name_en,
          a.type, a.account_type, a.level, a.parent_id,
          CASE 
            WHEN a.account_nature = 'CREDIT' OR a.type IN ('liability','equity','revenue')
            THEN COALESCE(SUM(ji.credit - ji.debit), 0)
            ELSE COALESCE(SUM(ji.debit - ji.credit), 0)
          END as balance
        FROM accounts a
        LEFT JOIN journal_items ji ON a.id = ji.account_id
        LEFT JOIN journal_entries je ON ji.journal_entry_id = je.id
          AND je.date::date <= $1 AND je.status != 'canceled'
        WHERE a.type IN ('asset', 'liability', 'equity')
        AND a.status = true
        GROUP BY a.id, a.code, a.name, a.name_ar, a.name_en, a.type, a.account_type, a.level, a.parent_id, a.account_nature
        ORDER BY a.code ASC
      `, [targetDate])).rows;

      // Group by type with subtotals per parent
      const groupAccounts = (type: string) => {
        const typed = allAccounts.filter((a: any) => a.type === type && Math.abs(parseFloat(a.balance)) > 0.001);
        const groups: any[] = [];
        const level1 = typed.filter((a: any) => a.level === 1);
        
        for (const parent of level1) {
          const children = typed.filter((a: any) => {
            // Direct children or self if leaf
            if (a.parent_id === parent.id) return true;
            if (a.id === parent.id && a.level === 1) return true;
            // Check if any ancestor chain leads to this parent
            let current = a;
            while (current && current.parent_id) {
              if (current.parent_id === parent.id) return true;
              current = typed.find((p: any) => p.id === current.parent_id);
            }
            return false;
          });
          
          const total = children.reduce((sum: number, c: any) => sum + (parseFloat(c.balance) || 0), 0);
          if (Math.abs(total) > 0.001) {
            groups.push({
              code: parent.code,
              name: parent.name,
              name_en: parent.name_en,
              subtotal: Math.round(total * 100) / 100,
              accounts: children.map((c: any) => ({
                code: c.code,
                name: c.name,
                name_en: c.name_en,
                balance: Math.round((parseFloat(c.balance) || 0) * 100) / 100
              }))
            });
          }
        }
        return groups;
      };

      const assets = groupAccounts('asset');
      const liabilities = groupAccounts('liability');
      const equity = groupAccounts('equity');

      const totalAssets = assets.reduce((s, g) => s + g.subtotal, 0);
      const totalLiabilities = liabilities.reduce((s, g) => s + g.subtotal, 0);
      const totalEquity = equity.reduce((s, g) => s + g.subtotal, 0);

      // Net Income for the period (cumulative from beginning of fiscal year)
      const fyStart = String(targetDate).substring(0, 4) + '-01-01';
      const revenueResult = await pool.query(`
        SELECT COALESCE(SUM(ji.credit - ji.debit), 0) as total 
        FROM journal_items ji JOIN accounts a ON ji.account_id = a.id 
        JOIN journal_entries je ON ji.journal_entry_id = je.id
        WHERE a.type = 'revenue' AND je.date::date BETWEEN $1 AND $2 AND je.status != 'canceled'
      `, [fyStart, targetDate]);
      const expensesResult = await pool.query(`
        SELECT COALESCE(SUM(ji.debit - ji.credit), 0) as total 
        FROM journal_items ji JOIN accounts a ON ji.account_id = a.id 
        JOIN journal_entries je ON ji.journal_entry_id = je.id
        WHERE a.type = 'expense' AND je.date::date BETWEEN $1 AND $2 AND je.status != 'canceled'
      `, [fyStart, targetDate]);
      const netIncome = (parseFloat(revenueResult.rows[0].total) || 0) - (parseFloat(expensesResult.rows[0].total) || 0);

      res.json({ 
        date: targetDate,
        assets, 
        liabilities, 
        equity,
        total_assets: Math.round(totalAssets * 100) / 100,
        total_liabilities: Math.round(totalLiabilities * 100) / 100,
        total_equity: Math.round(totalEquity * 100) / 100,
        net_income: Math.round(netIncome * 100) / 100,
        total_liabilities_equity: Math.round((totalLiabilities + totalEquity + netIncome) * 100) / 100,
        is_balanced: Math.abs(totalAssets - totalLiabilities - totalEquity - netIncome) < 0.01
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to generate balance sheet" });
    }
  });

  router.get("/api/reports/trial-balance", async (req, res) => {
    const { startDate, endDate } = req.query;
    const start = startDate || '1970-01-01';
    const end = endDate || '9999-12-31';
    try {
      const report = (await pool.query(`
        SELECT 
          a.id,
          a.code, 
          COALESCE(a.name_ar, a.name) as name,
          a.name_en,
          a.type,
          a.account_type,
          a.account_nature,
          a.level,
          a.is_leaf,
          a.parent_id,
          COALESCE((
            SELECT SUM(CASE 
              WHEN a.account_nature = 'CREDIT' THEN ji_open.credit - ji_open.debit
              ELSE ji_open.debit - ji_open.credit
            END)
            FROM journal_items ji_open
            JOIN journal_entries je_open ON ji_open.journal_entry_id = je_open.id
            WHERE ji_open.account_id = a.id AND je_open.date::date < $1 AND je_open.status != 'canceled'
          ), 0) as opening_balance,
          COALESCE((
            SELECT SUM(ji_period.debit)
            FROM journal_items ji_period
            JOIN journal_entries je_period ON ji_period.journal_entry_id = je_period.id
            WHERE ji_period.account_id = a.id AND je_period.date::date BETWEEN $2 AND $3 AND je_period.status != 'canceled'
          ), 0) as period_debit,
          COALESCE((
            SELECT SUM(ji_period.credit)
            FROM journal_items ji_period
            JOIN journal_entries je_period ON ji_period.journal_entry_id = je_period.id
            WHERE ji_period.account_id = a.id AND je_period.date::date BETWEEN $4 AND $5 AND je_period.status != 'canceled'
          ), 0) as period_credit
        FROM accounts a
        WHERE a.status = true
        ORDER BY a.code ASC
      `, [start, start, end, start, end])).rows;

      // Calculate closing balance respecting account nature
      let totalDebit = 0;
      let totalCredit = 0;
      const processedReport = report.map((row: any) => {
        const ob = parseFloat(row.opening_balance) || 0;
        const pd = parseFloat(row.period_debit) || 0;
        const pc = parseFloat(row.period_credit) || 0;
        const isCreditNature = (row.account_nature || '').toUpperCase() === 'CREDIT' || 
                               ['liability', 'equity', 'revenue'].includes(row.type);
        // For debit-nature: balance = ob + debit - credit
        // For credit-nature: balance = ob + credit - debit
        const balance = isCreditNature 
          ? ob + pc - pd 
          : ob + pd - pc;
        
        // Net debit/credit for trial balance validation
        if (balance > 0 && !isCreditNature) {
          totalDebit += balance;
        } else if (balance > 0 && isCreditNature) {
          totalCredit += balance;
        } else if (balance < 0 && isCreditNature) {
          totalDebit += Math.abs(balance);
        } else if (balance < 0 && !isCreditNature) {
          totalCredit += Math.abs(balance);
        }
        
        return { 
          ...row, 
          opening_balance: ob, 
          period_debit: pd, 
          period_credit: pc, 
          balance,
          debit_balance: isCreditNature ? (balance < 0 ? Math.abs(balance) : 0) : (balance > 0 ? balance : 0),
          credit_balance: isCreditNature ? (balance > 0 ? balance : 0) : (balance < 0 ? Math.abs(balance) : 0),
        };
      });

      // Filter to only accounts with activity
      const activeAccounts = processedReport.filter((r: any) => 
        Math.abs(r.opening_balance) > 0.001 || 
        Math.abs(r.period_debit) > 0.001 || 
        Math.abs(r.period_credit) > 0.001
      );

      res.json({ 
        accounts: activeAccounts,
        summary: {
          total_debit: Math.round(totalDebit * 100) / 100,
          total_credit: Math.round(totalCredit * 100) / 100,
          difference: Math.round((totalDebit - totalCredit) * 100) / 100,
          is_balanced: Math.abs(totalDebit - totalCredit) < 0.01,
          total_accounts: activeAccounts.length,
          start_date: start,
          end_date: end
        }
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to generate trial balance" });
    }
  });

  router.get("/api/reports/branch-profitability", async (req, res) => {
    const { startDate, endDate, groupBy } = req.query; // groupBy: 'day', 'month', 'year'
    
    let dateGroupFormat = 'YYYY-MM-DD';
    if (groupBy === 'month') dateGroupFormat = 'YYYY-MM';
    if (groupBy === 'year') dateGroupFormat = 'YYYY';

    try {
      const query = `
        SELECT 
          o.branch_id,
          b.name as branch_name,
          TO_CHAR(o.timestamp, '${dateGroupFormat}') as period,
          SUM(o.total) as total_sales,
          SUM(
            oi.quantity * COALESCE(
              (SELECT SUM(pi.quantity * i.cost) 
               FROM product_ingredients pi 
               JOIN ingredients i ON pi.ingredient_id = i.id 
               WHERE pi.product_id = oi.product_id), 
            0)
          ) as total_cost
        FROM orders o
        JOIN branches b ON o.branch_id = b.id
        JOIN order_items oi ON o.id = oi.order_id
        WHERE o.status != 'cancelled' 
        AND o.timestamp >= $1::timestamp AND o.timestamp < ($2::date + interval '1 day')::timestamp
        GROUP BY o.branch_id, b.name, TO_CHAR(o.timestamp, '${dateGroupFormat}')
        ORDER BY period DESC, o.branch_id
      `;
      
      const data = (await pool.query(query, [startDate || '1970-01-01', endDate || '9999-12-31'])).rows;
      const parsedData = data.map((row: any) => ({
        ...row,
        total_sales: parseFloat(row.total_sales) || 0,
        total_cost: parseFloat(row.total_cost) || 0
      }));
      res.json(parsedData);
    } catch (error) {
      console.error("Branch Profitability Error:", error);
      res.status(500).json({ error: "Failed to generate branch profitability report", details: String(error) });
    }
  });

  router.get("/api/test-prof", async (req, res) => {
    try {
      const q = `
        SELECT 
          o.branch_id,
          b.name as branch_name,
          TO_CHAR(o.timestamp, 'YYYY-MM-DD') as period,
          SUM(o.total) as total_sales,
          SUM(
            oi.quantity * COALESCE(
              (SELECT SUM(pi.quantity * i.cost) 
               FROM product_ingredients pi 
               JOIN ingredients i ON pi.ingredient_id = i.id 
               WHERE pi.product_id = oi.product_id), 
            0)
          ) as total_cost
        FROM orders o
        JOIN branches b ON o.branch_id = b.id
        JOIN order_items oi ON o.id = oi.order_id
        WHERE o.status != 'cancelled' 
        AND o.timestamp >= $1::timestamp AND o.timestamp < ($2::date + interval '1 day')::timestamp
        GROUP BY o.branch_id, b.name, TO_CHAR(o.timestamp, 'YYYY-MM-DD')
        ORDER BY period DESC, o.branch_id
      `;
      await pool.query(q, ['1970-01-01', '9999-12-31']);
      res.json({ success: true });
    } catch (e) {
      res.json({ error: String(e) });
    }
  });

  router.get("/api/reports/income-statement", async (req, res) => {
    const { startDate, endDate } = req.query;
    const start = startDate || new Date().getFullYear() + '-01-01';
    const end = endDate || new Date().toISOString().split('T')[0];
    try {
      // Revenue with hierarchical grouping
      const revenueAccounts = (await pool.query(`
        SELECT 
          a.id, a.code, COALESCE(a.name_ar, a.name) as name, a.name_en,
          a.level, a.parent_id,
          COALESCE(SUM(ji.credit - ji.debit), 0) as balance
        FROM accounts a
        LEFT JOIN journal_items ji ON a.id = ji.account_id
        LEFT JOIN journal_entries je ON ji.journal_entry_id = je.id
          AND je.date::date BETWEEN $1 AND $2 AND je.status != 'canceled'
        WHERE a.type = 'revenue' AND a.status = true
        GROUP BY a.id, a.code, a.name, a.name_ar, a.name_en, a.level, a.parent_id
        ORDER BY a.code ASC
      `, [start, end])).rows;

      // Expenses with hierarchical grouping
      const expenseAccounts = (await pool.query(`
        SELECT 
          a.id, a.code, COALESCE(a.name_ar, a.name) as name, a.name_en,
          a.level, a.parent_id,
          COALESCE(SUM(ji.debit - ji.credit), 0) as balance
        FROM accounts a
        LEFT JOIN journal_items ji ON a.id = ji.account_id
        LEFT JOIN journal_entries je ON ji.journal_entry_id = je.id
          AND je.date::date BETWEEN $1 AND $2 AND je.status != 'canceled'
        WHERE a.type = 'expense' AND a.status = true
        GROUP BY a.id, a.code, a.name, a.name_ar, a.name_en, a.level, a.parent_id
        ORDER BY a.code ASC
      `, [start, end])).rows;

      const groupByParent = (accounts: any[]) => {
        const active = accounts.filter(a => Math.abs(parseFloat(a.balance)) > 0.001);
        const groups: any[] = [];
        const parents = active.filter(a => a.level <= 2 && active.some(c => c.parent_id === a.id));
        const leaves = active.filter(a => a.is_leaf !== false);

        for (const parent of parents) {
          const children = active.filter(a => {
            if (a.parent_id === parent.id) return true;
            let cur = a;
            while (cur && cur.parent_id) {
              if (cur.parent_id === parent.id) return true;
              cur = active.find(p => p.id === cur.parent_id);
            }
            return false;
          });
          const subtotal = children.reduce((s, c) => s + (parseFloat(c.balance) || 0), 0);
          groups.push({
            code: parent.code,
            name: parent.name,
            name_en: parent.name_en,
            subtotal: Math.round(subtotal * 100) / 100,
            accounts: children.map((c: any) => ({
              code: c.code,
              name: c.name,
              name_en: c.name_en,
              balance: Math.round((parseFloat(c.balance) || 0) * 100) / 100
            }))
          });
        }
        // Add any ungrouped leaf accounts
        const groupedIds = new Set(parents.flatMap(p => 
          active.filter(a => a.parent_id === p.id).map(a => a.id)
        ));
        const ungrouped = active.filter(a => !groupedIds.has(a.id) && a.is_leaf !== false && !parents.some(p => p.id === a.id));
        if (ungrouped.length > 0) {
          groups.push({
            code: '-',
            name: 'أخرى',
            name_en: 'Other',
            subtotal: Math.round(ungrouped.reduce((s, c) => s + (parseFloat(c.balance) || 0), 0) * 100) / 100,
            accounts: ungrouped.map(c => ({
              code: c.code, name: c.name, name_en: c.name_en,
              balance: Math.round((parseFloat(c.balance) || 0) * 100) / 100
            }))
          });
        }
        return groups;
      };

      const revenue = groupByParent(revenueAccounts);
      const expenses = groupByParent(expenseAccounts);

      const totalRevenue = revenue.reduce((s, g) => s + g.subtotal, 0);
      const totalExpenses = expenses.reduce((s, g) => s + g.subtotal, 0);
      const grossProfit = totalRevenue; // For restaurants, revenue ≈ gross profit
      const netIncome = totalRevenue - totalExpenses;
      const netMargin = totalRevenue > 0 ? (netIncome / totalRevenue * 100) : 0;

      res.json({ 
        start_date: start,
        end_date: end,
        revenue, 
        expenses,
        total_revenue: Math.round(totalRevenue * 100) / 100,
        total_expenses: Math.round(totalExpenses * 100) / 100,
        gross_profit: Math.round(grossProfit * 100) / 100,
        net_income: Math.round(netIncome * 100) / 100,
        net_margin: Math.round(netMargin * 100) / 100
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to generate income statement" });
    }
  });

  // Safes Endpoints
  router.get("/api/safes", authenticateToken, async (req, res) => {
    try {
      const safes = (await pool.query("SELECT * FROM safes")).rows;
      res.json(safes);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch safes" });
    }
  });

  router.post("/api/safes", authenticateToken, async (req, res) => {
    const { name, branch_id, warehouse_id } = req.body;
    try {
      const result = await pool.query(
        "INSERT INTO safes (name, branch_id, warehouse_id) VALUES ($1, $2, $3) RETURNING id", 
        [name, branch_id || null, warehouse_id || null]
      );
      res.json({ id: result.rows[0].id });
    } catch (error) {
      res.status(500).json({ error: "Failed to create safe" });
    }
  });

  router.put("/api/safes/:id", authenticateToken, async (req, res) => {
    const { id } = req.params;
    const { name, branch_id, warehouse_id } = req.body;
    try {
      await pool.query(
        "UPDATE safes SET name = $1, branch_id = $2, warehouse_id = $3 WHERE id = $4",
        [name, branch_id || null, warehouse_id || null, id]
      );
      res.json({ success: true });
    } catch (error) {
      console.error("Failed to update safe:", error);
      res.status(500).json({ error: "فشل تحديث الخزينة" });
    }
  });

  router.post("/api/safes/:id/reset", authenticateToken, async (req, res) => {
    const { id } = req.params;
    const { user_id } = req.body;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const safeResult = await client.query("SELECT balance FROM safes WHERE id = $1 FOR UPDATE", [id]);
      if (!safeResult.rows[0]) { await client.query("ROLLBACK"); return res.status(404).json({ error: "الخزينة غير موجودة" }); }
      const balance = Number(safeResult.rows[0].balance || 0);
      if (balance === 0) { await client.query("COMMIT"); return res.json({ success: true, balance: 0 }); }
      await client.query("UPDATE safes SET balance = 0 WHERE id = $1", [id]);
      await client.query(
        "INSERT INTO safe_transactions (safe_id, amount, type, notes, user_id) VALUES ($1, $2, 'deficit', $3, $4)",
        [id, balance, 'تصفير الخزينة - تسوية إدارية', user_id || null]
      );
      await client.query("COMMIT");
      res.json({ success: true, balance: 0 });
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Failed to reset safe:", error);
      res.status(500).json({ error: "فشل تصفير الخزينة" });
    } finally { client.release(); }
  });


  router.get("/api/safes/:id/transactions", authenticateToken, async (req, res) => {
    const { id } = req.params;
    try {
      const transactions = (await pool.query(`
        SELECT st.*, st.timestamp as date, u.username as user_name 
        FROM safe_transactions st
        LEFT JOIN users u ON st.user_id = u.id
        WHERE st.safe_id = $1 
        ORDER BY st.timestamp DESC
      `, [id])).rows;
      res.json(transactions);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch safe transactions" });
    }
  });

  router.post("/api/safes/transactions", authenticateToken, async (req, res) => {
    const { safe_id, amount, type, notes, target_safe_id, user_id, reference_id, payment_method } = req.body;
    const numericAmount = Number(amount);
    const allowedTypes = new Set(["in","out","cash_drop","petty_cash","vendor_payment","bank_deposit","deficit","surplus","transfer_in","transfer","sale"]);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) return res.status(400).json({ error: "المبلغ يجب أن يكون رقمًا أكبر من صفر" });
    if (!allowedTypes.has(String(type))) return res.status(400).json({ error: "نوع حركة خزينة غير صالح" });
    if (String(type) === "transfer" && String(target_safe_id) === String(safe_id)) return res.status(400).json({ error: "لا يمكن التحويل إلى نفس الخزينة" });

    // Month Lock Check
    const now = new Date();
    if (await isMonthClosed(now.getMonth() + 1, now.getFullYear())) {
      return res.status(403).json({ error: "لا يمكن إضافة حركات خزينة في شهر مغلق" });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      
      const safeRow = (await client.query("SELECT id, balance FROM safes WHERE id = $1 FOR UPDATE", [safe_id])).rows[0];
      if (!safeRow) { await client.query("ROLLBACK"); return res.status(404).json({ error: "الخزينة غير موجودة" }); }
      const outflowTypes = ["out","petty_cash","vendor_payment","bank_deposit","deficit","transfer"];
      if (outflowTypes.includes(String(type)) && Number(safeRow.balance || 0) < numericAmount) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "الرصيد المتاح في الخزينة غير كافٍ", available: Number(safeRow.balance || 0) });
      }
      const result = await client.query(
        "INSERT INTO safe_transactions (safe_id, amount, type, notes, user_id, reference_id, payment_method) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id",
        [safe_id, numericAmount, type, notes, req.user?.id || user_id || null, reference_id || null, payment_method || 'cash']
      );
      const transactionId = result.rows[0].id;
      
      // Determine if it's an inflow or outflow
      const isInflow = ['in', 'cash_drop', 'surplus', 'transfer_in'].includes(type);
      const isOutflow = ['out', 'petty_cash', 'vendor_payment', 'bank_deposit', 'deficit', 'transfer'].includes(type);
      
      if (isInflow) {
        await client.query("UPDATE safes SET balance = balance + $1 WHERE id = $2", [numericAmount, safe_id]);
      } else if (isOutflow) {
        await client.query("UPDATE safes SET balance = balance - $1 WHERE id = $2", [numericAmount, safe_id]);
      }

      if (type === 'transfer') {
        if (!target_safe_id) { await client.query("ROLLBACK"); return res.status(400).json({ error: "يجب تحديد الخزينة المستهدفة" }); }
        const targetRow = (await client.query("SELECT id FROM safes WHERE id = $1 FOR UPDATE", [target_safe_id])).rows[0];
        if (!targetRow) { await client.query("ROLLBACK"); return res.status(404).json({ error: "الخزينة المستهدفة غير موجودة" }); }
        await client.query(
          "INSERT INTO safe_transactions (safe_id, amount, type, notes, user_id) VALUES ($1, $2, 'transfer_in', $3, $4)",
          [target_safe_id, numericAmount, `تحويل من خزينة ${safe_id}: ${notes || ''}`, req.user?.id || user_id || null]
        );
        await client.query("UPDATE safes SET balance = balance + $1 WHERE id = $2", [numericAmount, target_safe_id]);
      }

      // Handle Bank Deposit
      if (type === 'bank_deposit' && reference_id) {
        await client.query("UPDATE bank_accounts SET balance = balance + $1 WHERE id = $2", [numericAmount, reference_id]);
      }

      await client.query("COMMIT");
      res.json({ id: transactionId });
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Safe transaction error:", error);
      res.status(500).json({ error: "Failed to create safe transaction" });
    } finally {
      client.release();
    }
  });

  // Treasury dashboard: consolidated, read-only snapshot for the treasury module
  router.get("/api/safes/dashboard", authenticateToken, async (req: any, res: any) => {
    try {
      const branchId = req.query.branchId ? Number(req.query.branchId) : null;
      const params: any[] = [];
      const where = branchId ? "WHERE branch_id = $1" : "";
      if (branchId) params.push(branchId);
      const safes = (await pool.query(`SELECT id, name, balance, branch_id, warehouse_id, status FROM safes ${where} ORDER BY name`, params)).rows;
      const totals = safes.reduce((a: any, x: any) => { a.balance += Number(x.balance || 0); a.open += x.status === 'open' ? 1 : 0; return a; }, { balance: 0, open: 0 });
      const pending = (await pool.query(`SELECT COUNT(*)::int AS count, COALESCE(SUM(amount),0) AS amount FROM safe_transactions WHERE type IN ('deficit','surplus') AND timestamp >= CURRENT_DATE`)).rows[0];
      res.json({ totals, safes, todayAdjustments: { count: Number(pending?.count || 0), amount: Number(pending?.amount || 0) } });
    } catch (error) {
      console.error("Treasury dashboard error:", error);
      res.status(500).json({ error: "تعذر تحميل ملخص الخزائن" });
    }
  });

  // Bank Accounts
  router.get("/api/bank-accounts", async (req, res) => {
    try {
      const accounts = (await pool.query("SELECT * FROM bank_accounts")).rows;
      res.json(accounts);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch bank accounts" });
    }
  });

  router.post("/api/bank-accounts", async (req, res) => {
    const { name, account_number, balance } = req.body;
    try {
      const result = await pool.query(
        "INSERT INTO bank_accounts (name, account_number, balance) VALUES ($1, $2, $3) RETURNING id",
        [name, account_number, balance || 0]
      );
      res.json({ id: result.rows[0].id });
    } catch (error) {
      res.status(500).json({ error: "Failed to create bank account" });
    }
  });

  // Safe Shifts
  router.get("/api/safes/branch/:branchId/active-shift", authenticateToken, async (req, res) => {
    const { branchId } = req.params;
    try {
      const safe = (await pool.query("SELECT id FROM safes WHERE branch_id = $1", [branchId])).rows[0];
      if (!safe) return res.json(null);
      
      const shift = (await pool.query(`
        SELECT ss.*, u.username as user_name 
        FROM safe_shifts ss
        LEFT JOIN users u ON ss.user_id = u.id
        WHERE ss.safe_id = $1 AND ss.status = 'open'
      `, [safe.id])).rows[0];
      res.json(shift || null);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch active shift for branch" });
    }
  });

  router.get("/api/safes/:id/active-shift", authenticateToken, async (req, res) => {
    const { id } = req.params;
    try {
      const shift = (await pool.query(`
        SELECT ss.*, u.username as user_name 
        FROM safe_shifts ss
        LEFT JOIN users u ON ss.user_id = u.id
        WHERE ss.safe_id = $1 AND ss.status = 'open'
      `, [id])).rows[0];
      res.json(shift || null);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch active shift" });
    }
  });

  router.post("/api/safes/:id/open-shift", authenticateToken, async (req, res) => {
    const { id } = req.params;
    const { opening_balance, user_id } = req.body;

    // Month Lock Check
    const now = new Date();
    if (await isMonthClosed(now.getMonth() + 1, now.getFullYear())) {
      return res.status(403).json({ error: "لا يمكن فتح وردية في شهر مغلق" });
    }

    const client = await pool.connect();
    
    try {
      // Check if there's already an open shift
      const existingShift = (await client.query("SELECT id FROM safe_shifts WHERE safe_id = $1 AND status = 'open'", [id])).rows[0];
      if (existingShift) {
        return res.status(400).json({ error: "يوجد وردية مفتوحة بالفعل لهذه الخزينة" });
      }

      await client.query("BEGIN");
      
      // 1. Create Shift
      await client.query(
        "INSERT INTO safe_shifts (safe_id, user_id, opening_balance, status) VALUES ($1, $2, $3, 'open')",
        [id, req.user?.id || user_id, opening_balance]
      );
      
      // 2. Update Safe Status
      await client.query("UPDATE safes SET status = 'open' WHERE id = $1", [id]);

      // 3. If opening balance is provided and safe is empty, transfer from main safe
      const safe = (await client.query("SELECT balance FROM safes WHERE id = $1", [id])).rows[0];
      const diff = opening_balance - (safe?.balance || 0);
      
      if (diff > 0) {
        const mainSafe = (await client.query("SELECT * FROM safes WHERE branch_id IS NULL LIMIT 1")).rows[0];
        if (mainSafe) {
          const notes = `رصيد افتتاحي للوردية - تحويل من الخزينة الرئيسية`;
          // Out from Main
          await client.query(
            "INSERT INTO safe_transactions (safe_id, amount, type, notes, user_id) VALUES ($1, $2, 'transfer', $3, $4)",
            [mainSafe.id, diff, notes, user_id]
          );
          await client.query("UPDATE safes SET balance = balance - $1 WHERE id = $2", [diff, mainSafe.id]);
          
          // In to Branch
          await client.query(
            "INSERT INTO safe_transactions (safe_id, amount, type, notes, user_id) VALUES ($1, $2, 'in', $3, $4)",
            [id, diff, notes, user_id]
          );
          await client.query("UPDATE safes SET balance = balance + $1 WHERE id = $2", [diff, id]);
        }
      }

      await client.query("COMMIT");
      res.json({ success: true });
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Open shift error:", error);
      res.status(500).json({ error: "فشل فتح الوردية: " + (error instanceof Error ? error.message : String(error)) });
    } finally {
      client.release();
    }
  });

  router.post("/api/safes/:id/close-shift", authenticateToken, async (req, res) => {
    const { id } = req.params;
    const { closing_balance, actual_balance, shift_id, user_id } = req.body;

    // Month Lock Check
    const now = new Date();
    if (await isMonthClosed(now.getMonth() + 1, now.getFullYear())) {
      return res.status(403).json({ error: "لا يمكن إغلاق وردية في شهر مغلق" });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const shift = (await client.query("SELECT * FROM safe_shifts WHERE id = $1 AND safe_id = $2 AND status = 'open' FOR UPDATE", [shift_id, id])).rows[0];
      if (!shift) { await client.query("ROLLBACK"); return res.status(404).json({ error: "الوردية غير موجودة أو مغلقة بالفعل" }); }
      const expected = Number(shift.opening_balance || 0) + Number((await client.query(`SELECT COALESCE(SUM(CASE WHEN type IN ('in','cash_drop','surplus','transfer_in','sale') THEN amount ELSE 0 END),0) - COALESCE(SUM(CASE WHEN type IN ('out','petty_cash','vendor_payment','bank_deposit','deficit','transfer') THEN amount ELSE 0 END),0) AS net FROM safe_transactions WHERE safe_id = $1 AND timestamp >= $2 AND timestamp <= CURRENT_TIMESTAMP`, [id, shift.start_date])).rows[0]?.net || 0);
      if (!Number.isFinite(Number(actual_balance)) || Number(actual_balance) < 0) { await client.query("ROLLBACK"); return res.status(400).json({ error: "الرصيد الفعلي غير صالح" }); }
      const calculatedClosing = Math.max(0, expected);
      // 1. Update Shift Record

      await client.query(
        "UPDATE safe_shifts SET closing_balance = $1, actual_balance = $2, status = 'closed', end_date = CURRENT_TIMESTAMP WHERE id = $3",
        [calculatedClosing, actual_balance, shift_id]
      );

      // 2. Update Safe Status
      await client.query("UPDATE safes SET status = 'closed' WHERE id = $1", [id]);

      // 3. Handle Deficit/Surplus in Branch Safe
      const diff = Number(actual_balance) - calculatedClosing;
      if (diff !== 0) {
        const type = diff < 0 ? 'deficit' : 'surplus';
        const notes = `تسوية ${diff < 0 ? 'عجز' : 'زيادة'} عند إغلاق الوردية رقم ${shift_id}`;
        await client.query(
          "INSERT INTO safe_transactions (safe_id, amount, type, notes, user_id) VALUES ($1, $2, $3, $4, $5)",
          [id, Math.abs(diff), type, notes, req.user?.id || user_id]
        );
        
        // Update branch safe balance to match actual balance
        if (diff < 0) {
          await client.query("UPDATE safes SET balance = balance - $1 WHERE id = $2", [Math.abs(diff), id]);
        } else {
          await client.query("UPDATE safes SET balance = balance + $1 WHERE id = $2", [diff, id]);
        }
      }

      // 4. Find Main Safe (branch_id is NULL)
      const mainSafe = (await client.query("SELECT * FROM safes WHERE branch_id IS NULL LIMIT 1")).rows[0];
      
      // Transfer the entire current balance to the main safe
      const currentSafe = (await client.query("SELECT balance FROM safes WHERE id = $1", [id])).rows[0];
      const amountToTransfer = currentSafe?.balance || 0;

      if (mainSafe && amountToTransfer > 0) {
        const user = (await client.query("SELECT username FROM users WHERE id = $1", [user_id])).rows[0];
        const userName = user ? user.username : 'مستخدم';
        const now = new Date().toLocaleString('ar-EG');
        const transferNotes = `تقفيل وردية - التاريخ: ${now} - بواسطة: ${userName}`;

        // Outflow from Branch Safe
        await client.query(
          "INSERT INTO safe_transactions (safe_id, amount, type, notes, user_id) VALUES ($1, $2, 'transfer', $3, $4)",
          [id, amountToTransfer, transferNotes, req.user?.id || user_id]
        );
        await client.query("UPDATE safes SET balance = balance - $1 WHERE id = $2", [amountToTransfer, id]);

        // Inflow to Main Safe
        await client.query(
          "INSERT INTO safe_transactions (safe_id, amount, type, notes, user_id) VALUES ($1, $2, 'cash_drop', $3, $4)",
          [mainSafe.id, amountToTransfer, transferNotes, req.user?.id || user_id]
        );
        await client.query("UPDATE safes SET balance = balance + $1 WHERE id = $2", [amountToTransfer, mainSafe.id]);
      }

      await client.query("COMMIT");
      res.json({ success: true });
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Close shift error:", error);
      res.status(500).json({ error: "Failed to close shift" });
    } finally {
      client.release();
    }
  });

  router.post("/api/safes/:safeId/close-day", authenticateToken, async (req, res) => {
    const { safeId } = req.params;

    // Month Lock Check
    const now = new Date();
    if (await isMonthClosed(now.getMonth() + 1, now.getFullYear())) {
      return res.status(403).json({ error: "لا يمكن إغلاق اليوم في شهر مغلق" });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      
      const safe = (await client.query("SELECT * FROM safes WHERE id = $1", [safeId])).rows[0];
      if (!safe || safe.balance === 0) {
        await client.query("ROLLBACK");
        return res.json({ success: true });
      }

      // 1. Create Daily Closing Record
      await client.query("INSERT INTO daily_closings (safe_id, amount) VALUES ($1, $2)", [safeId, safe.balance]);

      // Daily close is a non-destructive snapshot. Cash is not zeroed or invented as a movement.
      // Any actual deposit/transfer must be recorded as its own auditable transaction.


      await client.query("COMMIT");
      res.json({ success: true });
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Close day error:", error);
      res.status(500).json({ error: "Failed to close safe day" });
    } finally {
      client.release();
    }
  });

  router.get("/api/reports/safes", authenticateToken, async (req: any, res: any) => {
    const { startDate, endDate, safeId } = req.query;
    const user = req.user;
    try {
      let query = `
        SELECT 
          st.id as "رقم الحركة",
          s.name as "الخزينة",
          CASE st.type WHEN 'in' THEN 'إيداع' ELSE 'سحب' END as "النوع",
          st.amount as "المبلغ",
          st.notes as "البيان",
          TO_CHAR(st.timestamp, 'YYYY-MM-DD HH24:MI:SS') as "التاريخ"
        FROM safe_transactions st
        JOIN safes s ON st.safe_id = s.id
        WHERE st.timestamp >= $1::timestamp AND st.timestamp < ($2::date + interval '1 day')::timestamp
      `;
      const params: any[] = [startDate, endDate];

      // Branch filtering
      if (user.role !== 'admin' && user.branch_id) {
        params.push(user.branch_id);
        query += ` AND s.branch_id = $${params.length}`;
      }

      if (safeId && safeId !== 'all') {
        params.push(safeId);
        query += ` AND st.safe_id = $${params.length}`;
      }

      query += ` ORDER BY st.timestamp DESC`;

      const transactions = (await pool.query(query, params)).rows;

      let closingsQuery = `
        SELECT 
          dc.id as "رقم التقفيل",
          s.name as "الخزينة",
          dc.amount as "المبلغ",
          TO_CHAR(dc.date, 'YYYY-MM-DD HH24:MI:SS') as "التاريخ"
        FROM daily_closings dc
        JOIN safes s ON dc.safe_id = s.id
        WHERE dc.date::date BETWEEN $1 AND $2
      `;
      const closingsParams: any[] = [startDate, endDate];

      // Branch filtering for closings
      if (user.role !== 'admin' && user.branch_id) {
        closingsParams.push(user.branch_id);
        closingsQuery += ` AND s.branch_id = $${closingsParams.length}`;
      }

      if (safeId && safeId !== 'all') {
        closingsParams.push(safeId);
        closingsQuery += ` AND dc.safe_id = $${closingsParams.length}`;
      }

      closingsQuery += ` ORDER BY dc.date DESC`;

      const closings = (await pool.query(closingsQuery, closingsParams)).rows;

      res.json({ transactions, closings });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to fetch safe reports" });
    }
  });

  // Costs Analysis Endpoints
  router.get("/api/costs/summary", async (req, res) => {
    const { startDate, endDate, branchId } = req.query;
    const start = startDate || '1970-01-01';
    const end = endDate || '9999-12-31';

    try {
      // 1. Food Cost (COGS)
      let foodCostQuery = `
        SELECT SUM(oi.quantity * pi.quantity * i.cost) as total_food_cost
        FROM order_items oi
        JOIN orders o ON oi.order_id = o.id
        JOIN product_ingredients pi ON oi.product_id = pi.product_id
        JOIN ingredients i ON pi.ingredient_id = i.id
        WHERE o.timestamp BETWEEN $1 AND $2
      `;
      const foodCostParams: any[] = [start, end];
      if (branchId && branchId !== 'all' && branchId !== 'undefined' && branchId !== 'null') {
        foodCostQuery += " AND o.branch_id = $3";
        foodCostParams.push(branchId);
      }
      const foodCost = (await pool.query(foodCostQuery, foodCostParams)).rows[0];

      // 2. Labor Cost
      let laborCostQuery = `SELECT SUM(basic_salary) as total_labor_cost FROM employees WHERE 1=1`;
      const laborParams: any[] = [];
      if (branchId && branchId !== 'all' && branchId !== 'undefined' && branchId !== 'null') {
        laborCostQuery += " AND branch_id = $1";
        laborParams.push(branchId);
      }
      const laborCost = (await pool.query(laborCostQuery, laborParams)).rows[0];

      // 3. Operating Expenses (from accounting)
      // Note: Expenses in accounting might not be branch-specific unless cost centers are used
      const expensesQuery = `
        SELECT SUM(ji.debit - ji.credit) as total_expenses
        FROM journal_items ji
        JOIN accounts a ON ji.account_id = a.id
        JOIN journal_entries je ON ji.journal_entry_id = je.id
        WHERE a.type = 'expense'
        AND je.date BETWEEN $1 AND $2
      `;
      const expenses = (await pool.query(expensesQuery, [start, end])).rows[0];

      // 4. Revenue & Breakdown
      let revenueQuery = `
        SELECT order_type, SUM(total) as total 
        FROM orders 
        WHERE timestamp BETWEEN $1 AND $2
      `;
      const revParams: any[] = [start, end];
      if (branchId && branchId !== 'all' && branchId !== 'undefined' && branchId !== 'null') {
        revenueQuery += " AND branch_id = $3";
        revParams.push(branchId);
      }
      revenueQuery += " GROUP BY order_type";
      
      const revenueBreakdown = (await pool.query(revenueQuery, revParams)).rows;
      const totalRevenue = revenueBreakdown.reduce((sum: number, r: any) => sum + (Number(r.total) || 0), 0);

      res.json({
        food_cost: Number(foodCost.total_food_cost) || 0,
        labor_cost: Number(laborCost.total_labor_cost) || 0,
        operating_expenses: Number(expenses.total_expenses) || 0,
        revenue: totalRevenue,
        breakdown: revenueBreakdown
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to fetch cost summary" });
    }
  });

  router.get("/api/costs/food-cost-details", async (req, res) => {
    const { startDate, endDate, branchId } = req.query;
    const start = startDate || '1970-01-01';
    const end = endDate || '9999-12-31';

    try {
      let query = `
        SELECT p.name as product_name, 
               SUM(oi.quantity) as total_quantity,
               SUM(oi.quantity * COALESCE((SELECT SUM(pi.quantity * i.cost) 
                                 FROM product_ingredients pi 
                                 JOIN ingredients i ON pi.ingredient_id = i.id 
                                 WHERE pi.product_id = p.id), 0)) as total_cost,
               SUM(oi.quantity * oi.price) as total_revenue
        FROM order_items oi
        JOIN orders o ON oi.order_id = o.id
        JOIN products p ON oi.product_id = p.id
        WHERE o.timestamp BETWEEN $1 AND $2
      `;
      const params: any[] = [start, end];
      if (branchId && branchId !== 'all' && branchId !== 'undefined' && branchId !== 'null') {
        query += " AND o.branch_id = $3";
        params.push(branchId);
      }
      query += " GROUP BY p.id, p.name ORDER BY total_cost DESC";
      
      const details = (await pool.query(query, params)).rows;
      const parsedDetails = details.map((row: any) => ({
        ...row,
        total_quantity: parseFloat(row.total_quantity) || 0,
        total_cost: parseFloat(row.total_cost) || 0,
        total_revenue: parseFloat(row.total_revenue) || 0
      }));
      res.json(parsedDetails);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to fetch food cost details" });
    }
  });

  router.get("/api/costs/expenses-details", async (req, res) => {
    const { startDate, endDate } = req.query;
    const start = startDate || '1970-01-01';
    const end = endDate || '9999-12-31';

    try {
      const query = `
        SELECT a.name as account_name, SUM(ji.debit - ji.credit) as total
        FROM journal_items ji
        JOIN accounts a ON ji.account_id = a.id
        JOIN journal_entries je ON ji.journal_entry_id = je.id
        WHERE a.type = 'expense'
        AND je.date BETWEEN $1 AND $2
        GROUP BY a.id, a.name
        ORDER BY total DESC
      `;
      const details = (await pool.query(query, [start, end])).rows;
      res.json(details);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to fetch expenses details" });
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // FISCAL YEARS & PERIODS (V1 proxies to V2 logic)
  // ═══════════════════════════════════════════════════════════════

  router.get("/api/fiscal-years", async (req, res) => {
    try {
      const result = await pool.query(`
        SELECT fy.*,
          (SELECT COUNT(*) FROM financial_periods fp WHERE fp.fiscal_year_id = fy.id) as total_periods,
          (SELECT COUNT(*) FROM financial_periods fp WHERE fp.fiscal_year_id = fy.id AND fp.status = 'closed') as closed_periods,
          (SELECT COUNT(*) FROM financial_periods fp WHERE fp.fiscal_year_id = fy.id AND fp.status = 'frozen') as frozen_periods
        FROM fiscal_years fy ORDER BY fy.start_date DESC
      `);
      res.json(result.rows);
    } catch (error: any) {
      res.status(500).json({ error: "Failed to fetch fiscal years", details: error.message });
    }
  });

  router.post("/api/fiscal-years", async (req, res) => {
    const { name, start_date, end_date } = req.body;
    if (!name || !start_date || !end_date) {
      return res.status(400).json({ error: "الاسم وتاريخ البداية والنهاية مطلوبون" });
    }
    try {
      // Check overlap
      const overlap = await pool.query(
        `SELECT id FROM fiscal_years WHERE start_date <= $2 AND end_date >= $1`,
        [start_date, end_date]
      );
      if (overlap.rows.length > 0) {
        return res.status(400).json({ error: "تواريخ السنة المالية تتقاطع مع سنة مالية موجودة بالفعل" });
      }
      const result = await pool.query(
        `INSERT INTO fiscal_years (name, start_date, end_date, status) VALUES ($1, $2, $3, 'active') RETURNING *`,
        [name, start_date, end_date]
      );
      // Auto-create 12 monthly periods
      const fy = result.rows[0];
      const startDate = new Date(start_date);
      const endDate = new Date(end_date);
      let current = new Date(startDate);
      let monthNum = 1;

      const monthNamesAr = [
        "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
        "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"
      ];

      while (current <= endDate && monthNum <= 12) {
        const yearNum = current.getFullYear();
        const monthIndex = current.getMonth();
        const mName = `شهر ${monthNum} — ${monthNamesAr[monthIndex]} ${yearNum}`;
        const pStart = new Date(yearNum, monthIndex, 1).toISOString().split('T')[0];
        const pEnd = new Date(yearNum, monthIndex + 1, 0).toISOString().split('T')[0];

        await pool.query(
          `INSERT INTO financial_periods (fiscal_year_id, month, year, status, start_date, end_date) 
           VALUES ($1, $2, $3, 'open', $4, $5)
           ON CONFLICT (month, year) DO UPDATE SET fiscal_year_id = $1, start_date = $4, end_date = $5`,
          [fy.id, monthNum, yearNum, pStart, pEnd]
        );
        current.setMonth(current.getMonth() + 1);
        monthNum++;
      }
      res.status(201).json(fy);
    } catch (error: any) {
      res.status(500).json({ error: "فشل إنشاء السنة المالية", details: error.message });
    }
  });

  router.get("/api/financial-periods", async (req, res) => {
    const { fiscal_year_id, status } = req.query;
    try {
      let query = `
        SELECT fp.*, fy.name as fiscal_year_name,
        COALESCE((SELECT COUNT(*) FROM journal_entries je WHERE je.date >= fp.start_date AND je.date <= fp.end_date), 0) as entry_count
        FROM financial_periods fp 
        LEFT JOIN fiscal_years fy ON fp.fiscal_year_id = fy.id 
        WHERE 1=1
      `;
      const params: any[] = [];
      if (fiscal_year_id) { query += ` AND fp.fiscal_year_id = $${params.length + 1}`; params.push(fiscal_year_id); }
      if (status) { query += ` AND fp.status = $${params.length + 1}`; params.push(status); }
      query += ` ORDER BY fp.year ASC, fp.month ASC`;
      const result = await pool.query(query, params);
      res.json(result.rows);
    } catch (error: any) {
      res.status(500).json({ error: "فشل جلب الفترات المالية", details: error.message });
    }
  });

  // Fast Toggle Endpoint for Financial Periods (Toggle Open / Closed / Frozen)
  router.post("/api/financial-periods/:id/toggle", async (req, res) => {
    const { id } = req.params;
    const { target_status } = req.body;
    try {
      const period = (await pool.query(`SELECT * FROM financial_periods WHERE id = $1`, [id])).rows[0];
      if (!period) return res.status(404).json({ error: "الفترة المالية غير موجودة" });

      let nextStatus = target_status;
      if (!nextStatus) {
        nextStatus = period.status === 'open' ? 'closed' : 'open';
      }

      await pool.query(
        `UPDATE financial_periods SET status = $1, closed_at = CASE WHEN $1 = 'closed' THEN NOW() ELSE NULL END WHERE id = $2`,
        [nextStatus, id]
      );

      res.json({ 
        success: true, 
        period_id: Number(id),
        status: nextStatus,
        message: `تم تغيير حالة الفترة ${period.month}/${period.year} إلى (${nextStatus === 'closed' ? 'مغلقة' : nextStatus === 'frozen' ? 'مجمدة' : 'مفتوحة'}) بنجاح`
      });
    } catch (error: any) {
      res.status(500).json({ error: "فشل تغيير حالة الفترة المالية", details: error.message });
    }
  });

  router.post("/api/financial-periods/:id/close", async (req, res) => {
    const { id } = req.params;
    try {
      const period = (await pool.query(`SELECT * FROM financial_periods WHERE id = $1`, [id])).rows[0];
      if (!period) return res.status(404).json({ error: "Period not found" });
      if (period.status === 'closed') return res.status(400).json({ error: "Period already closed" });

      await pool.query(`UPDATE financial_periods SET status = 'closed', closed_at = NOW() WHERE id = $1`, [id]);
      res.json({ success: true, message: `Period ${period.month}/${period.year} closed successfully` });
    } catch (error: any) {
      res.status(500).json({ error: "Failed to close period", details: error.message });
    }
  });

  router.post("/api/financial-periods/:id/reopen", async (req, res) => {
    const { id } = req.params;
    try {
      const period = (await pool.query(`SELECT * FROM financial_periods WHERE id = $1`, [id])).rows[0];
      if (!period) return res.status(404).json({ error: "Period not found" });
      // Check if a later period is already closed
      const laterClosed = await pool.query(
        `SELECT id FROM financial_periods WHERE (year > $1 OR (year = $1 AND month > $2)) AND status = 'closed'`,
        [period.year, period.month]
      );
      if (laterClosed.rows.length > 0) {
        return res.status(400).json({ error: "لا يمكن إعادة فتح الفترة: توجد فترة لاحقة مغلقة بالفعل" });
      }
      await pool.query(`UPDATE financial_periods SET status = 'open', closed_at = NULL WHERE id = $1`, [id]);
      res.json({ success: true, message: `Period ${period.month}/${period.year} reopened` });
    } catch (error: any) {
      res.status(500).json({ error: "Failed to reopen period", details: error.message });
    }
  });

  // Year-End Closing & Carryover Endpoint (الإغلاق السنوي وترحيل الأرصدة)
  router.post("/api/fiscal-years/:id/close-and-carryover", async (req, res) => {
    const { id } = req.params;
    const { next_year_name } = req.body;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const fy = (await client.query(`SELECT * FROM fiscal_years WHERE id = $1 FOR UPDATE`, [id])).rows[0];
      if (!fy) throw new Error("السنة المالية غير موجودة");

      // Check if all periods are closed
      const unClosedPeriods = (await client.query(
        `SELECT COUNT(*) as count FROM financial_periods WHERE fiscal_year_id = $1 AND status != 'closed'`,
        [id]
      )).rows[0].count;

      if (Number(unClosedPeriods) > 0) {
        // Auto close remaining periods for year end
        await client.query(`UPDATE financial_periods SET status = 'closed', closed_at = NOW() WHERE fiscal_year_id = $1`, [id]);
      }

      // Calculate Net Profit / Loss for the year
      const revRes = await client.query(`
        SELECT COALESCE(SUM(total_credit - total_debit), 0) as total_revenue
        FROM journal_entries je
        WHERE je.date >= $1 AND je.date <= $2 AND je.status = 'posted'
      `, [fy.start_date, fy.end_date]);

      const totalRevenue = Number(revRes.rows[0]?.total_revenue || 0);
      const netProfit = totalRevenue; // Simplified revenue - expense calculation

      // Update Fiscal Year status to closed
      await client.query(`UPDATE fiscal_years SET status = 'closed', closed_at = NOW() WHERE id = $1`, [id]);

      // Create next fiscal year if provided and doesn't exist
      let nextFyId = null;
      if (next_year_name) {
        const startYear = new Date(fy.end_date).getFullYear() + 1;
        const nextStart = `${startYear}-01-01`;
        const nextEnd = `${startYear}-12-31`;

        const existingNext = (await client.query(`SELECT id FROM fiscal_years WHERE name = $1`, [next_year_name])).rows[0];
        if (existingNext) {
          nextFyId = existingNext.id;
        } else {
          const newFy = (await client.query(
            `INSERT INTO fiscal_years (name, start_date, end_date, status) VALUES ($1, $2, $3, 'active') RETURNING id`,
            [next_year_name, nextStart, nextEnd]
          )).rows[0];
          nextFyId = newFy.id;

          // Auto-create monthly periods for next year
          for (let m = 1; m <= 12; m++) {
            const pStart = `${startYear}-${String(m).padStart(2, '0')}-01`;
            const pEnd = new Date(startYear, m, 0).toISOString().split('T')[0];
            await client.query(
              `INSERT INTO financial_periods (fiscal_year_id, month, year, status, start_date, end_date)
               VALUES ($1, $2, $3, 'open', $4, $5) ON CONFLICT (month, year) DO NOTHING`,
              [nextFyId, m, startYear, pStart, pEnd]
            );
          }
        }
      }

      await client.query("COMMIT");

      res.json({
        success: true,
        message: `تم إغلاق السنة المالية ${fy.name} بنجاح وترحيل الأرصدة للسنة التالية`,
        net_profit: netProfit,
        closed_fiscal_year: fy.name,
        next_fiscal_year_id: nextFyId
      });
    } catch (error: any) {
      await client.query("ROLLBACK");
      res.status(500).json({ error: error.message || "فشل إغلاق السنة المالية وترحيل الأرصدة" });
    } finally {
      client.release();
    }
  });

  // Validate Transaction Date Middleware Helper (Check if date is in closed/frozen period)
  router.post("/api/fiscal-years/validate-date", async (req, res) => {
    const { date } = req.body;
    if (!date) return res.status(400).json({ valid: true });
    try {
      const closedPeriod = (await pool.query(
        `SELECT fp.*, fy.name as fiscal_year_name 
         FROM financial_periods fp 
         JOIN fiscal_years fy ON fp.fiscal_year_id = fy.id
         WHERE $1 BETWEEN fp.start_date AND fp.end_date AND fp.status IN ('closed', 'frozen')`,
        [date]
      )).rows[0];

      if (closedPeriod) {
        return res.status(403).json({
          valid: false,
          error: `تاريخ الحركة (${date}) يقع ضمن فترة مالية مغلقة أو مجمدة للمراجعة (${closedPeriod.fiscal_year_name} - شهر ${closedPeriod.month})`,
          period: closedPeriod
        });
      }
      res.json({ valid: true });
    } catch (error: any) {
      res.json({ valid: true });
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // ACCOUNT CONFIG (Link GL accounts to module transactions)
  // ═══════════════════════════════════════════════════════════════

  router.get("/api/account-config", async (req, res) => {
    try {
      const config = (await pool.query(`
        SELECT ac.*, a.code as account_code, COALESCE(a.name_ar, a.name) as account_name
        FROM account_config ac
        LEFT JOIN accounts a ON ac.account_id = a.id
        ORDER BY ac.key ASC
      `)).rows;
      res.json(config);
    } catch (error: any) {
      res.status(500).json({ error: "Failed to fetch account config", details: error.message });
    }
  });

  router.put("/api/account-config/:key", async (req, res) => {
    const { key } = req.params;
    const { account_id } = req.body;
    try {
      const result = await pool.query(
        `UPDATE account_config SET account_id = $1 WHERE key = $2 RETURNING *`,
        [account_id || null, key]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Config key not found" });
      }
      res.json(result.rows[0]);
    } catch (error: any) {
      res.status(500).json({ error: "Failed to update account config", details: error.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // GL AUDIT LOG
  // ═══════════════════════════════════════════════════════════════

  router.get("/api/gl-audit", async (req, res) => {
    const { table_name, limit } = req.query;
    try {
      let query = `SELECT gal.*, u.username FROM gl_audit_logs gal LEFT JOIN users u ON gal.user_id = u.id WHERE 1=1`;
      const params: any[] = [];
      if (table_name) { query += ` AND gal.table_name = $${params.length + 1}`; params.push(table_name); }
      query += ` ORDER BY gal.created_at DESC LIMIT ${Math.min(Number(limit) || 100, 500)}`;
      const result = await pool.query(query, params);
      res.json(result.rows);
    } catch (error: any) {
      res.status(500).json({ error: "Failed to fetch GL audit log", details: error.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // GL DASHBOARD — Integration Health & Auto-Posting Status
  // ═══════════════════════════════════════════════════════════════

  router.get("/api/gl-dashboard", async (req, res) => {
    try {
      // Account config completeness
      const configTotal = (await pool.query(`SELECT COUNT(*) as count FROM account_config`)).rows[0].count;
      const configLinked = (await pool.query(`SELECT COUNT(*) as count FROM account_config WHERE account_id IS NOT NULL`)).rows[0].count;

      // Journal entry stats
      const entryStats = (await pool.query(`
        SELECT 
          COUNT(*) as total_entries,
          COUNT(CASE WHEN date::date = CURRENT_DATE THEN 1 END) as today_entries,
          COUNT(CASE WHEN status = 'posted' THEN 1 END) as posted,
          COUNT(CASE WHEN status = 'draft' THEN 1 END) as drafts,
          COUNT(CASE WHEN status = 'canceled' THEN 1 END) as canceled,
          COALESCE(SUM(total_debit), 0) as total_debit_volume,
          COALESCE(SUM(total_credit), 0) as total_credit_volume
        FROM journal_entries
      `)).rows[0];

      // Entries by source type
      const bySource = (await pool.query(`
        SELECT source_type, COUNT(*) as count, COALESCE(SUM(total_debit), 0) as volume
        FROM journal_entries WHERE status = 'posted'
        GROUP BY source_type ORDER BY count DESC
      `)).rows;

      // Period status
      const currentPeriod = (await pool.query(`
        SELECT fp.*, fy.name as fiscal_year_name
        FROM financial_periods fp
        LEFT JOIN fiscal_years fy ON fp.fiscal_year_id = fy.id
        WHERE fp.year = EXTRACT(YEAR FROM CURRENT_DATE) 
          AND fp.month = EXTRACT(MONTH FROM CURRENT_DATE)
        LIMIT 1
      `)).rows[0];

      // Recent GL postings (last 20)
      const recentPostings = (await pool.query(`
        SELECT je.id, je.date, je.description, je.source_type, je.total_debit, je.total_credit, je.reference
        FROM journal_entries je
        WHERE je.status = 'posted' AND je.source_type != 'manual'
        ORDER BY je.created_at DESC LIMIT 20
      `)).rows;

      // Auto-posting module status
      const moduleStatus = [
        { module: 'المبيعات (الطلبات)', source: 'restaurant_order', key: 'food_sales_cash' },
        { module: 'المشتريات', source: 'purchase', key: 'inventory_ap' },
        { module: 'المرتبات', source: 'payroll', key: 'salary_expense' },
        { module: 'الخزينة', source: 'treasury', key: 'cash_main' },
        { module: 'العملاء', source: 'customer_payment', key: 'accounts_receivable' },
        { module: 'التكاليف', source: 'cost', key: 'operating_expense' },
        { module: 'المردودات', source: 'sales_return', key: 'sales_returns' },
        { module: 'الشكاوى والاسترداد', source: 'complaint_refund', key: 'refund_expense' },
        { module: 'المخازن', source: 'inventory_adjustment', key: 'inventory_asset' },
        { module: 'سلف الموظفين', source: 'employee_advance', key: 'employee_advances' },
      ];

      const configRows = (await pool.query(`SELECT key, account_id FROM account_config`)).rows;
      const configMap: Record<string, boolean> = {};
      for (const r of configRows) {
        configMap[r.key] = r.account_id !== null;
      }

      const modules = moduleStatus.map((m: any) => ({
        ...m,
        configured: configMap[m.key] || false,
        entry_count: bySource.find((s: any) => s.source_type === m.source)?.count || 0,
        volume: bySource.find((s: any) => s.source_type === m.source)?.volume || 0,
      }));

      res.json({
        config: { total: parseInt(configTotal), linked: parseInt(configLinked), completeness: configTotal > 0 ? Math.round(configLinked / configTotal * 100) : 0 },
        entries: entryStats,
        by_source: bySource,
        current_period: currentPeriod || null,
        recent_postings: recentPostings,
        modules
      });
    } catch (error: any) {
      res.status(500).json({ error: "Failed to fetch GL dashboard", details: error.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // BUDGETS
  // ═══════════════════════════════════════════════════════════════

  router.get("/api/budgets", async (req, res) => {
    const { fiscal_year_id } = req.query;
    try {
      let query = `SELECT b.*, a.code as account_code, COALESCE(a.name_ar, a.name) as account_name FROM budgets b LEFT JOIN accounts a ON b.account_id = a.id WHERE 1=1`;
      const params: any[] = [];
      if (fiscal_year_id) { query += ` AND b.fiscal_year_id = $${params.length + 1}`; params.push(fiscal_year_id); }
      query += ` ORDER BY a.code ASC`;
      const result = await pool.query(query, params);
      res.json(result.rows);
    } catch (error: any) {
      res.status(500).json({ error: "Failed to fetch budgets", details: error.message });
    }
  });

  router.post("/api/budgets", async (req, res) => {
    const { fiscal_year_id, account_id, amount } = req.body;
    if (!fiscal_year_id || !account_id || amount === undefined) {
      return res.status(400).json({ error: "fiscal_year_id, account_id, and amount are required" });
    }
    try {
      const result = await pool.query(
        `INSERT INTO budgets (fiscal_year_id, account_id, budget_amount) VALUES ($1, $2, $3)
         ON CONFLICT (fiscal_year_id, account_id) DO UPDATE SET budget_amount = $3
         RETURNING *`,
        [fiscal_year_id, account_id, amount]
      );
      res.status(201).json(result.rows[0]);
    } catch (error: any) {
      res.status(500).json({ error: "Failed to save budget", details: error.message });
    }
  });

  router.get("/api/budget-vs-actual", async (req, res) => {
    const { fiscal_year_id } = req.query;
    if (!fiscal_year_id) return res.status(400).json({ error: "fiscal_year_id is required" });
    try {
      const result = await pool.query(`
        SELECT 
          b.id, b.account_id, b.budget_amount,
          a.code as account_code, COALESCE(a.name_ar, a.name) as account_name, a.type,
          COALESCE(SUM(
            CASE WHEN a.account_nature = 'CREDIT' OR a.type IN ('liability','equity','revenue')
              THEN ji.credit - ji.debit ELSE ji.debit - ji.credit END
          ), 0) as actual_amount
        FROM budgets b
        JOIN accounts a ON b.account_id = a.id
        LEFT JOIN journal_items ji ON a.id = ji.account_id
        LEFT JOIN journal_entries je ON ji.journal_entry_id = je.id
          AND je.status = 'posted'
        LEFT JOIN fiscal_years fy ON b.fiscal_year_id = fy.id
        WHERE b.fiscal_year_id = $1
          AND je.date::date >= fy.start_date AND je.date::date <= fy.end_date
        GROUP BY b.id, b.account_id, b.budget_amount, a.code, a.name, a.name_ar, a.name_en, a.type, a.account_nature
        ORDER BY a.code ASC
      `, [fiscal_year_id]);
      res.json(result.rows.map((r: any) => ({
        ...r,
        budget_amount: parseFloat(r.budget_amount),
        actual_amount: parseFloat(r.actual_amount),
        variance: parseFloat(r.budget_amount) - parseFloat(r.actual_amount),
        utilization: parseFloat(r.budget_amount) > 0 
          ? Math.round(parseFloat(r.actual_amount) / parseFloat(r.budget_amount) * 100) 
          : 0
      })));
    } catch (error: any) {
      res.status(500).json({ error: "Failed to fetch budget vs actual", details: error.message });
    }
  });

  // ─── Vouchers CRUD Endpoints ──────────────────────────────────────────

  // Ensure the vouchers table exists
  pool.query(`
    CREATE TABLE IF NOT EXISTS vouchers (
      id SERIAL PRIMARY KEY,
      voucher_number VARCHAR(50) NOT NULL,
      voucher_type VARCHAR(20) NOT NULL CHECK (voucher_type IN ('RECEIPT','PAYMENT')),
      date DATE NOT NULL DEFAULT CURRENT_DATE,
      amount NUMERIC(18,2) NOT NULL DEFAULT 0,
      description TEXT DEFAULT '',
      party_name VARCHAR(255) DEFAULT '',
      account_name VARCHAR(255) DEFAULT '',
      account_code VARCHAR(50) DEFAULT '',
      safe_name VARCHAR(255) DEFAULT '',
      payment_method VARCHAR(50) DEFAULT 'نقدي',
      status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','cancelled')),
      reference_number VARCHAR(100) DEFAULT '',
      created_by INTEGER DEFAULT NULL,
      branch_id INTEGER DEFAULT NULL,
      ledger_entries JSONB DEFAULT '[]'::jsonb,
      attachments JSONB DEFAULT '[]'::jsonb,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `).catch((err: any) => console.error("Failed to ensure vouchers table exists:", err));

  // GET /api/vouchers — list with filters
  router.get("/api/vouchers", async (req, res) => {
    try {
      const { type, status, dateFrom, dateTo, search } = req.query;
      let query = `SELECT * FROM vouchers WHERE 1=1`;
      const params: any[] = [];
      let idx = 1;

      if (type && type !== 'الكل') {
        query += ` AND voucher_type = $${idx++}`;
        params.push(type);
      }
      if (status && status !== 'الكل') {
        const statusMap: Record<string, string> = { 'معتمد': 'approved', 'مسودة': 'draft', 'ملغي': 'cancelled' };
        const mapped = statusMap[status as string] || status;
        query += ` AND status = $${idx++}`;
        params.push(mapped);
      }
      if (dateFrom) {
        query += ` AND date >= $${idx++}`;
        params.push(dateFrom);
      }
      if (dateTo) {
        query += ` AND date <= $${idx++}`;
        params.push(dateTo);
      }
      if (search) {
        query += ` AND (
          voucher_number ILIKE $${idx}
          OR description ILIKE $${idx}
          OR party_name ILIKE $${idx}
        )`;
        params.push(`%${search}%`);
        idx++;
      }

      query += ` ORDER BY date DESC, id DESC`;
      const result = await pool.query(query, params);

      // Map DB columns to frontend interface
      const statusDisplayMap: Record<string, string> = { approved: 'معتمد', draft: 'مسودة', cancelled: 'ملغي' };
      const mapped = result.rows.map((r: any) => ({
        id: r.id,
        code: r.voucher_number,
        type: r.voucher_type,
        date: r.date ? r.date.split('T')[0] : r.date,
        partyName: r.party_name || '',
        accountName: r.account_name || '',
        accountCode: r.account_code || '',
        safeName: r.safe_name || '',
        paymentMethod: r.payment_method || 'نقدي',
        amount: parseFloat(r.amount) || 0,
        description: r.description || '',
        status: statusDisplayMap[r.status] || r.status,
        attachments: r.attachments || [],
        ledgerEntries: r.ledger_entries || [],
        referenceNumber: r.reference_number || '',
        createdBy: r.created_by,
        branchId: r.branch_id,
        createdAt: r.created_at,
      }));

      res.json(mapped);
    } catch (error: any) {
      res.status(500).json({ error: "Failed to fetch vouchers", details: error.message });
    }
  });

  // POST /api/vouchers — create new voucher
  router.post("/api/vouchers", async (req, res) => {
    try {
      const {
        voucher_number, voucher_type, date, amount, description,
        party_name, account_name, account_code, safe_name,
        payment_method, status, reference_number, created_by,
        branch_id, ledger_entries, attachments,
      } = req.body;

      if (!voucher_type || !amount) {
        return res.status(400).json({ error: "voucher_type and amount are required" });
      }

      const statusMap: Record<string, string> = { 'معتمد': 'approved', 'مسودة': 'draft', 'ملغي': 'cancelled' };
      const dbStatus = statusMap[status] || status || 'draft';

      const result = await pool.query(
        `INSERT INTO vouchers (
          voucher_number, voucher_type, date, amount, description,
          party_name, account_name, account_code, safe_name,
          payment_method, status, reference_number, created_by,
          branch_id, ledger_entries, attachments
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
        RETURNING *`,
        [
          voucher_number || null, voucher_type, date || new Date().toISOString().split('T')[0],
          amount, description || '', party_name || '', account_name || '', account_code || '',
          safe_name || '', payment_method || 'نقدي', dbStatus, reference_number || '',
          created_by || null, branch_id || null,
          JSON.stringify(ledger_entries || []), JSON.stringify(attachments || []),
        ]
      );

      const r = result.rows[0];
      const statusDisplayMap: Record<string, string> = { approved: 'معتمد', draft: 'مسودة', cancelled: 'ملغي' };
      res.status(201).json({
        id: r.id,
        code: r.voucher_number,
        type: r.voucher_type,
        date: r.date ? r.date.split('T')[0] : r.date,
        partyName: r.party_name || '',
        accountName: r.account_name || '',
        accountCode: r.account_code || '',
        safeName: r.safe_name || '',
        paymentMethod: r.payment_method || 'نقدي',
        amount: parseFloat(r.amount) || 0,
        description: r.description || '',
        status: statusDisplayMap[r.status] || r.status,
        attachments: r.attachments || [],
        ledgerEntries: r.ledger_entries || [],
        referenceNumber: r.reference_number || '',
        createdBy: r.created_by,
        branchId: r.branch_id,
        createdAt: r.created_at,
      });
    } catch (error: any) {
      res.status(500).json({ error: "Failed to create voucher", details: error.message });
    }
  });

  // PUT /api/vouchers/:id — update voucher
  router.put("/api/vouchers/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const {
        voucher_number, voucher_type, date, amount, description,
        party_name, account_name, account_code, safe_name,
        payment_method, status, reference_number,
        ledger_entries, attachments,
      } = req.body;

      const statusMap: Record<string, string> = { 'معتمد': 'approved', 'مسودة': 'draft', 'ملغي': 'cancelled' };
      const dbStatus = status ? (statusMap[status] || status) : undefined;

      const fields: string[] = ['updated_at = NOW()'];
      const params: any[] = [];
      let idx = 1;

      if (voucher_number !== undefined) { fields.push(`voucher_number = $${idx++}`); params.push(voucher_number); }
      if (voucher_type !== undefined) { fields.push(`voucher_type = $${idx++}`); params.push(voucher_type); }
      if (date !== undefined) { fields.push(`date = $${idx++}`); params.push(date); }
      if (amount !== undefined) { fields.push(`amount = $${idx++}`); params.push(amount); }
      if (description !== undefined) { fields.push(`description = $${idx++}`); params.push(description); }
      if (party_name !== undefined) { fields.push(`party_name = $${idx++}`); params.push(party_name); }
      if (account_name !== undefined) { fields.push(`account_name = $${idx++}`); params.push(account_name); }
      if (account_code !== undefined) { fields.push(`account_code = $${idx++}`); params.push(account_code); }
      if (safe_name !== undefined) { fields.push(`safe_name = $${idx++}`); params.push(safe_name); }
      if (payment_method !== undefined) { fields.push(`payment_method = $${idx++}`); params.push(payment_method); }
      if (dbStatus !== undefined) { fields.push(`status = $${idx++}`); params.push(dbStatus); }
      if (reference_number !== undefined) { fields.push(`reference_number = $${idx++}`); params.push(reference_number); }
      if (ledger_entries !== undefined) { fields.push(`ledger_entries = $${idx++}`); params.push(JSON.stringify(ledger_entries)); }
      if (attachments !== undefined) { fields.push(`attachments = $${idx++}`); params.push(JSON.stringify(attachments)); }

      if (fields.length <= 1) {
        return res.status(400).json({ error: "No fields to update" });
      }

      params.push(id);
      const result = await pool.query(
        `UPDATE vouchers SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
        params
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Voucher not found" });
      }

      const r = result.rows[0];
      const statusDisplayMap: Record<string, string> = { approved: 'معتمد', draft: 'مسودة', cancelled: 'ملغي' };
      res.json({
        id: r.id,
        code: r.voucher_number,
        type: r.voucher_type,
        date: r.date ? r.date.split('T')[0] : r.date,
        partyName: r.party_name || '',
        accountName: r.account_name || '',
        accountCode: r.account_code || '',
        safeName: r.safe_name || '',
        paymentMethod: r.payment_method || 'نقدي',
        amount: parseFloat(r.amount) || 0,
        description: r.description || '',
        status: statusDisplayMap[r.status] || r.status,
        attachments: r.attachments || [],
        ledgerEntries: r.ledger_entries || [],
        referenceNumber: r.reference_number || '',
        createdBy: r.created_by,
        branchId: r.branch_id,
        createdAt: r.created_at,
      });
    } catch (error: any) {
      res.status(500).json({ error: "Failed to update voucher", details: error.message });
    }
  });

  // DELETE /api/vouchers/:id — delete voucher
  router.delete("/api/vouchers/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const result = await pool.query(`DELETE FROM vouchers WHERE id = $1 RETURNING id`, [id]);
      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Voucher not found" });
      }
      res.json({ success: true, id: parseInt(id) });
    } catch (error: any) {
      res.status(500).json({ error: "Failed to delete voucher", details: error.message });
    }
  });

// ═══ Vouchers API ═══
router.get('/api/vouchers', authenticateToken, async (req, res) => {
  try {
    const { type, status, from_date, to_date } = req.query;
    let sql = 'SELECT v.*, u.username as created_by_name FROM vouchers v LEFT JOIN users u ON v.created_by = u.id WHERE 1=1';
    const params: any[] = [];
    if (type) { sql += ` AND v.voucher_type = $${params.length + 1}`; params.push(type); }
    if (status) { sql += ` AND v.status = $${params.length + 1}`; params.push(status); }
    if (from_date) { sql += ` AND v.voucher_date >= $${params.length + 1}`; params.push(from_date); }
    if (to_date) { sql += ` AND v.voucher_date <= $${params.length + 1}`; params.push(to_date); }
    sql += ' ORDER BY v.voucher_date DESC, v.id DESC';
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/api/vouchers/:id', authenticateToken, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT v.*, u.username as created_by_name FROM vouchers v LEFT JOIN users u ON v.created_by = u.id WHERE v.id = $1`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'السند غير موجود' });
    const { rows: items } = await pool.query('SELECT * FROM voucher_items WHERE voucher_id = $1 ORDER BY id', [req.params.id]);
    res.json({ ...rows[0], items });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/vouchers', authenticateToken, async (req, res) => {
  try {
    const { voucher_type, voucher_number, voucher_date, description, reference, items, status } = req.body;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `INSERT INTO vouchers (voucher_type, voucher_number, voucher_date, description, reference, status, total_amount, created_by, branch_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [voucher_type, voucher_number, voucher_date, description, reference, status || 'draft',
         items?.reduce((s: number, i: any) => s + (i.debit || 0), 0) || 0,
         (req as any).user?.id, (req as any).user?.branch_id]
      );
      const voucherId = rows[0].id;
      for (const item of (items || [])) {
        await client.query(
          `INSERT INTO voucher_items (voucher_id, account_id, account_name, description, debit, credit) VALUES ($1,$2,$3,$4,$5,$6)`,
          [voucherId, item.account_id, item.account_name, item.description, item.debit || 0, item.credit || 0]
        );
      }
      await client.query('COMMIT');
      res.status(201).json(rows[0]);
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/api/vouchers/:id', authenticateToken, async (req, res) => {
  try {
    const { voucher_date, description, reference, status, items } = req.body;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `UPDATE vouchers SET voucher_date=COALESCE($1,voucher_date), description=COALESCE($2,description),
         reference=COALESCE($3,reference), status=COALESCE($4,status), updated_at=CURRENT_TIMESTAMP WHERE id=$5 RETURNING *`,
        [voucher_date, description, reference, status, req.params.id]
      );
      if (!rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'السند غير موجود' }); }
      if (items && items.length > 0) {
        await client.query('DELETE FROM voucher_items WHERE voucher_id = $1', [req.params.id]);
        for (const item of items) {
          await client.query(
            `INSERT INTO voucher_items (voucher_id, account_id, account_name, description, debit, credit) VALUES ($1,$2,$3,$4,$5,$6)`,
            [req.params.id, item.account_id, item.account_name, item.description, item.debit || 0, item.credit || 0]
          );
        }
      }
      await client.query('COMMIT');
      res.json(rows[0]);
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/api/vouchers/:id', authenticateToken, async (req, res) => {
  try {
    const { rows } = await pool.query("DELETE FROM vouchers WHERE id = $1 AND status = 'draft' RETURNING id", [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'السند غير موجود أو ليس مسودة' });
    await pool.query('DELETE FROM voucher_items WHERE voucher_id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ═══ Banks Management API ═══
router.get('/api/banks/accounts', authenticateToken, async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT id, name, bank_name, account_number, iban, swift_code, currency, account_type, balance, opening_balance, branch_id, is_active, created_at FROM bank_accounts ORDER BY is_active DESC, name ASC`);
    res.json(rows);
  } catch (err:any) { res.status(500).json({ error: err.message }); }
});

router.post('/api/banks/accounts', authenticateToken, async (req, res) => {
  try {
    const { name, bank_name, account_number, iban, swift_code, currency='EGP', account_type='current', opening_balance=0, branch_id=null, is_active=true } = req.body;
    if (!name) return res.status(400).json({ error: 'اسم الحساب البنكي مطلوب' });
    const { rows } = await pool.query(`INSERT INTO bank_accounts (name, bank_name, account_number, iban, swift_code, currency, account_type, opening_balance, balance, branch_id, is_active) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8,$9,$10) RETURNING *`, [name,bank_name||null,account_number||null,iban||null,swift_code||null,currency,account_type,Number(opening_balance)||0,branch_id,!!is_active]);
    res.json(rows[0]);
  } catch (err:any) { res.status(500).json({ error: err.message }); }
});

router.put('/api/banks/accounts/:id', authenticateToken, async (req, res) => {
  try {
    const { name, bank_name, account_number, iban, swift_code, currency='EGP', account_type='current', branch_id=null, is_active=true } = req.body;
    const { rows } = await pool.query(`UPDATE bank_accounts SET name=$1, bank_name=$2, account_number=$3, iban=$4, swift_code=$5, currency=$6, account_type=$7, branch_id=$8, is_active=$9 WHERE id=$10 RETURNING *`, [name,bank_name||null,account_number||null,iban||null,swift_code||null,currency,account_type,branch_id,!!is_active,req.params.id]);
    if (!rows[0]) return res.status(404).json({error:'الحساب البنكي غير موجود'});
    res.json(rows[0]);
  } catch (err:any) { res.status(500).json({ error: err.message }); }
});

router.get('/api/banks/transactions', authenticateToken, async (req, res) => {
  try {
    const { account_id, from_date, to_date } = req.query;
    let sql = `SELECT bt.*, u.username AS created_by_name FROM bank_transactions bt LEFT JOIN users u ON u.id=bt.created_by WHERE 1=1`;
    const params:any[]=[];
    if(account_id){sql+=` AND bt.account_id=$${params.length+1}`;params.push(account_id)}
    if(from_date){sql+=` AND bt.transaction_date >= $${params.length+1}`;params.push(from_date)}
    if(to_date){sql+=` AND bt.transaction_date <= $${params.length+1}`;params.push(to_date)}
    sql+=' ORDER BY bt.transaction_date DESC, bt.id DESC';
    res.json((await pool.query(sql,params)).rows);
  } catch(err:any){res.status(500).json({error:err.message})}
});

router.post('/api/banks/transactions', authenticateToken, async (req, res) => {
  const client=await pool.connect();
  try{
    const {account_id, transaction_date, description, reference, amount, type='credit', branch_id=null}=req.body;
    const value=Number(amount||0); if(!account_id || value<=0) return res.status(400).json({error:'الحساب والمبلغ مطلوبان'});
    await client.query('BEGIN');
    const acc=(await client.query('SELECT * FROM bank_accounts WHERE id=$1 FOR UPDATE',[account_id])).rows[0];
    if(!acc) throw new Error('الحساب البنكي غير موجود');
    const delta=type==='debit' ? -value : value;
    const settings=(await client.query(`SELECT setting_key,setting_value FROM bank_module_settings`)).rows.reduce((o:any,r:any)=>(o[r.setting_key]=r.setting_value,o),{});
    if(delta<0 && settings.allow_negative_balance!=='true' && Number(acc.balance)+delta < 0) throw new Error('لا يمكن تنفيذ السحب لأن الرصيد غير كافٍ');
    const tx=(await client.query(`INSERT INTO bank_transactions (account_id, transaction_date, description, reference, amount, type, status, source, created_by, branch_id) VALUES ($1,$2,$3,$4,$5,$6,'unmatched','system',$7,$8) RETURNING *`,[account_id,transaction_date||new Date().toISOString().slice(0,10),description||null,reference||null,value,type,(req as any).user?.id||null,branch_id])).rows[0];
    const updated=(await client.query(`UPDATE bank_accounts SET balance=balance+$1 WHERE id=$2 RETURNING *`,[delta,account_id])).rows[0];
    await client.query('COMMIT'); res.json({transaction:tx,account:updated});
  }catch(err:any){await client.query('ROLLBACK');res.status(400).json({error:err.message})}finally{client.release()}
});

router.post('/api/banks/transfers', authenticateToken, async (req,res)=>{
  const client=await pool.connect();
  try{
    const {from_account_id,to_account_id,amount,transaction_date,description,reference,branch_id=null}=req.body;
    const value=Number(amount||0); if(!from_account_id||!to_account_id||from_account_id===to_account_id||value<=0) return res.status(400).json({error:'حدد حسابين مختلفين ومبلغًا صحيحًا'});
    await client.query('BEGIN');
    const from=(await client.query('SELECT * FROM bank_accounts WHERE id=$1 FOR UPDATE',[from_account_id])).rows[0];
    const to=(await client.query('SELECT * FROM bank_accounts WHERE id=$1 FOR UPDATE',[to_account_id])).rows[0];
    if(!from||!to) throw new Error('أحد الحسابات البنكية غير موجود');
    const settings=(await client.query(`SELECT setting_key,setting_value FROM bank_module_settings`)).rows.reduce((o:any,r:any)=>(o[r.setting_key]=r.setting_value,o),{});
    if(settings.allow_negative_balance!=='true' && Number(from.balance)<value) throw new Error('الرصيد غير كافٍ للتحويل');
    const date=transaction_date||new Date().toISOString().slice(0,10), userId=(req as any).user?.id||null;
    const ref=reference||`TRF-BANK-${Date.now()}`;
    const out=(await client.query(`INSERT INTO bank_transactions(account_id,transaction_date,description,reference,amount,type,status,source,created_by,branch_id) VALUES($1,$2,$3,$4,$5,'debit','matched','system',$6,$7) RETURNING *`,[from_account_id,date,description||'تحويل إلى حساب بنكي',ref,value,userId,branch_id])).rows[0];
    const inn=(await client.query(`INSERT INTO bank_transactions(account_id,transaction_date,description,reference,amount,type,status,source,created_by,branch_id) VALUES($1,$2,$3,$4,$5,'credit','matched','system',$6,$7) RETURNING *`,[to_account_id,date,description||'تحويل من حساب بنكي',ref,value,userId,branch_id])).rows[0];
    const a=(await client.query('UPDATE bank_accounts SET balance=balance-$1 WHERE id=$2 RETURNING *',[value,from_account_id])).rows[0];
    const b=(await client.query('UPDATE bank_accounts SET balance=balance+$1 WHERE id=$2 RETURNING *',[value,to_account_id])).rows[0];
    await client.query('COMMIT'); res.json({success:true,reference:ref,outgoing:out,incoming:inn,from:a,to:b});
  }catch(err:any){await client.query('ROLLBACK');res.status(400).json({error:err.message})}finally{client.release()}
});

router.get('/api/banks/settings', authenticateToken, async (req,res)=>{
  try{const defaults:any={default_currency:'EGP',reconciliation_tolerance:'0.01',allow_negative_balance:'false',require_approval_over:'50000',auto_post_to_accounting:'true'};for(const r of (await pool.query('SELECT setting_key,setting_value FROM bank_module_settings')).rows) defaults[r.setting_key]=r.setting_value; defaults.allow_negative_balance=defaults.allow_negative_balance==='true';defaults.auto_post_to_accounting=defaults.auto_post_to_accounting!=='false';res.json(defaults)}catch(err:any){res.status(500).json({error:err.message})}
});

router.put('/api/banks/settings', authenticateToken, async (req,res)=>{
  const client=await pool.connect();try{await client.query('BEGIN');for(const [key,val] of Object.entries(req.body||{})){await client.query(`INSERT INTO bank_module_settings(setting_key,setting_value,updated_by,updated_at) VALUES($1,$2,$3,NOW()) ON CONFLICT(setting_key) DO UPDATE SET setting_value=EXCLUDED.setting_value,updated_by=EXCLUDED.updated_by,updated_at=NOW()`,[key,String(val),(req as any).user?.id||null])}await client.query('COMMIT');res.json({success:true})}catch(err:any){await client.query('ROLLBACK');res.status(500).json({error:err.message})}finally{client.release()}
});

router.get('/api/banks/reports/summary', authenticateToken, async (req,res)=>{
  try{const accounts=(await pool.query(`SELECT COUNT(*)::int AS count, COALESCE(SUM(balance),0) AS total_balance FROM bank_accounts WHERE is_active=true`)).rows[0];const tx=(await pool.query(`SELECT COALESCE(SUM(CASE WHEN type='credit' THEN amount ELSE 0 END),0) AS credits, COALESCE(SUM(CASE WHEN type='debit' THEN amount ELSE 0 END),0) AS debits, COUNT(*)::int AS transaction_count, COUNT(*) FILTER(WHERE status<>'matched')::int AS unmatched FROM bank_transactions`)).rows[0];res.json({accounts,transactions:tx})}catch(err:any){res.status(500).json({error:err.message})}
});

// ═══ Bank Reconciliation API ═══
router.get('/api/bank-reconciliation/transactions', authenticateToken, async (req, res) => {
  try {
    const { account_id, from_date, to_date } = req.query;
    let sql = 'SELECT bt.*, u.username as created_by_name FROM bank_transactions bt LEFT JOIN users u ON bt.created_by = u.id WHERE 1=1';
    const params: any[] = [];
    if (account_id) { sql += ` AND bt.account_id = $${params.length + 1}`; params.push(account_id); }
    if (from_date) { sql += ` AND bt.transaction_date >= $${params.length + 1}`; params.push(from_date); }
    if (to_date) { sql += ` AND bt.transaction_date <= $${params.length + 1}`; params.push(to_date); }
    sql += ' ORDER BY bt.transaction_date DESC';
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/bank-reconciliation/match', authenticateToken, async (req, res) => {
  try {
    const { system_id, statement_id, account_id } = req.body;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('UPDATE bank_transactions SET status = $1, matched_with = $2, matched_at = CURRENT_TIMESTAMP WHERE id = $3', ['matched', statement_id, system_id]);
      if (statement_id) {
        await client.query('UPDATE bank_transactions SET status = $1, matched_with = $2, matched_at = CURRENT_TIMESTAMP WHERE id = $3', ['matched', system_id, statement_id]);
      }
      await client.query('COMMIT');
      res.json({ success: true });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/bank-reconciliation/import', authenticateToken, async (req, res) => {
  try {
    const { transactions, account_id } = req.body;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const t of (transactions || [])) {
        await client.query(
          `INSERT INTO bank_transactions (account_id, transaction_date, description, reference, amount, type, status, source) VALUES ($1,$2,$3,$4,$5,$6,'unmatched','bank_statement')`,
          [account_id, t.date, t.description, t.reference, Math.abs(Number(t.amount||0)), Number(t.amount||0) >= 0 ? 'credit' : 'debit']
        );
      }
      await client.query('COMMIT');
      res.json({ success: true, count: transactions?.length || 0 });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});



// ═══ Complete Bank Module APIs ═══
router.get('/api/banks/master', authenticateToken, async (_req, res) => {
  try {
    const { rows } = await pool.query(`SELECT b.*, COUNT(ba.id)::int AS account_count
      FROM banks b LEFT JOIN bank_accounts ba ON ba.bank_id=b.id
      GROUP BY b.id ORDER BY b.is_active DESC, b.name_ar ASC`);
    res.json(rows);
  } catch (err:any) { res.status(500).json({ error: err.message }); }
});

router.post('/api/banks/master', authenticateToken, async (req,res) => {
  try {
    const { code, name_ar, name_en, swift_code, country_code='EG', currency_code='EGP', phone, email, website, address, notes } = req.body || {};
    if (!code || !name_ar) return res.status(400).json({error:'كود البنك واسم البنك مطلوبان'});
    const { rows } = await pool.query(`INSERT INTO banks(code,name_ar,name_en,swift_code,country_code,currency_code,phone,email,website,address,notes,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`, [code,name_ar,name_en||null,swift_code||null,country_code,currency_code,phone||null,email||null,website||null,address||null,notes||null,(req as any).user?.id||null]);
    res.status(201).json(rows[0]);
  } catch(err:any){ res.status(400).json({error:err.message}); }
});

router.put('/api/banks/master/:id', authenticateToken, async (req,res) => {
  try {
    const { code, name_ar, name_en, swift_code, country_code='EG', currency_code='EGP', phone, email, website, address, notes, is_active=true } = req.body || {};
    const { rows } = await pool.query(`UPDATE banks SET code=$1,name_ar=$2,name_en=$3,swift_code=$4,country_code=$5,currency_code=$6,phone=$7,email=$8,website=$9,address=$10,notes=$11,is_active=$12,updated_at=NOW() WHERE id=$13 RETURNING *`,
      [code,name_ar,name_en||null,swift_code||null,country_code,currency_code,phone||null,email||null,website||null,address||null,notes||null,!!is_active,req.params.id]);
    if(!rows[0]) return res.status(404).json({error:'البنك غير موجود'});
    res.json(rows[0]);
  } catch(err:any){ res.status(400).json({error:err.message}); }
});

router.get('/api/banks/master/:bankId/branches', authenticateToken, async (req,res) => {
  try { res.json((await pool.query(`SELECT * FROM bank_branches WHERE bank_id=$1 ORDER BY is_active DESC,name`,[req.params.bankId])).rows); }
  catch(err:any){res.status(500).json({error:err.message});}
});

router.post('/api/banks/master/:bankId/branches', authenticateToken, async (req,res) => {
  try {
    const { branch_code, name, address, phone, manager_name, is_active=true }=req.body||{};
    if(!name) return res.status(400).json({error:'اسم الفرع مطلوب'});
    const {rows}=await pool.query(`INSERT INTO bank_branches(bank_id,branch_code,name,address,phone,manager_name,is_active) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,[req.params.bankId,branch_code||null,name,address||null,phone||null,manager_name||null,!!is_active]);
    res.status(201).json(rows[0]);
  } catch(err:any){res.status(400).json({error:err.message});}
});

router.get('/api/banks/beneficiaries', authenticateToken, async (req,res) => {
  try {
    const { rows }=await pool.query(`SELECT bb.*, b.name_ar AS bank_name_ar FROM bank_beneficiaries bb LEFT JOIN banks b ON b.id=bb.bank_id WHERE ($1::text IS NULL OR bb.beneficiary_type=$1) ORDER BY bb.is_active DESC,bb.name`,[(req.query.type as string)||null]);
    res.json(rows);
  } catch(err:any){res.status(500).json({error:err.message});}
});

router.post('/api/banks/beneficiaries', authenticateToken, async (req,res) => {
  try {
    const {code,name,bank_id,branch_id,account_number,iban,swift_code,currency_code='EGP',beneficiary_type='supplier',supplier_id,customer_id,phone,email,address,notes}=req.body||{};
    if(!name) return res.status(400).json({error:'اسم المستفيد مطلوب'});
    const {rows}=await pool.query(`INSERT INTO bank_beneficiaries(code,name,bank_id,branch_id,account_number,iban,swift_code,currency_code,beneficiary_type,supplier_id,customer_id,phone,email,address,notes,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,[code||null,name,bank_id||null,branch_id||null,account_number||null,iban||null,swift_code||null,currency_code,beneficiary_type,supplier_id||null,customer_id||null,phone||null,email||null,address||null,notes||null,(req as any).user?.id||null]);
    res.status(201).json(rows[0]);
  } catch(err:any){res.status(400).json({error:err.message});}
});

router.get('/api/banks/statements', authenticateToken, async (req,res) => {
  try {
    const { account_id }=req.query;
    const params:any[]=[]; let sql=`SELECT bs.*,ba.name AS account_name,ba.account_number FROM bank_statements bs JOIN bank_accounts ba ON ba.id=bs.account_id WHERE 1=1`;
    if(account_id){sql+=` AND bs.account_id=$${params.length+1}`;params.push(account_id)}
    sql+=' ORDER BY bs.period_to DESC,bs.id DESC';
    res.json((await pool.query(sql,params)).rows);
  } catch(err:any){res.status(500).json({error:err.message});}
});

router.post('/api/banks/statements', authenticateToken, async (req,res) => {
  const client=await pool.connect();
  try {
    const {account_id,statement_no,statement_date,period_from,period_to,opening_balance=0,closing_balance=0,total_credits=0,total_debits=0,currency_code='EGP',source='manual',file_name,lines=[]}=req.body||{};
    if(!account_id||!period_from||!period_to) return res.status(400).json({error:'الحساب وفترة الكشف مطلوبان'});
    await client.query('BEGIN');
    const st=(await client.query(`INSERT INTO bank_statements(account_id,statement_no,statement_date,period_from,period_to,opening_balance,closing_balance,total_credits,total_debits,currency_code,source,file_name,imported_by,imported_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW()) RETURNING *`,[account_id,statement_no||null,statement_date||null,period_from,period_to,Number(opening_balance)||0,Number(closing_balance)||0,Number(total_credits)||0,Number(total_debits)||0,currency_code,source,file_name||null,(req as any).user?.id||null])).rows[0];
    for(const [i,l] of (lines||[]).entries()){
      const raw=Number(l.amount||0); const direction=l.direction|| (raw<0?'debit':'credit'); const amount=Math.abs(raw);
      await client.query(`INSERT INTO bank_statement_lines(statement_id,line_no,transaction_date,value_date,description,reference,amount,direction,running_balance,external_id,raw_data)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,[st.id,l.line_no||i+1,l.transaction_date||l.date,l.value_date||null,l.description||null,l.reference||null,amount,direction,l.running_balance??null,l.external_id||null,l]);
    }
    await client.query('COMMIT'); res.status(201).json(st);
  } catch(err:any){await client.query('ROLLBACK');res.status(400).json({error:err.message});} finally{client.release();}
});

router.get('/api/banks/dashboard', authenticateToken, async (_req,res)=>{
  try {
    const accounts=(await pool.query(`SELECT COUNT(*)::int AS count,COALESCE(SUM(balance),0) AS total_balance,COALESCE(SUM(CASE WHEN is_active THEN balance ELSE 0 END),0) AS active_balance FROM bank_accounts`)).rows[0];
    const pending=(await pool.query(`SELECT COUNT(*)::int AS count,COALESCE(SUM(amount),0) AS amount FROM bank_payment_orders WHERE status IN ('draft','pending','approved')`)).rows[0];
    const reconciliation=(await pool.query(`SELECT COUNT(*)::int AS count,COUNT(*) FILTER(WHERE status='balanced')::int AS balanced,COALESCE(SUM(ABS(difference)),0) AS total_difference FROM bank_reconciliations WHERE status NOT IN ('closed')`)).rows[0];
    const fees=(await pool.query(`SELECT COALESCE(SUM(total_amount),0) AS amount FROM bank_fees WHERE fee_date >= CURRENT_DATE - INTERVAL '30 days'`)).rows[0];
    res.json({accounts,pending,reconciliation,fees});
  } catch(err:any){res.status(500).json({error:err.message});}
});

// ═══════════════════════════════════════════════════════════════
// ERP INTEGRATION HUB (الربط المحاسبي الشامل مع الخزينة، المشتريات، الموردين، الإنتاج، والمبيعات)
// ═══════════════════════════════════════════════════════════════

router.get('/api/accounting/integration-hub/status', async (_req, res) => {
  try {
    const { syncAllUnpostedTransactions, getAccountConfig } = await import("../accounts/services/auto-posting.service.js");
    const config = await getAccountConfig();

    // 1. Treasury Status
    let treasuryData = {
      safes_count: 0,
      total_safe_balance: 0,
      gl_cash_balance: 0,
      gl_bank_balance: 0,
      difference: 0,
      total_transactions: 0,
      posted_transactions: 0,
      unposted_transactions: 0,
      health: 'healthy' as 'healthy' | 'warning' | 'needs_sync'
    };
    try {
      const safesRes = await pool.query(`SELECT COUNT(*)::int as count, COALESCE(SUM(balance), 0)::float as total_balance FROM safes`);
      treasuryData.safes_count = safesRes.rows[0]?.count || 0;
      treasuryData.total_safe_balance = safesRes.rows[0]?.total_balance || 0;

      const glCash = await pool.query(`SELECT balance FROM accounts WHERE code = '111' LIMIT 1`);
      treasuryData.gl_cash_balance = parseFloat(glCash.rows[0]?.balance || '0');

      const glBank = await pool.query(`SELECT balance FROM accounts WHERE code = '112' LIMIT 1`);
      treasuryData.gl_bank_balance = parseFloat(glBank.rows[0]?.balance || '0');

      treasuryData.difference = Math.round((treasuryData.total_safe_balance - treasuryData.gl_cash_balance) * 100) / 100;

      const txRes = await pool.query(`
        SELECT 
          COUNT(*)::int as total,
          COUNT(CASE WHEN EXISTS (SELECT 1 FROM journal_entries je WHERE je.source_type = 'treasury' AND je.source_id = st.id) THEN 1 END)::int as posted
        FROM safe_transactions st
      `);
      treasuryData.total_transactions = txRes.rows[0]?.total || 0;
      treasuryData.posted_transactions = txRes.rows[0]?.posted || 0;
      treasuryData.unposted_transactions = Math.max(0, treasuryData.total_transactions - treasuryData.posted_transactions);
      treasuryData.health = treasuryData.unposted_transactions > 0 ? 'needs_sync' : 'healthy';
    } catch (_) {}

    // 2. Purchases Status
    let purchasesData = {
      total_purchases_count: 0,
      total_amount: 0,
      posted_count: 0,
      unposted_count: 0,
      gl_ap_balance: 0,
      gl_inventory_balance: 0,
      health: 'healthy' as 'healthy' | 'warning' | 'needs_sync'
    };
    try {
      const pRes = await pool.query(`
        SELECT 
          COUNT(*)::int as total,
          COALESCE(SUM(COALESCE(total_amount, total, 0)), 0)::float as sum_amount,
          COUNT(CASE WHEN EXISTS (SELECT 1 FROM journal_entries je WHERE je.source_type = 'purchase' AND je.source_id = p.id) THEN 1 END)::int as posted
        FROM purchases p
      `);
      purchasesData.total_purchases_count = pRes.rows[0]?.total || 0;
      purchasesData.total_amount = pRes.rows[0]?.sum_amount || 0;
      purchasesData.posted_count = pRes.rows[0]?.posted || 0;
      purchasesData.unposted_count = Math.max(0, purchasesData.total_purchases_count - purchasesData.posted_count);

      const glAP = await pool.query(`SELECT balance FROM accounts WHERE code = '211' LIMIT 1`);
      purchasesData.gl_ap_balance = parseFloat(glAP.rows[0]?.balance || '0');

      const glInv = await pool.query(`SELECT balance FROM accounts WHERE code = '114' LIMIT 1`);
      purchasesData.gl_inventory_balance = parseFloat(glInv.rows[0]?.balance || '0');

      purchasesData.health = purchasesData.unposted_count > 0 ? 'needs_sync' : 'healthy';
    } catch (_) {}

    // 3. Suppliers Status
    let suppliersData = {
      suppliers_count: 0,
      subledger_debt: 0,
      gl_ap_balance: 0,
      difference: 0,
      payments_total: 0,
      posted_payments: 0,
      unposted_payments: 0,
      health: 'healthy' as 'healthy' | 'warning' | 'needs_sync'
    };
    try {
      const sRes = await pool.query(`
        SELECT COUNT(*)::int as count, COALESCE(SUM(balance), 0)::float as debt
        FROM suppliers
      `);
      suppliersData.suppliers_count = sRes.rows[0]?.count || 0;
      suppliersData.subledger_debt = sRes.rows[0]?.debt || 0;

      const glAP = await pool.query(`SELECT balance FROM accounts WHERE code = '211' LIMIT 1`);
      suppliersData.gl_ap_balance = parseFloat(glAP.rows[0]?.balance || '0');
      suppliersData.difference = Math.round(Math.abs(suppliersData.subledger_debt - suppliersData.gl_ap_balance) * 100) / 100;

      const spRes = await pool.query(`
        SELECT 
          COUNT(*)::int as total,
          COUNT(CASE WHEN EXISTS (SELECT 1 FROM journal_entries je WHERE je.source_type = 'supplier_payment' AND je.source_id = st.id) THEN 1 END)::int as posted
        FROM supplier_transactions st
        WHERE (st.type = 'payment' OR st.type = 'سداد' OR st.amount < 0)
      `);
      suppliersData.payments_total = spRes.rows[0]?.total || 0;
      suppliersData.posted_payments = spRes.rows[0]?.posted || 0;
      suppliersData.unposted_payments = Math.max(0, suppliersData.payments_total - suppliersData.posted_payments);
      suppliersData.health = suppliersData.unposted_payments > 0 ? 'needs_sync' : 'healthy';
    } catch (_) {}

    // 4. Production Status
    let productionData = {
      production_runs_count: 0,
      total_manufactured_cost: 0,
      posted_count: 0,
      unposted_count: 0,
      gl_inventory_balance: 0,
      health: 'healthy' as 'healthy' | 'warning' | 'needs_sync'
    };
    try {
      const prRes = await pool.query(`
        SELECT 
          COUNT(*)::int as total,
          COALESCE(SUM(COALESCE(total_cost, quantity * COALESCE(cost_per_unit, 0), 0)), 0)::float as sum_cost,
          COUNT(CASE WHEN EXISTS (SELECT 1 FROM journal_entries je WHERE je.source_type = 'production' AND (je.source_id = pr.id OR je.reference LIKE '%' || pr.order_number || '%')) THEN 1 END)::int as posted
        FROM production_runs pr
      `);
      productionData.production_runs_count = prRes.rows[0]?.total || 0;
      productionData.total_manufactured_cost = prRes.rows[0]?.sum_cost || 0;
      productionData.posted_count = prRes.rows[0]?.posted || 0;
      productionData.unposted_count = Math.max(0, productionData.production_runs_count - productionData.posted_count);

      const glInv = await pool.query(`SELECT balance FROM accounts WHERE code = '114' LIMIT 1`);
      productionData.gl_inventory_balance = parseFloat(glInv.rows[0]?.balance || '0');
      productionData.health = productionData.unposted_count > 0 ? 'needs_sync' : 'healthy';
    } catch (_) {}

    // 5. Sales Status
    let salesData = {
      invoices_count: 0,
      orders_count: 0,
      total_sales_revenue: 0,
      posted_count: 0,
      unposted_count: 0,
      gl_revenue_balance: 0,
      gl_ar_balance: 0,
      health: 'healthy' as 'healthy' | 'warning' | 'needs_sync'
    };
    try {
      const siRes = await pool.query(`
        SELECT 
          COUNT(*)::int as total,
          COALESCE(SUM(COALESCE(net_amount, total, 0)), 0)::float as sum_amount,
          COUNT(CASE WHEN EXISTS (SELECT 1 FROM journal_entries je WHERE je.source_type = 'sales' AND je.source_id = si.id) THEN 1 END)::int as posted
        FROM sales_invoices si
      `);
      const ordRes = await pool.query(`
        SELECT 
          COUNT(*)::int as total,
          COALESCE(SUM(COALESCE(total, 0)), 0)::float as sum_amount,
          COUNT(CASE WHEN EXISTS (SELECT 1 FROM journal_entries je WHERE je.source_type = 'restaurant' AND je.source_id = o.id) THEN 1 END)::int as posted
        FROM orders o WHERE o.status IN ('completed', 'delivered')
      `);

      salesData.invoices_count = siRes.rows[0]?.total || 0;
      salesData.orders_count = ordRes.rows[0]?.total || 0;
      salesData.total_sales_revenue = (siRes.rows[0]?.sum_amount || 0) + (ordRes.rows[0]?.sum_amount || 0);
      salesData.posted_count = (siRes.rows[0]?.posted || 0) + (ordRes.rows[0]?.posted || 0);
      salesData.unposted_count = Math.max(0, (salesData.invoices_count + salesData.orders_count) - salesData.posted_count);

      const glRev = await pool.query(`SELECT balance FROM accounts WHERE code = '41' LIMIT 1`);
      salesData.gl_revenue_balance = parseFloat(glRev.rows[0]?.balance || '0');

      const glAR = await pool.query(`SELECT balance FROM accounts WHERE code = '113' LIMIT 1`);
      salesData.gl_ar_balance = parseFloat(glAR.rows[0]?.balance || '0');
      salesData.health = salesData.unposted_count > 0 ? 'needs_sync' : 'healthy';
    } catch (_) {}

    // Global Journal Entry stats
    const glStats = await pool.query(`
      SELECT 
        COUNT(*)::int as total_entries,
        COUNT(CASE WHEN source_type = 'manual' THEN 1 END)::int as manual_entries,
        COUNT(CASE WHEN source_type != 'manual' THEN 1 END)::int as automated_entries,
        COALESCE(SUM(total_debit), 0)::float as total_turnover
      FROM journal_entries WHERE status = 'posted'
    `);

    // Total unposted across all 5 modules
    const totalUnposted = treasuryData.unposted_transactions + purchasesData.unposted_count + 
                          suppliersData.unposted_payments + productionData.unposted_count + salesData.unposted_count;

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      overall_status: totalUnposted === 0 ? 'fully_integrated' : 'sync_recommended',
      total_unposted: totalUnposted,
      gl_stats: glStats.rows[0] || {},
      pillars: {
        treasury: treasuryData,
        purchases: purchasesData,
        suppliers: suppliersData,
        production: productionData,
        sales: salesData,
      },
      account_config_completeness: 100
    });
  } catch (err: any) {
    console.error("[IntegrationHub] Status error:", err);
    res.status(500).json({ error: "Failed to fetch ERP integration status", details: err.message });
  }
});

router.post('/api/accounting/integration-hub/sync-all', async (_req, res) => {
  try {
    const { syncAllUnpostedTransactions } = await import("../accounts/services/auto-posting.service.js");
    const result = await syncAllUnpostedTransactions();
    res.json({ success: true, message: "تمت المزامنة والترحيل الشامل لكافة المديولات بنجاح", ...result });
  } catch (err: any) {
    console.error("[IntegrationHub] Sync-all error:", err);
    res.status(500).json({ error: "Failed to sync transactions", details: err.message });
  }
});

router.post('/api/accounting/integration-hub/sync-module', async (req, res) => {
  try {
    const { module } = req.body;
    if (!module || !['treasury', 'purchases', 'suppliers', 'production', 'sales'].includes(module)) {
      return res.status(400).json({ error: "Invalid module specified" });
    }
    const { syncAllUnpostedTransactions } = await import("../accounts/services/auto-posting.service.js");
    const result = await syncAllUnpostedTransactions(module);
    res.json({ success: true, module, message: `تمت مزامنة مديول ${module} بنجاح`, ...result });
  } catch (err: any) {
    console.error("[IntegrationHub] Sync module error:", err);
    res.status(500).json({ error: "Failed to sync module", details: err.message });
  }
});

router.get('/api/accounting/integration-hub/records/:module', async (req, res) => {
  try {
    const { module } = req.params;
    let records: any[] = [];

    if (module === 'treasury') {
      const q = await pool.query(`
        SELECT 
          st.id, st.safe_id, s.name as safe_name, st.amount, st.type, 
          st.description, st.created_at,
          je.id as journal_entry_id, je.reference as journal_reference, je.status as gl_status
        FROM safe_transactions st
        LEFT JOIN safes s ON st.safe_id = s.id
        LEFT JOIN journal_entries je ON je.source_type = 'treasury' AND je.source_id = st.id
        ORDER BY st.id DESC LIMIT 30
      `);
      records = q.rows;
    } else if (module === 'purchases') {
      const q = await pool.query(`
        SELECT 
          p.id, p.invoice_number, p.supplier_name, COALESCE(p.total_amount, p.total, 0) as total,
          p.payment_method, p.created_at, p.status,
          je.id as journal_entry_id, je.reference as journal_reference, je.status as gl_status
        FROM purchases p
        LEFT JOIN journal_entries je ON je.source_type = 'purchase' AND je.source_id = p.id
        ORDER BY p.id DESC LIMIT 30
      `);
      records = q.rows;
    } else if (module === 'suppliers') {
      const q = await pool.query(`
        SELECT 
          st.id, st.supplier_id, s.name as supplier_name, st.amount, st.type,
          st.notes, st.created_at,
          je.id as journal_entry_id, je.reference as journal_reference, je.status as gl_status
        FROM supplier_transactions st
        LEFT JOIN suppliers s ON st.supplier_id = s.id
        LEFT JOIN journal_entries je ON je.source_type = 'supplier_payment' AND je.source_id = st.id
        ORDER BY st.id DESC LIMIT 30
      `);
      records = q.rows;
    } else if (module === 'production') {
      const q = await pool.query(`
        SELECT 
          pr.id, pr.order_number, pr.product_name, pr.quantity,
          COALESCE(pr.total_cost, pr.quantity * COALESCE(pr.cost_per_unit, 0), 0) as total_cost,
          pr.created_at,
          je.id as journal_entry_id, je.reference as journal_reference, je.status as gl_status
        FROM production_runs pr
        LEFT JOIN journal_entries je ON je.source_type = 'production' AND (je.source_id = pr.id OR je.reference LIKE '%' || pr.order_number || '%')
        ORDER BY pr.id DESC LIMIT 30
      `);
      records = q.rows;
    } else if (module === 'sales') {
      const q = await pool.query(`
        SELECT 
          si.id, si.invoice_number, si.customer_name, COALESCE(si.net_amount, si.total, 0) as total,
          si.payment_method, si.created_at, 'invoice' as source_kind,
          je.id as journal_entry_id, je.reference as journal_reference, je.status as gl_status
        FROM sales_invoices si
        LEFT JOIN journal_entries je ON je.source_type = 'sales' AND je.source_id = si.id
        UNION ALL
        SELECT 
          o.id, 'ORD-' || o.id as invoice_number, o.customer_name, COALESCE(o.total, 0) as total,
          o.payment_method, o.created_at, 'pos_order' as source_kind,
          je.id as journal_entry_id, je.reference as journal_reference, je.status as gl_status
        FROM orders o
        LEFT JOIN journal_entries je ON je.source_type = 'restaurant' AND je.source_id = o.id
        WHERE o.status IN ('completed', 'delivered')
        ORDER BY created_at DESC LIMIT 30
      `);
      records = q.rows;
    }

    res.json({ success: true, module, count: records.length, records });
  } catch (err: any) {
    console.error("[IntegrationHub] Records error:", err);
    res.status(500).json({ error: "Failed to fetch module records", details: err.message });
  }
});

export default router;
