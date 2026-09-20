/**
 * ERP Auto-Posting Service
 * Automatically creates journal entries from ALL sub-module transactions:
 * - Sales → Revenue + AR + Tax
 * - Purchases → COGS + Inventory + AP
 * - Payroll → Salary Expense + Cash/AP
 * - Treasury → Cash/Bank movements
 * - Restaurant Orders → Food/Delivery Revenue + Cash/Card
 * - Customer Payments → AR + Cash
 * - Costs → Expense accounts
 * - Sales Returns → Contra-revenue + Cash/AR
 * - Complaints/Refunds → Refund Expense + Cash
 * - Inventory Adjustments → COGS/Other Income + Inventory
 * - Employee Advances → Advance Asset + Cash
 * - Period-End Closing → Revenue/Expense → Income Summary → Retained Earnings
 */
import { pool } from "../../../server-db.js";
import { AccountRepository } from "../repositories/account.repository.js";
import { ERPEventBus } from "../../../server-erp-core.js";

const repo = new AccountRepository();

// ═══════════════════════════════════════
// CONFIG & HELPERS
// ═══════════════════════════════════════

interface GLAccountMapping {
  [key: string]: string | undefined;
}

// Normalize config keys: strip _account suffix, convert to snake_case
function normalizeKey(rawKey: string): string {
  return rawKey.replace(/_account$/, '');
}

// Default account code mappings for out-of-the-box ERP integration
const DEFAULT_ACCOUNT_CODES: Record<string, string> = {
  cash: '111',
  cash_main: '111',
  cash_petty: '111',
  bank: '112',
  bank_account: '112',
  accounts_receivable: '113',
  customer_receivables: '113',
  inventory_asset: '114',
  raw_materials_inventory: '114',
  finished_goods_inventory: '114',
  work_in_progress: '114',
  manufacturing_cost: '51',
  accounts_payable: '211',
  supplier_payables: '211',
  tax_payable: '213',
  vat_payable: '213',
  sales_revenue: '41',
  food_sales_cash: '41',
  food_sales_card: '41',
  delivery_revenue: '41',
  sales_discount: '41',
  sales_returns: '41',
  cost_of_goods_sold: '51',
  cost_expense: '51',
  operating_expense: '51',
  salary_expense: '52',
  payroll_expense: '52',
  employee_advances: '111',
};

function isValidAccountId(id: any): boolean {
  return id !== null && id !== undefined && id !== 'undefined' && id !== 'null' && !isNaN(Number(id)) && Number(id) > 0;
}

async function getAccountConfig(): Promise<GLAccountMapping> {
  try {
    const result = await pool.query("SELECT key, account_id FROM account_config WHERE account_id IS NOT NULL");
    const map: GLAccountMapping = {};
    for (const row of result.rows) {
      if (isValidAccountId(row.account_id)) {
        map[normalizeKey(row.key)] = String(row.account_id);
      }
    }

    // Check if critical core keys are present, otherwise auto-fill from accounts table
    const coreKeys = Object.keys(DEFAULT_ACCOUNT_CODES);
    const missingKeys = coreKeys.filter(k => !isValidAccountId(map[k]));

    if (missingKeys.length > 0) {
      try {
        const accsResult = await pool.query("SELECT id, code, name, type FROM accounts");
        const accounts = accsResult.rows || [];
        const codeMap: Record<string, string> = {};
        for (const a of accounts) {
          codeMap[String(a.code)] = String(a.id);
        }

        const updatesToPersist: { key: string; accountId: number }[] = [];

        for (const k of missingKeys) {
          const targetCode = DEFAULT_ACCOUNT_CODES[k];
          let foundId = codeMap[targetCode];

          // Secondary fallback by type / name keywords if code not exact
          if (!foundId) {
            const match = accounts.find((a: any) => {
              if (k.includes('cash') && (a.name?.includes('صندوق') || a.name?.includes('نقد'))) return true;
              if (k.includes('bank') && a.name?.includes('بنك')) return true;
              if (k.includes('receivable') && (a.name?.includes('عملاء') || a.name?.includes('مدين'))) return true;
              if (k.includes('payable') && (a.name?.includes('مورد') || a.name?.includes('دائن'))) return true;
              if (k.includes('inventory') && a.name?.includes('مخزون')) return true;
              if (k.includes('revenue') && (a.name?.includes('مبيعات') || a.type === 'revenue')) return true;
              if (k.includes('expense') && (a.name?.includes('مصروف') || a.type === 'expense')) return true;
              return false;
            });
            if (match) foundId = String(match.id);
          }

          if (foundId) {
            map[k] = foundId;
            updatesToPersist.push({ key: k, accountId: Number(foundId) });
          }
        }

        // Persist to account_config in background so subsequent queries and UI show connected
        if (updatesToPersist.length > 0) {
          (async () => {
            try {
              for (const u of updatesToPersist) {
                await pool.query(
                  `INSERT INTO account_config (key, account_id, updated_at) VALUES ($1, $2, NOW())
                   ON CONFLICT (key) DO UPDATE SET account_id = EXCLUDED.account_id, updated_at = NOW()`,
                  [u.key, u.accountId]
                );
              }
            } catch (_) {}
          })();
        }
      } catch (accErr) {
        console.warn("[AutoPosting] Account auto-fallback lookup warning:", accErr);
      }
    }

    return map;
  } catch (e) {
    console.error("[AutoPosting] Error loading account config:", e);
    return {};
  }
}

async function getOpenPeriod(date?: string): Promise<any> {
  try {
    const targetDate = date ? new Date(date) : new Date();
    const month = targetDate.getMonth() + 1;
    const year = targetDate.getFullYear();

    const result = await pool.query(
      "SELECT * FROM financial_periods WHERE month = $1 AND year = $2 AND status = 'open' LIMIT 1",
      [month, year]
    );
    return result.rows[0] || null;
  } catch (e) {
    console.error("[AutoPosting] Error getting open period:", e);
    return null;
  }
}

async function generateNextReference(sourceType: string): Promise<string> {
  const prefixMap: Record<string, string> = {
    sales: 'SL',
    purchase: 'PU',
    payroll: 'PR',
    treasury: 'TR',
    cost: 'CO',
    closing: 'CL',
    adjustment: 'AD',
    restaurant: 'RO',
    customer_payment: 'CP',
    sales_return: 'SR',
    complaint_refund: 'RF',
    inventory_adj: 'IA',
    employee_advance: 'EA',
    supplier_payment: 'SP',
    production: 'PRD',
  };
  const prefix = prefixMap[sourceType] || 'JE';
  const date = new Date();
  const dateStr = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}`;
  
  try {
    const result = await pool.query(
      "SELECT COALESCE(MAX(id), 0) + 1 as next_id FROM journal_entries WHERE source_type = $1 AND EXTRACT(YEAR FROM date) = $2",
      [sourceType, date.getFullYear()]
    );
    const nextId = result.rows[0]?.next_id || 1;
    return `${prefix}-${dateStr}-${String(nextId).padStart(5, '0')}`;
  } catch (e) {
    return `${prefix}-${dateStr}-00001`;
  }
}

async function createSafeEntry(entryData: any): Promise<any> {
  try {
    return await repo.createJournalEntry(entryData);
  } catch (e: any) {
    console.error(`[AutoPosting] Failed to create journal entry: ${e.message}`, entryData);
    return null;
  }
}

// ═══════════════════════════════════════
// 1. SALES AUTO-POSTING
// ═══════════════════════════════════════
export async function postSalesEntry(orderData: {
  id: number;
  total: number;
  discount: number;
  tax_amount: number;
  net_total: number;
  payment_method: string;
  customer_id?: number;
  customer_name?: string;
  branch_id?: number;
  items?: { product_name: string; total: number }[];
}): Promise<any> {
  const config = await getAccountConfig();
  if (!config.sales_revenue && !config.cash) return null;

  const period = await getOpenPeriod();
  const items: any[] = [];
  const totalNet = parseFloat(String(orderData.net_total || orderData.total || 0));
  const totalDiscount = parseFloat(String(orderData.discount || 0));
  const totalTax = parseFloat(String(orderData.tax_amount || 0));
  const salesRevenueAmount = Math.max(0, totalNet + totalDiscount - totalTax); // Subtotal before discount and tax

  // Debit: Cash or Accounts Receivable
  const isCreditSale = (orderData.payment_method || '').includes('آجل') || (orderData.payment_method || '').includes('اجل');
  if (config.accounts_receivable && (isCreditSale || orderData.customer_id)) {
    items.push({
      account_id: config.accounts_receivable,
      debit: totalNet,
      credit: 0,
      notes: `عملاء — فاتورة مبيعات #${orderData.id} — ${orderData.customer_name || ''}`,
      cost_center_id: orderData.branch_id || null
    });
  } else if (config.cash) {
    items.push({
      account_id: config.cash,
      debit: totalNet,
      credit: 0,
      notes: `الصندوق / البنك — فاتورة مبيعات #${orderData.id}`,
      cost_center_id: orderData.branch_id || null
    });
  }

  // Credit: Revenue
  if (config.sales_revenue) {
    items.push({
      account_id: config.sales_revenue,
      debit: 0,
      credit: salesRevenueAmount,
      notes: `إيراد مبيعات #${orderData.id}`,
      cost_center_id: orderData.branch_id || null
    });
  }

  // Debit: Sales Discount (contra-revenue)
  if (config.sales_discount && totalDiscount > 0) {
    items.push({
      account_id: config.sales_discount,
      debit: totalDiscount,
      credit: 0,
      notes: `خصم مبيعات على فاتورة #${orderData.id}`,
      cost_center_id: orderData.branch_id || null
    });
  }

  // Credit: Tax Payable
  if (config.tax_payable && totalTax > 0) {
    items.push({
      account_id: config.tax_payable,
      debit: 0,
      credit: totalTax,
      notes: `ضريبة VAT على فاتورة #${orderData.id}`,
      cost_center_id: orderData.branch_id || null
    });
  }

  if (items.length < 2) return null;

  const reference = await generateNextReference('sales');
  return createSafeEntry({
    date: new Date().toISOString().split('T')[0],
    description: `قيد مبيعات تلقائي — فاتورة #${orderData.id}`,
    reference,
    source_type: 'sales',
    source_id: orderData.id,
    status: 'posted',
    branch_id: orderData.branch_id,
    period_id: period?.id,
    created_by: null,
    items
  });
}

// ═══════════════════════════════════════
// 2. PURCHASES AUTO-POSTING
// ═══════════════════════════════════════
export async function postPurchaseEntry(purchaseData: {
  id: number;
  total: number;
  supplier_id?: number;
  supplier_name?: string;
  branch_id?: number;
  cost_center_id?: number;
  payment_method?: string;
  paid_amount?: number;
  receipt_id?: number;
  purchase_order_id?: number;
}): Promise<any> {
  const config = await getAccountConfig();
  const period = await getOpenPeriod();
  const total = parseFloat(String(purchaseData.total || 0));
  if (!total) return null;

  // Idempotency: one purchase invoice can create only one purchase journal entry.
  try {
    const existing = await pool.query(`SELECT * FROM journal_entries WHERE source_type='purchase' AND source_id=$1 ORDER BY id DESC LIMIT 1`, [purchaseData.id]);
    if (existing.rows[0]) return existing.rows[0];
  } catch (_) {}

  // If a GRN exists, its posted entry has already recognized inventory and
  // credited GRNI. The invoice therefore clears GRNI and creates AP.
  let debitAccount: any = config.inventory_asset || config.cost_of_goods_sold;
  if (purchaseData.receipt_id) {
    try {
      const gr = await pool.query(`SELECT journal_entry_id FROM goods_receipts WHERE id=$1`, [purchaseData.receipt_id]);
      const jeId = gr.rows[0]?.journal_entry_id;
      if (jeId) {
        const line = await pool.query(`SELECT account_id FROM journal_items WHERE journal_entry_id=$1 AND credit>0 ORDER BY id LIMIT 1`, [jeId]);
        if (line.rows[0]) debitAccount = String(line.rows[0].account_id);
      }
    } catch (_) {}
  }
  if (!debitAccount || !config.accounts_payable) return null;

  const items: any[] = [{
    account_id: debitAccount,
    debit: total,
    credit: 0,
    notes: purchaseData.receipt_id
      ? `تسوية GRNI لفاتورة مشتريات #${purchaseData.id}`
      : `مشتريات لفاتورة #${purchaseData.id}`,
    cost_center_id: purchaseData.cost_center_id || purchaseData.branch_id || null
  }, {
    account_id: config.accounts_payable,
    debit: 0,
    credit: total,
    notes: `موردون — فاتورة مشتريات #${purchaseData.id}`,
    cost_center_id: purchaseData.cost_center_id || purchaseData.branch_id || null
  }];

  const reference = await generateNextReference('purchase');
  return createSafeEntry({
    date: new Date().toISOString().split('T')[0],
    description: `قيد فاتورة مشتريات موحد — #${purchaseData.id}`,
    reference,
    source_type: 'purchase',
    source_id: purchaseData.id,
    status: 'posted',
    branch_id: purchaseData.branch_id,
    period_id: period?.id,
    items
  });
}

// ═══════════════════════════════════════
// 2b. SUPPLIER PAYMENT AUTO-POSTING
// ═══════════════════════════════════════
export async function postSupplierPaymentEntry(data: {
  supplier_id: number;
  supplier_name?: string;
  amount: number;
  payment_method?: string;
  branch_id?: number;
  transaction_id?: number;
}): Promise<any> {
  const config = await getAccountConfig();
  if (!config.accounts_payable) return null;

  const period = await getOpenPeriod();
  const amount = parseFloat(String(data.amount));
  if (!amount || amount <= 0) return null;
  if (data.transaction_id) {
    try {
      const existing = await pool.query(`SELECT * FROM journal_entries WHERE source_type='supplier_payment' AND source_id=$1 ORDER BY id DESC LIMIT 1`, [data.transaction_id]);
      if (existing.rows[0]) return existing.rows[0];
    } catch (_) {}
  }

  // Determine cash/bank account based on payment method
  const cashAccount = (data.payment_method === 'bank' || data.payment_method === 'transfer')
    ? (config.bank || config.cash)
    : config.cash;
  if (!cashAccount) return null;

  const items: any[] = [];

  // DR: Reduce Accounts Payable (suppliers)
  items.push({
    account_id: config.accounts_payable,
    debit: amount,
    credit: 0,
    notes: `تخفيض رصيد المورد ${data.supplier_name || '#' + data.supplier_id}`,
    cost_center_id: data.branch_id || null
  });

  // CR: Cash or Bank (money going out)
  items.push({
    account_id: cashAccount,
    debit: 0,
    credit: amount,
    notes: `صرف للمورد ${data.supplier_name || '#' + data.supplier_id}`,
    cost_center_id: data.branch_id || null
  });

  const reference = await generateNextReference('supplier_payment');
  return createSafeEntry({
    date: new Date().toISOString().split('T')[0],
    description: `سداد للمورد ${data.supplier_name || '#' + data.supplier_id} - مبلغ ${amount} ج.م`,
    reference,
    source_type: 'supplier_payment',
    source_id: data.transaction_id || data.supplier_id,
    status: 'posted',
    branch_id: data.branch_id,
    period_id: period?.id,
    items
  });
}

// ═══════════════════════════════════════
// 3. PAYROLL AUTO-POSTING
// ═══════════════════════════════════════
export async function postPayrollEntry(payrollData: {
  id: number;
  month: number;
  year: number;
  total_salaries: number;
  total_deductions: number;
  total_net: number;
  total_bonuses?: number;
  branch_id?: number;
}): Promise<any> {
  const config = await getAccountConfig();
  if (!config.payroll_expense) return null;

  const period = await getOpenPeriod();
  const items: any[] = [];
  const totalGross = parseFloat(String(payrollData.total_salaries));
  const totalDeductions = parseFloat(String(payrollData.total_deductions));
  const totalNet = parseFloat(String(payrollData.total_net));
  if (totalGross === 0) return null;

  // Debit: Salary Expense (gross)
  items.push({
    account_id: config.payroll_expense,
    debit: totalGross,
    credit: 0,
    notes: `مرتبات شهر ${payrollData.month}/${payrollData.year} — إجمالي`,
    cost_center_id: payrollData.branch_id || null
  });

  // Credit: Cash/Bank (net paid amount)
  if (config.cash && totalNet > 0) {
    items.push({
      account_id: config.cash,
      debit: 0,
      credit: totalNet,
      notes: `صافي مرتبات شهر ${payrollData.month}/${payrollData.year} — مدفوع نقداً`,
      cost_center_id: payrollData.branch_id || null
    });
  }

  // Credit: Payroll Payable (deductions = liabilities pending payment)
  if (config.accounts_payable && totalDeductions > 0) {
    items.push({
      account_id: config.accounts_payable,
      debit: 0,
      credit: totalDeductions,
      notes: `خصومات وإعانات مرتبات شهر ${payrollData.month}/${payrollData.year}`,
      cost_center_id: payrollData.branch_id || null
    });
  }

  if (items.length < 2) return null;

  const reference = await generateNextReference('payroll');
  return createSafeEntry({
    date: `${payrollData.year}-${String(payrollData.month).padStart(2, '0')}-28`,
    description: `قيد رواتب تلقائي — ${payrollData.month}/${payrollData.year}`,
    reference,
    source_type: 'payroll',
    source_id: payrollData.id,
    status: 'posted',
    branch_id: payrollData.branch_id,
    period_id: period?.id,
    items
  });
}

// ═══════════════════════════════════════
// 4. TREASURY AUTO-POSTING (FIXED)
// ═══════════════════════════════════════
export async function postTreasuryEntry(treasuryData: {
  id: number;
  amount: number;
  transaction_type: 'cash_in' | 'cash_out' | 'transfer' | 'adjustment';
  reference_type?: string;
  reference_id?: number;
  notes?: string;
  cost_center_id?: number;
  branch_id?: number;
  created_by?: number;
}): Promise<any> {
  const config = await getAccountConfig();
  if (!config.cash) return null;

  const period = await getOpenPeriod();
  const amount = Math.abs(parseFloat(String(treasuryData.amount)));
  if (amount === 0) return null;

  const items: any[] = [];
  const isInflow = treasuryData.transaction_type === 'cash_in';

  // Cash/Bank account
  items.push({
    account_id: config.cash,
    debit: isInflow ? amount : 0,
    credit: isInflow ? 0 : amount,
    notes: treasuryData.notes || `حركة خزينة #${treasuryData.id} (${treasuryData.transaction_type})`,
    cost_center_id: treasuryData.cost_center_id || treasuryData.branch_id || null
  });

  // Counter-account for cash_out: determine based on reference_type
  if (!isInflow) {
    let counterAccountId = config.accounts_payable; // Default fallback
    let counterNotes = `مصروفات متنوعة — حركة خزينة #${treasuryData.id}`;
    
    if (treasuryData.reference_type === 'payroll' && config.payroll_expense) {
      counterAccountId = config.payroll_expense;
      counterNotes = `مصروف رواتب — حركة خزينة #${treasuryData.id}`;
    } else if (treasuryData.reference_type === 'purchase' && config.inventory_asset) {
      counterAccountId = config.inventory_asset;
      counterNotes = `سداد مشتريات — حركة خزينة #${treasuryData.id}`;
    } else if (treasuryData.reference_type === 'cost') {
      // For costs, we use the cost_expense config
      counterAccountId = config.cost_expense || config.accounts_payable;
      counterNotes = `مصروفات تشغيلية — حركة خزينة #${treasuryData.id}`;
    }

    if (counterAccountId) {
      items.push({
        account_id: counterAccountId,
        debit: amount,
        credit: 0,
        notes: counterNotes,
        cost_center_id: treasuryData.cost_center_id || treasuryData.branch_id || null
      });
    }
  } else {
    // For cash_in: credit the corresponding revenue/AR account
    let counterAccountId: string | undefined;
    let counterNotes = `إيرادات متنوعة — حركة خزينة #${treasuryData.id}`;
    
    if (treasuryData.reference_type === 'sales' && config.sales_revenue) {
      counterAccountId = config.sales_revenue;
      counterNotes = `إيراد مبيعات — تحصيل خزينة #${treasuryData.id}`;
    } else if (treasuryData.reference_type === 'customer' && config.accounts_receivable) {
      counterAccountId = config.accounts_receivable;
      counterNotes = `تحصيل عملاء — حركة خزينة #${treasuryData.id}`;
    }

    if (counterAccountId) {
      items.push({
        account_id: counterAccountId,
        debit: 0,
        credit: amount,
        notes: counterNotes,
        cost_center_id: treasuryData.cost_center_id || treasuryData.branch_id || null
      });
    }
  }

  // For adjustments (revaluation), we need a balancing entry
  if (treasuryData.transaction_type === 'adjustment') {
    const otherAccount = isInflow
      ? (config.other_income || config.sales_revenue)
      : (config.other_expense || config.accounts_payable);
    if (otherAccount) {
      items.push({
        account_id: otherAccount,
        debit: isInflow ? 0 : amount,
        credit: isInflow ? amount : 0,
        notes: `تسوية خزينة #${treasuryData.id}`,
        cost_center_id: treasuryData.cost_center_id || treasuryData.branch_id || null
      });
    }
  }

  if (items.length < 2) return null;

  const reference = await generateNextReference('treasury');
  return createSafeEntry({
    date: new Date().toISOString().split('T')[0],
    description: `قيد خزينة تلقائي — #${treasuryData.id}`,
    reference,
    source_type: 'treasury',
    source_id: treasuryData.id,
    status: 'posted',
    branch_id: treasuryData.branch_id,
    period_id: period?.id,
    created_by: treasuryData.created_by,
    items
  });
}

// ═══════════════════════════════════════
// 5. RESTAURANT ORDERS AUTO-POSTING (NEW)
// ═══════════════════════════════════════
export async function postRestaurantOrderEntry(orderData: {
  id: number;
  total: number;
  delivery_fee: number;
  payment_method: string; // cash, visa, wallet, instapay
  order_type: string; // dine_in, takeaway, delivery
  branch_id?: number;
  customer_name?: string;
}): Promise<any> {
  const config = await getAccountConfig();
  if (!config.cash && !config.food_revenue) return null;

  const period = await getOpenPeriod();
  const items: any[] = [];
  const total = parseFloat(String(orderData.total || 0));
  const deliveryFee = parseFloat(String(orderData.delivery_fee || 0));
  const grandTotal = total + deliveryFee;
  if (grandTotal === 0) return null;

  // Debit: Cash/Bank based on payment method
  const cashAccountId = (orderData.payment_method === 'visa' || orderData.payment_method === 'instapay')
    ? (config.bank || config.cash)
    : config.cash;

  if (cashAccountId) {
    const methodLabel = orderData.payment_method === 'cash' ? 'نقدي' :
                        orderData.payment_method === 'visa' ? 'بطاقة' :
                        orderData.payment_method === 'wallet' ? 'محفظة' : 'إنستاباي';
    items.push({
      account_id: cashAccountId,
      debit: grandTotal,
      credit: 0,
      notes: `${methodLabel} — أمر #${orderData.id} (${orderData.order_type === 'dine_in' ? 'صالة' : orderData.order_type === 'takeaway' ? 'تيك أواي' : 'دليفري'})`,
      cost_center_id: orderData.branch_id || null
    });
  }

  // Credit: Food Revenue
  if (config.food_revenue || config.sales_revenue) {
    const revenueAccount = config.food_revenue || config.sales_revenue;
    const typeLabel = orderData.order_type === 'dine_in' ? 'مبيعات صالة' :
                      orderData.order_type === 'takeaway' ? 'مبيعات تيك أواي' : 'مبيعات دليفري';
    items.push({
      account_id: revenueAccount,
      debit: 0,
      credit: total,
      notes: `${typeLabel} — أمر #${orderData.id}`,
      cost_center_id: orderData.branch_id || null
    });
  }

  // Credit: Delivery Revenue (separate from food)
  if (deliveryFee > 0 && config.delivery_revenue) {
    items.push({
      account_id: config.delivery_revenue,
      debit: 0,
      credit: deliveryFee,
      notes: `إيراد توصيل — أمر #${orderData.id}`,
      cost_center_id: orderData.branch_id || null
    });
  } else if (deliveryFee > 0 && config.sales_revenue) {
    // Fallback: include delivery in sales revenue (already credited total+deliveryFee above won't work, need to adjust)
    // Since we credited `total` to revenue, credit delivery_fee separately
    items.push({
      account_id: config.sales_revenue,
      debit: 0,
      credit: deliveryFee,
      notes: `إيراد توصيل — أمر #${orderData.id}`,
      cost_center_id: orderData.branch_id || null
    });
  }

  if (items.length < 2) return null;

  const reference = await generateNextReference('restaurant');
  return createSafeEntry({
    date: new Date().toISOString().split('T')[0],
    description: `قيد طلب مطعم تلقائي — أمر #${orderData.id}`,
    reference,
    source_type: 'restaurant',
    source_id: orderData.id,
    status: 'posted',
    branch_id: orderData.branch_id,
    period_id: period?.id,
    items
  });
}

// ═══════════════════════════════════════
// 6. CUSTOMER PAYMENT AUTO-POSTING (NEW)
// ═══════════════════════════════════════
export async function postCustomerPaymentEntry(paymentData: {
  customer_id: number;
  customer_name: string;
  amount: number;
  type: 'payment' | 'charge';
  branch_id?: number;
  source_id?: number;
}): Promise<any> {
  const config = await getAccountConfig();
  if (!config.cash || !config.accounts_receivable) return null;

  const period = await getOpenPeriod();
  const amount = Math.abs(parseFloat(String(paymentData.amount)));
  if (amount === 0) return null;

  const items: any[] = [];

  if (paymentData.type === 'payment') {
    // Customer pays us: DR Cash, CR AR
    items.push({
      account_id: config.cash,
      debit: amount,
      credit: 0,
      notes: `تحصيل من العميل ${paymentData.customer_name}`,
      cost_center_id: paymentData.branch_id || null
    });
    items.push({
      account_id: config.accounts_receivable,
      debit: 0,
      credit: amount,
      notes: `سداد حساب العميل ${paymentData.customer_name}`,
      cost_center_id: paymentData.branch_id || null
    });
  } else {
    // Charge (sale on credit): DR AR, CR Revenue
    items.push({
      account_id: config.accounts_receivable,
      debit: amount,
      credit: 0,
      notes: `مبيعات آجلة — العميل ${paymentData.customer_name}`,
      cost_center_id: paymentData.branch_id || null
    });
    if (config.sales_revenue) {
      items.push({
        account_id: config.sales_revenue,
        debit: 0,
        credit: amount,
        notes: `إيراد مبيعات — العميل ${paymentData.customer_name} (آجل)`,
        cost_center_id: paymentData.branch_id || null
      });
    }
  }

  if (items.length < 2) return null;

  const reference = await generateNextReference('customer_payment');
  return createSafeEntry({
    date: new Date().toISOString().split('T')[0],
    description: `قيد عميل تلقائي — ${paymentData.customer_name}`,
    reference,
    source_type: 'customer_payment',
    source_id: paymentData.source_id || paymentData.customer_id,
    status: 'posted',
    branch_id: paymentData.branch_id,
    period_id: period?.id,
    items
  });
}

// ═══════════════════════════════════════
// 7. COST/EXPENSE AUTO-POSTING (ROBUST & IDEMPOTENT)
// ═══════════════════════════════════════
export async function postCostEntry(costData: {
  id: number;
  category?: string;
  amount: number;
  branch_id?: number;
  notes?: string;
  date?: string;
  cost_center_id?: number;
  payment_method?: string;
  cost_item_id?: number;
  safe?: string;
  safe_id?: number;
  bank_account_id?: number;
  supplier_id?: number;
  accounting_account?: string | number;
  created_by?: string;
}): Promise<any> {
  // 1. Idempotency Guard: If journal entry already exists for this cost, return it immediately
  if (costData.id) {
    const existing = await pool.query(
      "SELECT * FROM journal_entries WHERE source_type = 'cost' AND source_id = $1 LIMIT 1",
      [costData.id]
    );
    if (existing.rows.length > 0) {
      return existing.rows[0];
    }
  }

  const amount = Math.abs(parseFloat(String(costData.amount)));
  if (!amount || amount <= 0 || !Number.isFinite(amount)) {
    throw new Error("فشل ترحيل التكلفة: مبلغ التكلفة يجب أن يكون أكبر من صفر");
  }

  const config = await getAccountConfig();
  const period = await getOpenPeriod(costData.date);
  let categoryLabel = costData.category || 'مصروفات تشغيلية';

  // 2. Resolve Debit Account (Expense Account)
  let expenseAccountId: any = null;

  // First priority: configured account on the cost item
  if (costData.cost_item_id) {
    try {
      const ciRes = await pool.query("SELECT account_id FROM cost_items WHERE id = $1", [costData.cost_item_id]);
      if (ciRes.rows.length > 0 && ciRes.rows[0].account_id) {
        expenseAccountId = ciRes.rows[0].account_id;
      }
    } catch (_) {}
  }

  // Second priority: explicitly provided accounting_account
  if (!expenseAccountId && costData.accounting_account) {
    try {
      const accVal = String(costData.accounting_account).trim();
      const accRes = await pool.query(
        "SELECT id FROM accounts WHERE (id = $1 OR code = $2 OR name = $3) AND allow_posting = true LIMIT 1",
        [!isNaN(Number(accVal)) ? Number(accVal) : -1, accVal, accVal]
      );
      if (accRes.rows.length > 0) {
        expenseAccountId = accRes.rows[0].id;
      }
    } catch (_) {}
  }

  // Third priority: category map in account_config
  if (!expenseAccountId) {
    const categoryMap: Record<string, string> = {
      'rent': 'rent_expense',
      'utilities': 'utilities_expense',
      'maintenance': 'maintenance_expense',
      'marketing': 'marketing_expense',
      'food_cost': 'cost_of_goods_sold',
      'labor_cost': 'payroll_expense',
      'supplies': 'supplies_expense',
      'insurance': 'insurance_expense',
      'transport': 'transport_expense',
      'other': 'cost_expense',
    };
    const categoryKey = (costData.category || '').toLowerCase().trim();
    const mappedKey = categoryMap[categoryKey] || 'cost_expense';
    if (isValidAccountId(config[mappedKey])) {
      expenseAccountId = config[mappedKey];
    } else if (isValidAccountId(config.cost_expense)) {
      expenseAccountId = config.cost_expense;
    } else if (isValidAccountId(config.operating_expense)) {
      expenseAccountId = config.operating_expense;
    }
  }

  // Fourth priority: active expense account fallback from accounts table
  if (!expenseAccountId) {
    const expFallback = await pool.query(
      "SELECT id FROM accounts WHERE (code LIKE '5%' OR type = 'expense') AND allow_posting = true ORDER BY code ASC LIMIT 1"
    );
    if (expFallback.rows.length > 0) {
      expenseAccountId = expFallback.rows[0].id;
    }
  }

  if (!expenseAccountId) {
    throw new Error("فشل ترحيل التكلفة: لم يتم العثور على حساب مصروف صالح بدليل الحسابات");
  }

  // 3. Resolve Credit Account (Payment Source: Cash / Bank / Supplier AP)
  let creditAccountId: any = null;
  const method = (costData.payment_method || 'نقدي').toLowerCase().trim();

  if (method === 'نقدي' || method === 'cash' || !method) {
    if (costData.safe_id) {
      const sRes = await pool.query("SELECT account_id FROM safes WHERE id = $1", [costData.safe_id]);
      if (sRes.rows.length > 0 && isValidAccountId(sRes.rows[0].account_id)) creditAccountId = sRes.rows[0].account_id;
    } else if (costData.safe) {
      const sRes = await pool.query("SELECT account_id FROM safes WHERE name = $1 LIMIT 1", [costData.safe]);
      if (sRes.rows.length > 0 && isValidAccountId(sRes.rows[0].account_id)) creditAccountId = sRes.rows[0].account_id;
    }
    if (!isValidAccountId(creditAccountId) && isValidAccountId(config.cash)) creditAccountId = config.cash;
    if (!isValidAccountId(creditAccountId)) {
      const cashAcc = await pool.query("SELECT id FROM accounts WHERE (code = '111' OR name LIKE '%صندوق%' OR name LIKE '%نقد%') AND allow_posting = true LIMIT 1");
      if (cashAcc.rows.length > 0) creditAccountId = cashAcc.rows[0].id;
    }
  } else if (method === 'بنكي' || method === 'bank' || method === 'شيك' || method === 'تحويل' || method === 'شبكة') {
    if (costData.bank_account_id) {
      const bRes = await pool.query("SELECT account_id FROM bank_accounts WHERE id = $1", [costData.bank_account_id]);
      if (bRes.rows.length > 0 && isValidAccountId(bRes.rows[0].account_id)) creditAccountId = bRes.rows[0].account_id;
    }
    if (!isValidAccountId(creditAccountId) && isValidAccountId(config.bank)) creditAccountId = config.bank;
    if (!isValidAccountId(creditAccountId)) {
      const bankAcc = await pool.query("SELECT id FROM accounts WHERE (code = '112' OR name LIKE '%بنك%') AND allow_posting = true LIMIT 1");
      if (bankAcc.rows.length > 0) creditAccountId = bankAcc.rows[0].id;
    }
  } else if (method === 'آجل' || method === 'اجل' || method === 'credit' || method === 'مورد') {
    if (isValidAccountId(config.accounts_payable)) creditAccountId = config.accounts_payable;
    if (!isValidAccountId(creditAccountId)) {
      const apAcc = await pool.query("SELECT id FROM accounts WHERE (code = '211' OR name LIKE '%مورد%') AND allow_posting = true LIMIT 1");
      if (apAcc.rows.length > 0) creditAccountId = apAcc.rows[0].id;
    }
  }

  // Ultimate fallback to cash account if credit account is still unresolved
  if (!isValidAccountId(creditAccountId)) {
    if (isValidAccountId(config.cash)) creditAccountId = config.cash;
    if (!isValidAccountId(creditAccountId)) {
      const fallback = await pool.query("SELECT id FROM accounts WHERE (code = '111' OR type = 'asset') AND allow_posting = true ORDER BY code ASC LIMIT 1");
      if (fallback.rows.length > 0) creditAccountId = fallback.rows[0].id;
    }
  }

  if (!creditAccountId) {
    throw new Error("فشل ترحيل التكلفة: لم يتم العثور على حساب دفع (صندوق/بنك/مورد) صالح بدليل الحسابات");
  }

  const items: any[] = [
    {
      account_id: expenseAccountId,
      debit: amount,
      credit: 0,
      notes: costData.notes || `مصروف ${categoryLabel}`,
      cost_center_id: costData.cost_center_id || costData.branch_id || null
    },
    {
      account_id: creditAccountId,
      debit: 0,
      credit: amount,
      notes: `سداد مصروف ${categoryLabel}`,
      cost_center_id: costData.cost_center_id || costData.branch_id || null
    }
  ];

  const reference = await generateNextReference('cost');
  const entry = await repo.createJournalEntry({
    date: costData.date || new Date().toISOString().split('T')[0],
    description: `قيد مصروفات تلقائي — ${categoryLabel}`,
    reference,
    source_type: 'cost',
    source_id: costData.id,
    status: 'posted',
    branch_id: costData.branch_id,
    period_id: period?.id,
    created_by: costData.created_by || null,
    items
  });

  // Link journal_entry_id to operating_costs
  if (entry && entry.id && costData.id) {
    try {
      await pool.query(
        "UPDATE operating_costs SET journal_entry_id = $1 WHERE id = $2",
        [entry.id, costData.id]
      );
    } catch (e: any) {
      console.warn("[AutoPosting] Failed to update operating_costs.journal_entry_id:", e?.message);
    }
  }

  return entry;
}

// ═══════════════════════════════════════
// 8. SALES RETURN AUTO-POSTING (NEW)
// ═══════════════════════════════════════
export async function postReturnEntry(returnData: {
  id: number;
  grand_total: number;
  refund_method: string;
  customer_name: string;
  items_total: number;
  tax_total: number;
  branch_id?: number;
}): Promise<any> {
  const config = await getAccountConfig();
  if (!config.sales_revenue && !config.cash) return null;

  const period = await getOpenPeriod();
  const itemsTotal = parseFloat(String(returnData.items_total || returnData.grand_total));
  const taxTotal = parseFloat(String(returnData.tax_total || 0));
  const totalRefund = itemsTotal + taxTotal;
  if (totalRefund === 0) return null;

  const items: any[] = [];

  // Debit: Sales Returns (contra-revenue) — reverses the revenue
  if (config.sales_returns || config.sales_discount) {
    const returnsAccount = config.sales_returns || config.sales_discount;
    items.push({
      account_id: returnsAccount,
      debit: itemsTotal,
      credit: 0,
      notes: `مرتجعات مبيعات — إشعار #${returnData.id} — ${returnData.customer_name}`,
      cost_center_id: returnData.branch_id || null
    });
  }

  // Debit: Tax Payable (reverse the tax)
  if (config.tax_payable && taxTotal > 0) {
    items.push({
      account_id: config.tax_payable,
      debit: taxTotal,
      credit: 0,
      notes: `ضريبة مستردة — مرتجع #${returnData.id}`,
      cost_center_id: returnData.branch_id || null
    });
  }

  // Credit: Cash or AR (refund to customer)
  if (config.cash) {
    items.push({
      account_id: config.cash,
      debit: 0,
      credit: totalRefund,
      notes: `مردود نقدي — مرتجع #${returnData.id} — ${returnData.customer_name}`,
      cost_center_id: returnData.branch_id || null
    });
  } else if (config.accounts_receivable) {
    items.push({
      account_id: config.accounts_receivable,
      debit: 0,
      credit: totalRefund,
      notes: `تخفيض حساب عميل — مرتجع #${returnData.id}`,
      cost_center_id: returnData.branch_id || null
    });
  }

  if (items.length < 2) return null;

  const reference = await generateNextReference('sales_return');
  return createSafeEntry({
    date: new Date().toISOString().split('T')[0],
    description: `قيد مرتجع مبيعات تلقائي — إشعار #${returnData.id}`,
    reference,
    source_type: 'sales_return',
    source_id: returnData.id,
    status: 'posted',
    branch_id: returnData.branch_id,
    period_id: period?.id,
    items
  });
}

// ═══════════════════════════════════════
// 9. COMPLAINT REFUND AUTO-POSTING (NEW)
// ═══════════════════════════════════════
export async function postComplaintRefundEntry(complaintData: {
  id: number;
  customer_name: string;
  refund_amount: number;
  compensation_amount: number;
  branch_id?: number;
  resolution_text?: string;
}): Promise<any> {
  const config = await getAccountConfig();
  if (!config.cash) return null;

  const period = await getOpenPeriod();
  const refundAmount = parseFloat(String(complaintData.refund_amount || 0));
  const compensationAmount = parseFloat(String(complaintData.compensation_amount || 0));
  const totalAmount = refundAmount + compensationAmount;
  if (totalAmount === 0) return null;

  const items: any[] = [];

  // Debit: Refund/Compensation Expense
  const expenseAccount = config.refund_expense || config.cost_expense || config.accounts_payable;
  if (expenseAccount) {
    if (refundAmount > 0) {
      items.push({
        account_id: expenseAccount,
        debit: refundAmount,
        credit: 0,
        notes: `مردود شكوى #${complaintData.id} — ${complaintData.customer_name}`,
        cost_center_id: complaintData.branch_id || null
      });
    }
    if (compensationAmount > 0) {
      items.push({
        account_id: expenseAccount,
        debit: compensationAmount,
        credit: 0,
        notes: `تعويض شكوى #${complaintData.id} — ${complaintData.customer_name}`,
        cost_center_id: complaintData.branch_id || null
      });
    }
  }

  // Credit: Cash
  items.push({
    account_id: config.cash,
    debit: 0,
    credit: totalAmount,
    notes: `مردود/تعويض شكوى #${complaintData.id}`,
    cost_center_id: complaintData.branch_id || null
  });

  if (items.length < 2) return null;

  const reference = await generateNextReference('complaint_refund');
  return createSafeEntry({
    date: new Date().toISOString().split('T')[0],
    description: `قيد مردود شكوى تلقائي — شكوى #${complaintData.id}`,
    reference,
    source_type: 'complaint_refund',
    source_id: complaintData.id,
    status: 'posted',
    branch_id: complaintData.branch_id,
    period_id: period?.id,
    items
  });
}

// ═══════════════════════════════════════
// 10. INVENTORY ADJUSTMENT AUTO-POSTING (NEW)
// ═══════════════════════════════════════
export async function postInventoryAdjustmentEntry(adjData: {
  id: number;
  warehouse_id: number;
  ingredient_id: number;
  ingredient_name?: string;
  quantity: number;
  unit_cost?: number;
  type: string; // 'in' (gain), 'out' (loss/waste), 'adjustment'
  branch_id?: number;
}): Promise<any> {
  const config = await getAccountConfig();
  if (!config.inventory_asset && !config.cost_of_goods_sold) return null;

  const period = await getOpenPeriod();
  const unitCost = parseFloat(String(adjData.unit_cost || 0));
  const quantity = parseFloat(String(adjData.quantity));
  const totalValue = Math.abs(quantity * unitCost);
  if (totalValue === 0) return null; // Can't post without value

  const items: any[] = [];
  const isGain = adjData.type === 'in';

  if (isGain) {
    // Stock gain/surplus: DR Inventory, CR Other Income
    if (config.inventory_asset) {
      items.push({
        account_id: config.inventory_asset,
        debit: totalValue,
        credit: 0,
        notes: `زيادة مخزون — ${adjData.ingredient_name || `مكون #${adjData.ingredient_id}`}`,
        cost_center_id: adjData.branch_id || null
      });
    }
    const incomeAccount = config.other_income || config.sales_revenue;
    if (incomeAccount) {
      items.push({
        account_id: incomeAccount,
        debit: 0,
        credit: totalValue,
        notes: `إيراد زيادة مخزون — ${adjData.ingredient_name || `مكون #${adjData.ingredient_id}`}`,
        cost_center_id: adjData.branch_id || null
      });
    }
  } else {
    // Stock loss/waste: DR COGS/Waste, CR Inventory
    const expenseAccount = config.cost_of_goods_sold || config.cost_expense;
    if (expenseAccount) {
      items.push({
        account_id: expenseAccount,
        debit: totalValue,
        credit: 0,
        notes: `هلاك/عجز مخزون — ${adjData.ingredient_name || `مكون #${adjData.ingredient_id}`}`,
        cost_center_id: adjData.branch_id || null
      });
    }
    if (config.inventory_asset) {
      items.push({
        account_id: config.inventory_asset,
        debit: 0,
        credit: totalValue,
        notes: `تخفيض مخزون — ${adjData.ingredient_name || `مكون #${adjData.ingredient_id}`}`,
        cost_center_id: adjData.branch_id || null
      });
    }
  }

  if (items.length < 2) return null;

  const reference = await generateNextReference('inventory_adj');
  return createSafeEntry({
    date: new Date().toISOString().split('T')[0],
    description: `قيد تسوية مخزون تلقائي — ${isGain ? 'زيادة' : 'نقص'}`,
    reference,
    source_type: 'inventory_adjustment',
    source_id: adjData.id,
    status: 'posted',
    branch_id: adjData.branch_id,
    period_id: period?.id,
    items
  });
}

// ═══════════════════════════════════════
// 11. EMPLOYEE ADVANCE AUTO-POSTING (NEW)
// ═══════════════════════════════════════
export async function postEmployeeAdvanceEntry(advanceData: {
  id: number;
  employee_id: number;
  employee_name?: string;
  amount: number;
  branch_id?: number;
}): Promise<any> {
  const config = await getAccountConfig();
  if (!config.cash) return null;

  const period = await getOpenPeriod();
  const amount = Math.abs(parseFloat(String(advanceData.amount)));
  if (amount === 0) return null;

  const items: any[] = [];

  // Debit: Employee Advances (asset — owed to us)
  const advanceAccount = config.employee_advances || config.accounts_receivable;
  if (advanceAccount) {
    items.push({
      account_id: advanceAccount,
      debit: amount,
      credit: 0,
      notes: `سلفة للموظف ${advanceData.employee_name || `#${advanceData.employee_id}`}`,
      cost_center_id: advanceData.branch_id || null
    });
  }

  // Credit: Cash
  items.push({
    account_id: config.cash,
    debit: 0,
    credit: amount,
    notes: `صرف سلفة — موظف ${advanceData.employee_name || `#${advanceData.employee_id}`}`,
    cost_center_id: advanceData.branch_id || null
  });

  if (items.length < 2) return null;

  const reference = await generateNextReference('employee_advance');
  return createSafeEntry({
    date: new Date().toISOString().split('T')[0],
    description: `قيد سلفة موظف تلقائي — #${advanceData.id}`,
    reference,
    source_type: 'employee_advance',
    source_id: advanceData.id,
    status: 'posted',
    branch_id: advanceData.branch_id,
    period_id: period?.id,
    items
  });
}

// ═══════════════════════════════════════
// 12. PERIOD-END CLOSING (ENHANCED)
// ═══════════════════════════════════════
export async function closePeriod(periodId: number, userId: number): Promise<any> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Get the period
    const periodResult = await client.query(
      "SELECT * FROM financial_periods WHERE id = $1",
      [periodId]
    );
    const period = periodResult.rows[0];
    if (!period) throw new Error("الفترة المالية غير موجودة");
    if (period.status === 'closed') throw new Error("الفترة المالية مقفلة بالفعل");

    // Get Income Summary and Retained Earnings account IDs from config
    const configResult = await client.query("SELECT key, account_id FROM account_config WHERE account_id IS NOT NULL");
    const config: any = {};
    for (const row of configResult.rows) {
      config[normalizeKey(row.key)] = String(row.account_id);
    }
    const incomeSummaryId = config.income_summary_account;
    const retainedEarningsId = config.retained_earnings_account;

    if (!incomeSummaryId || !retainedEarningsId) {
      throw new Error("يرجى تكوين حسابات قائمة الدخل وحقوق الملكية في إعدادات الحسابات أولاً");
    }

    // Calculate total revenue and expenses for the period
    const revenueResult = await client.query(`
      SELECT COALESCE(SUM(ji.credit - ji.debit), 0) as total
      FROM journal_items ji
      JOIN journal_entries je ON ji.journal_entry_id = je.id
      JOIN accounts a ON ji.account_id = a.id
      WHERE a.type = 'revenue' AND je.period_id = $1 AND je.status = 'posted'
    `, [periodId]);
    const totalRevenue = parseFloat(revenueResult.rows[0].total);

    const expenseResult = await client.query(`
      SELECT COALESCE(SUM(ji.debit - ji.credit), 0) as total
      FROM journal_items ji
      JOIN journal_entries je ON ji.journal_entry_id = je.id
      JOIN accounts a ON ji.account_id = a.id
      WHERE a.type = 'expense' AND je.period_id = $1 AND je.status = 'posted'
    `, [periodId]);
    const totalExpenses = parseFloat(expenseResult.rows[0].total);

    const netIncome = totalRevenue - totalExpenses;

    // Step 1: Close Revenue accounts to Income Summary
    if (totalRevenue > 0) {
      const revRef = `CL-REV-${period.year}${String(period.month).padStart(2, '0')}`;
      await client.query(`
        INSERT INTO journal_entries (date, description, reference, source_type, status, total_debit, total_credit, period_id, created_by)
        VALUES ($1, $2, $3, 'closing', 'posted', $4, $4, $5, $6) RETURNING id
      `, [
        `${period.year}-${String(period.month).padStart(2, '0')}-28`,
        `إقفال حسابات الإيرادات — ${period.month}/${period.year}`,
        revRef, totalRevenue, periodId, userId
      ]);

      const entryResult = await client.query(
        "SELECT id FROM journal_entries WHERE reference = $1 AND period_id = $2 ORDER BY id DESC LIMIT 1",
        [revRef, periodId]
      );
      const entryId = entryResult.rows[0]?.id;
      if (entryId) {
        // Debit each revenue account to zero it
        await client.query(`
          INSERT INTO journal_items (journal_entry_id, account_id, debit, credit, notes)
          SELECT $1, ji.account_id, ji.credit - ji.debit, 0,
            'إقفال إيراد — ترحيل لقائمة الدخل'
          FROM journal_items ji
          JOIN journal_entries je ON ji.journal_entry_id = je.id
          JOIN accounts a ON ji.account_id = a.id
          WHERE a.type = 'revenue' AND je.period_id = $2 AND je.status = 'posted'
            AND NOT EXISTS (
              SELECT 1 FROM journal_items ji2
              JOIN journal_entries je2 ON ji2.journal_entry_id = je2.id
              WHERE ji2.account_id = ji.account_id AND je2.source_type = 'closing' AND je2.period_id = $2
            )
          GROUP BY ji.account_id
        `, [entryId, periodId]);

        // Credit Income Summary
        await client.query(`
          INSERT INTO journal_items (journal_entry_id, account_id, debit, credit, notes)
          VALUES ($1, $2, 0, $3, 'إقفال — مجموع الإيرادات لقائمة الدخل')
        `, [entryId, incomeSummaryId, totalRevenue]);
      }
    }

    // Step 2: Close Expense accounts to Income Summary
    if (totalExpenses > 0) {
      const expRef = `CL-EXP-${period.year}${String(period.month).padStart(2, '0')}`;
      await client.query(`
        INSERT INTO journal_entries (date, description, reference, source_type, status, total_debit, total_credit, period_id, created_by)
        VALUES ($1, $2, $3, 'closing', 'posted', $4, $4, $5, $6) RETURNING id
      `, [
        `${period.year}-${String(period.month).padStart(2, '0')}-28`,
        `إقفال حسابات المصروفات — ${period.month}/${period.year}`,
        expRef, totalExpenses, periodId, userId
      ]);

      const entryResult = await client.query(
        "SELECT id FROM journal_entries WHERE reference = $1 AND period_id = $2 ORDER BY id DESC LIMIT 1",
        [expRef, periodId]
      );
      const entryId = entryResult.rows[0]?.id;
      if (entryId) {
        // Credit each expense account to zero it
        await client.query(`
          INSERT INTO journal_items (journal_entry_id, account_id, debit, credit, notes)
          SELECT $1, ji.account_id, 0, ji.debit - ji.credit,
            'إقفال مصروف — ترحيل لقائمة الدخل'
          FROM journal_items ji
          JOIN journal_entries je ON ji.journal_entry_id = je.id
          JOIN accounts a ON ji.account_id = a.id
          WHERE a.type = 'expense' AND je.period_id = $2 AND je.status = 'posted'
            AND NOT EXISTS (
              SELECT 1 FROM journal_items ji2
              JOIN journal_entries je2 ON ji2.journal_entry_id = je2.id
              WHERE ji2.account_id = ji.account_id AND je2.source_type = 'closing' AND je2.period_id = $2
            )
          GROUP BY ji.account_id
        `, [entryId, periodId]);

        // Debit Income Summary
        await client.query(`
          INSERT INTO journal_items (journal_entry_id, account_id, debit, credit, notes)
          VALUES ($1, $2, $3, 0, 'إقفال — مجموع المصروفات لقائمة الدخل')
        `, [entryId, incomeSummaryId, totalExpenses]);
      }
    }

    // Step 3: Close Income Summary to Retained Earnings
    if (netIncome !== 0) {
      const netRef = `CL-NET-${period.year}${String(period.month).padStart(2, '0')}`;
      await client.query(`
        INSERT INTO journal_entries (date, description, reference, source_type, status, total_debit, total_credit, period_id, created_by)
        VALUES ($1, $2, $3, 'closing', 'posted', $4, $4, $5, $6) RETURNING id
      `, [
        `${period.year}-${String(period.month).padStart(2, '0')}-28`,
        `ترحيل صافي الربح/الخسارة — ${period.month}/${period.year}`,
        netRef, Math.abs(netIncome), periodId, userId
      ]);

      const entryResult = await client.query(
        "SELECT id FROM journal_entries WHERE reference = $1 AND period_id = $2 ORDER BY id DESC LIMIT 1",
        [netRef, periodId]
      );
      const entryId = entryResult.rows[0]?.id;
      if (entryId) {
        if (netIncome > 0) {
          // Profit: Debit Income Summary, Credit Retained Earnings
          await client.query(`
            INSERT INTO journal_items (journal_entry_id, account_id, debit, credit, notes) VALUES
            ($1, $2, $3, 0, 'ترحيل صافي ربح لقائمة الدخل'),
            ($1, $4, 0, $3, 'ترحيل صافي ربح لحقوق الملكية')
          `, [entryId, incomeSummaryId, netIncome, retainedEarningsId]);
        } else {
          // Loss: Debit Retained Earnings, Credit Income Summary
          await client.query(`
            INSERT INTO journal_items (journal_entry_id, account_id, debit, credit, notes) VALUES
            ($1, $2, $3, 0, 'ترحيل صافي خسارة لحقوق الملكية'),
            ($1, $4, 0, $3, 'ترحيل صافي خسارة لقائمة الدخل')
          `, [entryId, retainedEarningsId, Math.abs(netIncome), incomeSummaryId]);
        }
      }
    }

    // Close the period
    await client.query(
      "UPDATE financial_periods SET status = 'closed', closed_at = NOW(), closed_by = $1 WHERE id = $2",
      [userId, periodId]
    );

    // Log to GL audit
    await client.query(`
      INSERT INTO gl_audit_logs (table_name, record_id, action, new_values, user_id)
      VALUES ('financial_periods', $1, 'close', $2, $3)
    `, [periodId, JSON.stringify({ period: `${period.month}/${period.year}`, net_income: netIncome }), userId]);

    await client.query("COMMIT");

    ERPEventBus.getInstance().emitEvent("PeriodClosed", {
      periodId,
      month: period.month,
      year: period.year,
      netIncome,
      totalRevenue,
      totalExpenses
    });

    return {
      success: true,
      period: `${period.month}/${period.year}`,
      total_revenue: totalRevenue,
      total_expenses: totalExpenses,
      net_income: netIncome
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

// ═══════════════════════════════════════
// GL AUDIT LOGGING
// ═══════════════════════════════════════
export async function logGLAudit(
  tableName: string,
  recordId: number,
  action: string,
  userId: number,
  ipAddress?: string,
  oldValues?: any,
  newValues?: any
): Promise<void> {
  try {
    await pool.query(`
      INSERT INTO gl_audit_logs (table_name, record_id, action, old_values, new_values, user_id, ip_address)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [tableName, recordId, action, oldValues ? JSON.stringify(oldValues) : null, newValues ? JSON.stringify(newValues) : null, userId, ipAddress || null]);
  } catch (e) {
    console.error("[AutoPosting] Failed to log GL audit:", e);
  }
}

// ═══════════════════════════════════════
// BUDGET VARIANCE CALCULATOR
// ═══════════════════════════════════════
export async function recalculateBudgetActuals(fiscalYearId: number): Promise<number> {
  try {
    const result = await pool.query(`
      UPDATE budgets b
      SET actual_amount = COALESCE(sub.actual, 0),
          updated_at = NOW()
      FROM (
        SELECT bi.budget_id, SUM(ji.debit - ji.credit) as actual
        FROM budget_items bi
        JOIN journal_items ji ON ji.account_id = bi.account_id
        JOIN journal_entries je ON ji.journal_entry_id = je.id
        JOIN fiscal_years fy ON je.date BETWEEN fy.start_date AND fy.end_date
        WHERE bi.fiscal_year_id = $1 AND fy.id = $1 AND je.status = 'posted'
        GROUP BY bi.budget_id
      ) sub
      WHERE b.id = sub.budget_id
      RETURNING b.id
    `, [fiscalYearId]);

    // Fallback: simple calculation without budget_items table
    await pool.query(`
      UPDATE budgets b
      SET actual_amount = COALESCE(
        (SELECT SUM(CASE WHEN a.type IN ('expense') THEN ji.debit - ji.credit
                          WHEN a.type IN ('revenue') THEN ji.credit - ji.debit
                          ELSE 0 END)
         FROM journal_items ji
         JOIN journal_entries je ON ji.journal_entry_id = je.id
         JOIN accounts a ON ji.account_id = a.id
         WHERE ji.account_id = b.account_id
           AND je.status = 'posted'
           AND je.date >= (SELECT start_date FROM fiscal_years WHERE id = $1)
           AND je.date <= (SELECT end_date FROM fiscal_years WHERE id = $1)
      ), 0),
      updated_at = NOW()
      WHERE b.fiscal_year_id = $1
    `, [fiscalYearId]);

    return result.rows.length;
  } catch (e) {
    console.error("[AutoPosting] Budget recalculation error:", e);
    return 0;
  }
}

// ═══════════════════════════════════════
// 12. PRODUCTION & MANUFACTURING AUTO-POSTING
// ═══════════════════════════════════════
export async function postProductionEntry(data: {
  orderId?: number | string;
  orderNumber?: string;
  productName: string;
  quantity: number;
  rawWarehouseId?: number;
  finishedWarehouseId?: number;
  totalCost: number;
  costPerUnit?: number;
  deductedMaterialsCount?: number;
  executedBy?: string;
}): Promise<any> {
  const config = await getAccountConfig();
  const period = await getOpenPeriod();
  const cost = parseFloat(String(data.totalCost || 0));
  if (!cost || cost <= 0) return null;

  // Idempotency: prevent duplicate postings for the same production run/order
  const identifier = String(data.orderNumber || data.orderId || data.productName);
  try {
    const existing = await pool.query(
      `SELECT * FROM journal_entries WHERE source_type='production' AND (reference LIKE $1 OR description LIKE $1) ORDER BY id DESC LIMIT 1`,
      [`%${identifier}%`]
    );
    if (existing.rows[0]) return existing.rows[0];
  } catch (_) {}

  // Debit: Finished goods inventory (capitalization of manufactured products)
  const debitAccount = config.finished_goods_inventory || config.inventory_asset || '12';
  // Credit: Raw materials inventory (reduction of raw materials consumed)
  const creditAccount = config.raw_materials_inventory || config.inventory_asset || '12';

  const items: any[] = [
    {
      account_id: debitAccount,
      debit: cost,
      credit: 0,
      notes: `إضافة مخزون إنتاج تام — أمر تشغيل ${data.orderNumber || identifier} (${data.productName} × ${data.quantity})`,
      cost_center_id: null
    },
    {
      account_id: creditAccount,
      debit: 0,
      credit: cost,
      notes: `صرف خامات ومواد أولية للتصنيع — أمر تشغيل ${data.orderNumber || identifier} (${data.deductedMaterialsCount || 0} صنف خامات)`,
      cost_center_id: null
    }
  ];

  const reference = await generateNextReference('production');
  return createSafeEntry({
    date: new Date().toISOString().split('T')[0],
    description: `قيد تكاليف إنتاج وتصنيع تلقائي — أمر تشغيل ${data.orderNumber || identifier} (${data.productName} × ${data.quantity})`,
    reference,
    source_type: 'production',
    source_id: typeof data.orderId === 'number' ? data.orderId : 0,
    status: 'posted',
    period_id: period?.id,
    items
  });
}

// ═══════════════════════════════════════
// 13. MASTER BATCH SYNC ENGINE FOR ALL 5 PILLARS
// (Treasury, Purchases, Suppliers, Production, Sales)
// ═══════════════════════════════════════
export async function syncAllUnpostedTransactions(targetModule?: 'treasury' | 'purchases' | 'suppliers' | 'production' | 'sales'): Promise<{
  treasuryPosted: number;
  purchasesPosted: number;
  suppliersPosted: number;
  productionPosted: number;
  salesPosted: number;
  totalEntriesCreated: number;
  details: string[];
}> {
  const report = {
    treasuryPosted: 0,
    purchasesPosted: 0,
    suppliersPosted: 0,
    productionPosted: 0,
    salesPosted: 0,
    totalEntriesCreated: 0,
    details: [] as string[]
  };

  // 1. TREASURY SYNC
  if (!targetModule || targetModule === 'treasury') {
    try {
      // Find safe transactions not yet posted
      try {
        const unpostedSafes = await pool.query(`
          SELECT st.* FROM safe_transactions st
          WHERE NOT EXISTS (
            SELECT 1 FROM journal_entries je 
            WHERE je.source_type = 'treasury' AND je.source_id = st.id
          )
          ORDER BY st.id ASC LIMIT 50
        `);

        for (const tx of unpostedSafes.rows) {
          const posted = await postTreasuryEntry({
            id: tx.id,
            amount: tx.amount || 0,
            transaction_type: tx.type === 'deposit' ? 'cash_in' : (tx.type === 'withdraw' ? 'cash_out' : (tx.transaction_type || 'cash_in')),
            notes: tx.description || tx.notes,
            created_by: tx.created_by,
          });
          if (posted) {
            report.treasuryPosted++;
            report.totalEntriesCreated++;
            report.details.push(`تم ترحيل حركة خزانة #${tx.id} بقيمة ${tx.amount} ج.م`);
          }
        }
      } catch (_) {}

      // Also find treasury_transactions not yet posted
      try {
        const unpostedTreasury = await pool.query(`
          SELECT tt.* FROM treasury_transactions tt
          WHERE tt.status = 'approved' AND NOT EXISTS (
            SELECT 1 FROM journal_entries je 
            WHERE je.source_type = 'treasury' AND je.source_id = tt.id
          )
          ORDER BY tt.id ASC LIMIT 50
        `);

        for (const tt of unpostedTreasury.rows) {
          const posted = await postTreasuryEntry({
            id: tt.id,
            amount: Math.abs(tt.amount || 0),
            transaction_type: tt.transaction_type === 'disbursement' || tt.amount < 0 ? 'cash_out' : 'cash_in',
            notes: tt.notes || 'حركة خزينة مركزية',
            created_by: tt.created_by,
          });
          if (posted) {
            report.treasuryPosted++;
            report.totalEntriesCreated++;
            report.details.push(`تم ترحيل حركة خزينة عامة #${tt.id} بقيمة ${Math.abs(tt.amount)} ج.م`);
          }
        }
      } catch (_) {}
    } catch (err: any) {
      console.warn("[BatchSync] Treasury sync warning:", err.message);
    }
  }

  // 2. PURCHASES SYNC
  if (!targetModule || targetModule === 'purchases') {
    try {
      const unpostedPurchases = await pool.query(`
        SELECT p.* FROM purchases p
        WHERE NOT EXISTS (
          SELECT 1 FROM journal_entries je 
          WHERE je.source_type = 'purchase' AND je.source_id = p.id
        )
        ORDER BY p.id ASC LIMIT 50
      `);

      for (const p of unpostedPurchases.rows) {
        const posted = await postPurchaseEntry({
          id: p.id,
          total: p.total_amount || p.total || 0,
          supplier_id: p.supplier_id,
          supplier_name: p.supplier_name,
          payment_method: p.payment_method,
          paid_amount: p.paid_amount,
        });
        if (posted) {
          report.purchasesPosted++;
          report.totalEntriesCreated++;
          report.details.push(`تم ترحيل فاتورة مشتريات #${p.id} بقيمة ${p.total_amount || p.total} ج.م`);
        }
      }
    } catch (err: any) {
      console.warn("[BatchSync] Purchases sync warning:", err.message);
    }
  }

  // 3. SUPPLIER PAYMENTS SYNC
  if (!targetModule || targetModule === 'suppliers') {
    try {
      const unpostedSupplierPayments = await pool.query(`
        SELECT st.*, s.name as supplier_name FROM supplier_transactions st
        LEFT JOIN suppliers s ON st.supplier_id = s.id
        WHERE (st.type = 'payment' OR st.type = 'سداد' OR st.amount < 0)
        AND NOT EXISTS (
          SELECT 1 FROM journal_entries je 
          WHERE je.source_type = 'supplier_payment' AND je.source_id = st.id
        )
        ORDER BY st.id ASC LIMIT 50
      `);

      for (const sp of unpostedSupplierPayments.rows) {
        const posted = await postSupplierPaymentEntry({
          supplier_id: sp.supplier_id,
          supplier_name: sp.supplier_name,
          amount: Math.abs(sp.amount || 0),
          payment_method: sp.payment_method || 'cash',
          transaction_id: sp.id,
        });
        if (posted) {
          report.suppliersPosted++;
          report.totalEntriesCreated++;
          report.details.push(`تم ترحيل سداد مورد #${sp.supplier_id} بقيمة ${Math.abs(sp.amount)} ج.م`);
        }
      }
    } catch (err: any) {
      console.warn("[BatchSync] Supplier payments sync warning:", err.message);
    }
  }

  // 4. PRODUCTION SYNC
  if (!targetModule || targetModule === 'production') {
    try {
      const unpostedProduction = await pool.query(`
        SELECT pr.* FROM production_runs pr
        WHERE NOT EXISTS (
          SELECT 1 FROM journal_entries je 
          WHERE je.source_type = 'production' AND (je.source_id = pr.id OR je.reference LIKE '%' || pr.order_number || '%')
        )
        ORDER BY pr.id ASC LIMIT 50
      `);

      for (const pr of unpostedProduction.rows) {
        const cost = pr.total_cost || (pr.quantity * (pr.cost_per_unit || 0)) || 0;
        if (cost > 0) {
          const posted = await postProductionEntry({
            orderId: pr.id,
            orderNumber: pr.order_number || `PR-${pr.id}`,
            productName: pr.product_name || `منتج #${pr.product_id}`,
            quantity: pr.quantity || 1,
            totalCost: cost,
            costPerUnit: pr.cost_per_unit,
          });
          if (posted) {
            report.productionPosted++;
            report.totalEntriesCreated++;
            report.details.push(`تم ترحيل أمر تشغيل إنتاج #${pr.order_number || pr.id} بقيمة ${cost} ج.م`);
          }
        }
      }
    } catch (err: any) {
      console.warn("[BatchSync] Production sync warning:", err.message);
    }
  }

  // 5. SALES SYNC
  if (!targetModule || targetModule === 'sales') {
    try {
      // Check sales invoices
      const unpostedSalesInvoices = await pool.query(`
        SELECT si.* FROM sales_invoices si
        WHERE NOT EXISTS (
          SELECT 1 FROM journal_entries je 
          WHERE je.source_type = 'sales' AND je.source_id = si.id
        )
        ORDER BY si.id ASC LIMIT 50
      `);

      for (const si of unpostedSalesInvoices.rows) {
        const posted = await postSalesEntry({
          id: si.id,
          total: si.total_amount || si.total || 0,
          discount: si.discount_amount || 0,
          tax_amount: si.tax_amount || 0,
          net_total: si.net_amount || si.total || 0,
          payment_method: si.payment_method || 'cash',
          customer_id: si.customer_id,
          customer_name: si.customer_name,
        });
        if (posted) {
          report.salesPosted++;
          report.totalEntriesCreated++;
          report.details.push(`تم ترحيل فاتورة مبيعات #${si.id} بقيمة ${si.net_amount || si.total} ج.م`);
        }
      }

      // Also check completed restaurant POS orders
      const unpostedOrders = await pool.query(`
        SELECT o.* FROM orders o
        WHERE o.status IN ('completed', 'delivered')
        AND NOT EXISTS (
          SELECT 1 FROM journal_entries je 
          WHERE je.source_type = 'restaurant' AND je.source_id = o.id
        )
        ORDER BY o.id ASC LIMIT 50
      `);

      for (const o of unpostedOrders.rows) {
        const posted = await postRestaurantOrderEntry({
          id: o.id,
          total: o.total || 0,
          delivery_fee: o.delivery_fee || 0,
          payment_method: o.payment_method || 'cash',
          order_type: o.type || 'dine_in',
          branch_id: o.branch_id,
          customer_name: o.customer_name,
        });
        if (posted) {
          report.salesPosted++;
          report.totalEntriesCreated++;
          report.details.push(`تم ترحيل طلب مبيعات/كاشير #${o.id} بقيمة ${o.total} ج.م`);
        }
      }
    } catch (err: any) {
      console.warn("[BatchSync] Sales sync warning:", err.message);
    }
  }

  return report;
}

export { getAccountConfig, getOpenPeriod, generateNextReference };