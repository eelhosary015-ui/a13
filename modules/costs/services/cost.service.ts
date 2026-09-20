import { costRepository, OperatingCostRecord, CostQueryFilters } from '../repositories/cost.repository.js';
import { ProductCostBreakdown, LandedCostAllocationItem } from '../domain/cost.types.js';
import { ERPEventBus } from '../../../server-erp-core.js';
import { postCostEntry } from '../../accounts/services/auto-posting.service.js';
import { beginIdempotency, completeIdempotency, failIdempotency } from '../../enterprise/services/idempotency.service.js';
import { UnitConversionService } from '../../common/services/unit_conversion.service.js';
import { pool } from '../../../server-db.js';

export class CostService {
  private async ensureEnterpriseCostSchema(): Promise<void> {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS cost_allocations (
        id SERIAL PRIMARY KEY,
        operating_cost_id INTEGER NOT NULL REFERENCES operating_costs(id) ON DELETE CASCADE,
        source_cost_center_id INTEGER, target_cost_center_id INTEGER,
        production_order_id INTEGER, product_id INTEGER,
        allocation_method TEXT NOT NULL, allocation_basis NUMERIC(18,6) DEFAULT 0,
        allocation_percent NUMERIC(9,4) DEFAULT 0, allocated_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'allocated', notes TEXT, created_by TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS cost_audit_trail (
        id SERIAL PRIMARY KEY,
        operating_cost_id INTEGER NOT NULL REFERENCES operating_costs(id) ON DELETE CASCADE,
        action TEXT NOT NULL, from_status TEXT, to_status TEXT,
        details JSONB NOT NULL DEFAULT '{}'::jsonb, user_name TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
  }

  async getOperatingCostDashboard(filters: { from?: string; to?: string; branch?: string; costCenterId?: number; costItemId?: number }) {
    const where: string[] = ['1=1'];
    const params: any[] = [];
    const add = (clause: string, value: any) => { params.push(value); where.push(clause.replace('?', `$${params.length}`)); };
    if (filters.from) add('oc.date >= ?::date', filters.from);
    if (filters.to) add('oc.date < (?::date + INTERVAL \'1 day\')', filters.to);
    if (filters.branch) add('oc.branch = ?', filters.branch);
    if (filters.costCenterId) add('oc.cost_center_id = ?', filters.costCenterId);
    if (filters.costItemId) add('oc.cost_item_id = ?', filters.costItemId);
    const clause = where.join(' AND ');
    const [summary, byItem, byCenter, bySource] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS total_count,
        COALESCE(SUM(COALESCE(NULLIF(oc.total,0), oc.amount)),0) AS total_amount,
        COALESCE(SUM(COALESCE(NULLIF(oc.total,0), oc.amount)) FILTER (WHERE oc.approval_status='Approved'),0) AS approved_amount,
        COALESCE(SUM(COALESCE(NULLIF(oc.total,0), oc.amount)) FILTER (WHERE oc.approval_status IN ('Draft','Pending')),0) AS pending_amount,
        COALESCE(SUM(COALESCE(NULLIF(oc.total,0), oc.amount)) FILTER (WHERE COALESCE(oc.allocation_status,'unallocated')='allocated'),0) AS allocated_amount,
        COALESCE(SUM(COALESCE(NULLIF(oc.total,0), oc.amount)) FILTER (WHERE COALESCE(oc.allocation_status,'unallocated')<>'allocated'),0) AS unallocated_amount,
        COALESCE(SUM(COALESCE(NULLIF(oc.total,0), oc.amount)) FILTER (WHERE COALESCE(oc.direct_indirect,'indirect')='direct'),0) AS direct_amount,
        COALESCE(SUM(COALESCE(NULLIF(oc.total,0), oc.amount)) FILTER (WHERE COALESCE(oc.direct_indirect,'indirect')='indirect'),0) AS indirect_amount,
        COALESCE(SUM(COALESCE(NULLIF(oc.total,0), oc.amount)) FILTER (WHERE COALESCE(oc.cost_behavior,'variable')='fixed'),0) AS fixed_amount,
        COALESCE(SUM(COALESCE(NULLIF(oc.total,0), oc.amount)) FILTER (WHERE COALESCE(oc.cost_behavior,'variable')='variable'),0) AS variable_amount
        FROM operating_costs oc WHERE ${clause}`, params),
      pool.query(`SELECT COALESCE(ci.name,'غير مصنف') AS name, COALESCE(SUM(COALESCE(NULLIF(oc.total,0), oc.amount)),0) AS amount, COUNT(*)::int AS count
        FROM operating_costs oc LEFT JOIN cost_items ci ON ci.id=oc.cost_item_id WHERE ${clause} GROUP BY ci.name ORDER BY amount DESC LIMIT 20`, params),
      pool.query(`SELECT COALESCE(cc.name,'غير مرتبط') AS name, COALESCE(SUM(COALESCE(NULLIF(oc.total,0), oc.amount)),0) AS amount, COUNT(*)::int AS count
        FROM operating_costs oc LEFT JOIN cost_centers cc ON cc.id=oc.cost_center_id WHERE ${clause} GROUP BY cc.name ORDER BY amount DESC LIMIT 20`, params),
      pool.query(`SELECT COALESCE(oc.source,'manual') AS source, COALESCE(SUM(COALESCE(NULLIF(oc.total,0), oc.amount)),0) AS amount, COUNT(*)::int AS count
        FROM operating_costs oc WHERE ${clause} GROUP BY oc.source ORDER BY amount DESC`, params)
    ]);
    return { summary: summary.rows[0], by_item: byItem.rows, by_center: byCenter.rows, by_source: bySource.rows };
  }

  async transitionOperatingCost(id: number, toStatus: string, user: any): Promise<any> {
    await this.ensureEnterpriseCostSchema();
    const allowed: Record<string, string[]> = {
      Draft: ['Pending', 'Cancelled'], Pending: ['Approved', 'Rejected'], Approved: ['Allocated', 'Cancelled'], Allocated: ['Closed'], Closed: []
    };
    const cost = await costRepository.getOperatingCostById(id);
    if (!cost) throw new Error('سجل التكلفة غير موجود');
    const from = cost.approval_status || 'Draft';
    if (!allowed[from]?.includes(toStatus)) throw new Error(`لا يمكن نقل التكلفة من ${from} إلى ${toStatus}`);
    const actor = user?.username || user?.name || 'النظام';
    const timestampField: Record<string, string> = { Pending: 'submitted_at', Approved: 'approved_at', Allocated: 'allocated_at', Closed: 'closed_at' };
    const actorField: Record<string, string> = { Pending: 'submitted_by', Approved: 'approved_by', Allocated: 'allocated_by', Closed: 'closed_by' };
    const fields = [`approval_status='${toStatus}'`];
    if (timestampField[toStatus]) fields.push(`${timestampField[toStatus]}=CURRENT_TIMESTAMP`);
    if (actorField[toStatus]) fields.push(`${actorField[toStatus]}=$2`);
    const updated = await pool.query(`UPDATE operating_costs SET ${fields.join(', ')} WHERE id=$1 RETURNING *`, [id, actor]);
    await pool.query(`INSERT INTO cost_audit_trail (operating_cost_id, action, from_status, to_status, user_name) VALUES ($1,$2,$3,$4,$5)`, [id, 'status_change', from, toStatus, actor]);
    return updated.rows[0];
  }

  async previewCostAllocation(input: { totalCost: number; method: string; allocations: any[] }) {
    const total = Number(input.totalCost) || 0;
    const allocations = Array.isArray(input.allocations) ? input.allocations : [];
    const rows = allocations.map(row => {
      const percent = Number(row.percent ?? row.allocation_percent ?? 0);
      const amount = input.method === 'percentage' ? total * percent / 100 : Number(row.amount ?? 0);
      return { ...row, percent, amount: Number(amount.toFixed(2)) };
    });
    const allocated = rows.reduce((sum, row) => sum + row.amount, 0);
    const percentTotal = rows.reduce((sum, row) => sum + row.percent, 0);
    return { total, method: input.method, rows, percent_total: percentTotal, allocated_amount: Number(allocated.toFixed(2)), remaining_amount: Number((total - allocated).toFixed(2)), valid: input.method === 'percentage' ? Math.abs(percentTotal - 100) < 0.01 : Math.abs(allocated - total) < 0.01 };
  }

  async allocateOperatingCost(id: number, input: { method: string; allocations: any[] }, user: any): Promise<any> {
    await this.ensureEnterpriseCostSchema();
    const cost = await costRepository.getOperatingCostById(id);
    if (!cost) throw new Error('سجل التكلفة غير موجود');
    if (cost.approval_status !== 'Approved') throw new Error('يجب اعتماد التكلفة قبل تخصيصها');
    const preview = await this.previewCostAllocation({ totalCost: Number(cost.total || cost.amount), ...input });
    if (!preview.valid) throw new Error('يجب أن يساوي مجموع التخصيص 100% أو إجمالي قيمة التكلفة');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM cost_allocations WHERE operating_cost_id=$1', [id]);
      const actor = user?.username || user?.name || 'النظام';
      for (const row of preview.rows) {
        await client.query(`INSERT INTO cost_allocations (operating_cost_id, source_cost_center_id, target_cost_center_id, production_order_id, product_id, allocation_method, allocation_basis, allocation_percent, allocated_amount, notes, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [id, cost.cost_center_id || null, row.target_cost_center_id || row.cost_center_id || null, row.production_order_id || null, row.product_id || null, input.method, row.basis || 0, row.percent, row.amount, row.notes || null, actor]);
      }
      const updated = await client.query(`UPDATE operating_costs SET allocation_status='allocated', allocated_by=$2, allocated_at=CURRENT_TIMESTAMP, approval_status='Allocated' WHERE id=$1 RETURNING *`, [id, actor]);
      await client.query(`INSERT INTO cost_audit_trail (operating_cost_id, action, from_status, to_status, details, user_name) VALUES ($1,'allocation',$2,'Allocated',$3::jsonb,$4)`, [id, cost.approval_status, JSON.stringify(preview), actor]);
      await client.query('COMMIT');
      return { cost: updated.rows[0], preview };
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }

  async getCostAuditTrail(id: number): Promise<any[]> {
    await this.ensureEnterpriseCostSchema();
    const result = await pool.query('SELECT * FROM cost_audit_trail WHERE operating_cost_id=$1 ORDER BY created_at DESC, id DESC', [id]);
    return result.rows;
  }
  // ────────────────── INVENTORY COSTING (MOVING WEIGHTED AVERAGE) ──────────────────

  /**
   * Authoritative Moving Weighted Average formula for inventory costing across ERP:
   * New Average Cost = (Old Quantity * Old Average Cost + Incoming Quantity * Incoming Unit Cost) / (Old Quantity + Incoming Quantity)
   */
  calculateMovingWeightedAverage(
    oldQty: number,
    oldAvgCost: number,
    incomingQty: number,
    incomingUnitCost: number
  ): number {
    const safeOldQty = Math.max(0, Number(oldQty) || 0);
    const safeOldCost = Math.max(0, Number(oldAvgCost) || 0);
    const safeIncomingQty = Math.max(0, Number(incomingQty) || 0);
    const safeIncomingCost = Math.max(0, Number(incomingUnitCost) || 0);

    const totalQty = safeOldQty + safeIncomingQty;
    if (totalQty <= 0) {
      return safeIncomingCost > 0 ? safeIncomingCost : safeOldCost;
    }

    const totalValuation = (safeOldQty * safeOldCost) + (safeIncomingQty * safeIncomingCost);
    return Number((totalValuation / totalQty).toFixed(4));
  }

  // ────────────────── OPERATING COSTS VALIDATION & LOGIC ──────────────────

  validateCostPayload(data: Partial<OperatingCostRecord>): void {
    const amount = Number(data.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error('مبلغ التكلفة يجب أن يكون رقماً موجباً أكبر من صفر');
    }
  }

  /**
   * Create an operating cost record with database transaction, idempotency,
   * safe cash deduction, authoritative ledger auto-posting, and event emission.
   */
  async createOperatingCost(
    data: OperatingCostRecord,
    user: any,
    idempotencyKey?: string | null
  ): Promise<{ cost: OperatingCostRecord; journal_entry?: any; replayed?: boolean }> {
    this.validateCostPayload(data);

    const scope = 'operating_cost_create';
    const key = idempotencyKey || (data.voucher_no ? `voucher-${data.voucher_no}` : null);
    const userId = user?.id || null;

    let guard: any = { replay: false, key: null };
    if (key) {
      guard = await beginIdempotency(scope, key, data, userId);
      if (guard.replay) {
        return { ...guard.body, replayed: true };
      }
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Generate sequential voucher_no if not present
      if (!data.voucher_no) {
        const countRes = await client.query('SELECT COUNT(*) as cnt FROM operating_costs');
        const count = parseInt(countRes.rows[0]?.cnt || '0', 10) + 1;
        data.voucher_no = `VCH-${new Date().toISOString().slice(0, 7).replace('-', '')}-${String(count).padStart(4, '0')}`;
      }

      data.created_by = user?.username || user?.name || data.created_by || 'النظام';
      data.total = data.total ? Number(data.total) : Number(data.amount);

      // 2. Insert into operating_costs table within transaction
      const insertedCost = await costRepository.insertOperatingCost(data, client);

      // 3. Treasury contract: register safe transaction if payment is cash and safe exists
      if (
        (data.payment_method === 'نقدي' || data.payment_method === 'cash') &&
        data.safe &&
        insertedCost.id
      ) {
        try {
          const safeRecord = await costRepository.getSafeByName(data.safe);
          if (safeRecord?.id) {
            const existingTx = await costRepository.findSafeTransactionForCost(safeRecord.id, insertedCost.id);
            if (!existingTx) {
              await costRepository.insertSafeTransaction({
                safe_id: safeRecord.id,
                type: 'expense',
                amount: insertedCost.amount,
                notes: `سداد تكلفة #${insertedCost.id} — ${insertedCost.voucher_no} (${insertedCost.category})`,
                reference_id: String(insertedCost.id),
                created_by: data.created_by
              }, client);
            }
          }
        } catch (safeErr: any) {
          console.warn('[CostService] Safe transaction registration notice:', safeErr?.message);
        }
      }

      // 4. Log activity
      await costRepository.logActivity(
        'إضافة مصروف تشغيلي',
        `تم إضافة مصروف بقيمة ${insertedCost.amount} (${insertedCost.category}) - سند ${insertedCost.voucher_no}`,
        data.created_by,
        client
      );

      await client.query('COMMIT');

      // 5. Accounting contract: if link_ledger is requested, call authoritative auto-posting
      let journalEntry: any = null;
      if (data.link_ledger === true && insertedCost.id) {
        try {
          journalEntry = await postCostEntry({
            id: insertedCost.id,
            category: insertedCost.category,
            amount: insertedCost.amount,
            branch_id: insertedCost.branch_id,
            notes: insertedCost.notes || insertedCost.voucher_no,
            date: insertedCost.date,
            cost_center_id: insertedCost.cost_center_id,
            payment_method: insertedCost.payment_method,
            cost_item_id: insertedCost.cost_item_id,
            safe: insertedCost.safe,
            accounting_account: insertedCost.accounting_account,
            created_by: data.created_by
          });

          if (journalEntry?.id) {
            insertedCost.journal_entry_id = journalEntry.id;
            await costRepository.updateJournalEntryId(insertedCost.id, journalEntry.id);
          }
        } catch (postErr: any) {
          console.error('[CostService] Authoritative ledger auto-posting error:', postErr?.message || postErr);
        }
      }

      // 6. Emit ERP event for decoupled listeners
      try {
        ERPEventBus.getInstance().emitEvent('CostRecorded', {
          id: insertedCost.id,
          costId: insertedCost.id,
          category: insertedCost.category,
          amount: insertedCost.amount,
          date: insertedCost.date,
          branch_id: insertedCost.branch_id,
          cost_center_id: insertedCost.cost_center_id,
          cost_item_id: insertedCost.cost_item_id,
          notes: insertedCost.notes,
          link_ledger: insertedCost.link_ledger
        });
      } catch (evtErr: any) {
        console.warn('[CostService] ERPEventBus emitEvent notice:', evtErr?.message);
      }

      const responsePayload = {
        cost: insertedCost,
        journal_entry: journalEntry
      };

      if (guard.key) {
        await completeIdempotency(scope, guard.key, 201, responsePayload);
      }

      return responsePayload;
    } catch (err: any) {
      await client.query('ROLLBACK').catch(() => {});
      if (guard.key) {
        await failIdempotency(scope, guard.key);
      }
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Update an operating cost record
   */
  async updateOperatingCost(id: number, data: Partial<OperatingCostRecord>, user: any): Promise<OperatingCostRecord> {
    const existing = await costRepository.getOperatingCostById(id);
    if (!existing) {
      throw new Error('سجل التكلفة غير موجود');
    }

    if (data.amount !== undefined) {
      this.validateCostPayload({ amount: data.amount });
    }

    const updated = await costRepository.updateOperatingCost(id, data);
    if (!updated) {
      throw new Error('فشل تحديث سجل التكلفة');
    }

    // If link_ledger is set to true on update and entry not yet posted, post to ledger
    if (updated.link_ledger && !updated.journal_entry_id && Number(updated.amount) > 0) {
      try {
        const je = await postCostEntry({
          id: updated.id!,
          category: updated.category,
          amount: Number(updated.amount),
          branch_id: updated.branch_id,
          notes: updated.notes || updated.voucher_no,
          date: updated.date,
          cost_center_id: updated.cost_center_id,
          payment_method: updated.payment_method,
          cost_item_id: updated.cost_item_id,
          safe: updated.safe,
          accounting_account: updated.accounting_account,
          created_by: user?.username || 'المحاسب'
        });
        if (je?.id) {
          updated.journal_entry_id = je.id;
          await costRepository.updateJournalEntryId(updated.id!, je.id);
        }
      } catch (postErr: any) {
        console.error('[CostService] Authoritative postCostEntry on update error:', postErr?.message || postErr);
      }
    }

    await costRepository.logActivity(
      'تعديل تكلفة',
      `تم تعديل السند ${updated.voucher_no} - الحالة: ${updated.approval_status || 'Draft'}`,
      user?.username || 'النظام'
    );

    return updated;
  }

  /**
   * Delete an operating cost record with validation against linked ledger entries
   */
  async deleteOperatingCost(id: number, user: any): Promise<void> {
    const existing = await costRepository.getOperatingCostById(id);
    if (!existing) {
      throw new Error('سجل التكلفة غير موجود');
    }

    if (existing.journal_entry_id) {
      const je = await costRepository.getJournalEntryForCost(id);
      if (je) {
        throw new Error('لا يمكن حذف مصروف مرحل محاسبياً إلى القيود اليومية. يرجى إلغاء القيد أولاً');
      }
    }

    const deleted = await costRepository.deleteOperatingCost(id);
    if (!deleted) {
      throw new Error('فشل حذف سجل التكلفة');
    }

    await costRepository.logActivity(
      'حذف تكلفة',
      `تم حذف المصروف #${id} - سند ${existing.voucher_no}`,
      user?.username || 'النظام'
    );
  }

  /**
   * Authoritatively post an existing cost to accounting ledger
   */
  async postCostToLedger(costId: number, user: any): Promise<any> {
    const cost = await costRepository.getOperatingCostById(costId);
    if (!cost) {
      throw new Error('سجل التكلفة غير موجود');
    }

    // 1. Idempotency check: verify if already posted
    if (cost.journal_entry_id) {
      const existingEntry = await pool.query('SELECT * FROM journal_entries WHERE id = $1', [cost.journal_entry_id]);
      if (existingEntry.rows.length > 0) {
        return {
          message: 'تم ترحيل هذا المصروف مسبقاً',
          journal_entry: existingEntry.rows[0],
          already_posted: true
        };
      }
    }

    const existingBySource = await costRepository.getJournalEntryForCost(costId);
    if (existingBySource) {
      await costRepository.updateJournalEntryId(costId, existingBySource.id);
      return {
        message: 'تم ترحيل هذا المصروف مسبقاً',
        journal_entry: existingBySource,
        already_posted: true
      };
    }

    // 2. Post via authoritative auto-posting service
    const journalEntry = await postCostEntry({
      id: cost.id!,
      category: cost.category,
      amount: cost.amount,
      branch_id: cost.branch_id,
      notes: cost.notes || cost.voucher_no,
      date: cost.date,
      cost_center_id: cost.cost_center_id,
      payment_method: cost.payment_method,
      cost_item_id: cost.cost_item_id,
      safe: cost.safe,
      accounting_account: cost.accounting_account,
      created_by: user?.username || 'النظام'
    });

    if (!journalEntry || !journalEntry.id) {
      throw new Error('فشل إنشاء القيد المحاسبي للتكلفة');
    }

    // 3. Mark link_ledger and journal_entry_id
    await costRepository.updateJournalEntryId(costId, journalEntry.id);

    // 4. Log activity
    await costRepository.logActivity(
      'ترحيل مصروف محاسبياً',
      `تم ترحيل المصروف #${costId} إلى القيد اليومي #${journalEntry.id} برقم مرجعي ${journalEntry.reference}`,
      user?.username || 'النظام'
    );

    return {
      message: 'تم ترحيل المصروف بنجاح إلى القيود اليومية',
      journal_entry: journalEntry,
      already_posted: false
    };
  }

  /**
   * Approve an operating cost record (with idempotency guard against double-approval)
   */
  async approveOperatingCost(costId: number, user: any): Promise<OperatingCostRecord> {
    const cost = await costRepository.getOperatingCostById(costId);
    if (!cost) {
      throw new Error('سجل التكلفة غير موجود');
    }

    if (cost.approval_status === 'Approved') {
      return cost; // Idempotent: already approved
    }

    const updated = await costRepository.updateOperatingCost(costId, {
      approval_status: 'Approved'
    });

    if (!updated) {
      throw new Error('فشل اعتماد التكلفة');
    }

    // If link_ledger is enabled and not yet posted, post on approval
    if (updated.link_ledger && !updated.journal_entry_id) {
      await this.postCostToLedger(costId, user).catch((err) => {
        console.warn('[CostService] Auto-post on approval notice:', err?.message);
      });
    }

    await costRepository.logActivity(
      'اعتماد تكلفة',
      `تم اعتماد المصروف #${costId} - سند ${updated.voucher_no}`,
      user?.username || 'النظام'
    );

    return updated;
  }

  /**
   * Cancel an operating cost record (with idempotency guard against duplicate reversal)
   */
  async cancelOperatingCost(costId: number, user: any, reason?: string): Promise<OperatingCostRecord> {
    const cost = await costRepository.getOperatingCostById(costId);
    if (!cost) {
      throw new Error('سجل التكلفة غير موجود');
    }

    if (cost.approval_status === 'Cancelled') {
      return cost; // Idempotent: already cancelled
    }

    const updated = await costRepository.updateOperatingCost(costId, {
      approval_status: 'Cancelled',
      notes: reason ? `${cost.notes || ''} [ملغي: ${reason}]` : `${cost.notes || ''} [ملغي]`
    });

    if (!updated) {
      throw new Error('فشل إلغاء التكلفة');
    }

    await costRepository.logActivity(
      'إلغاء تكلفة',
      `تم إلغاء المصروف #${costId} - سند ${updated.voucher_no}. السبب: ${reason || 'غير محدد'}`,
      user?.username || 'النظام'
    );

    return updated;
  }

  async getOperatingCosts(filters: CostQueryFilters = {}): Promise<OperatingCostRecord[]> {
    return costRepository.findAll(filters);
  }

  async getOperatingCostById(id: number): Promise<OperatingCostRecord | null> {
    return costRepository.getOperatingCostById(id);
  }

  async clearAllData(user: any): Promise<void> {
    await costRepository.clearAllOperatingCosts();
    await costRepository.logActivity('تفريغ بيانات التكاليف', 'تم مسح سجلات التكاليف والقيود والحركات المرتبطة', user?.username || 'النظام');
  }

  // ────────────────── COST CENTERS & ITEMS DOMAIN ──────────────────

  async getCostCenters(): Promise<any[]> {
    return costRepository.findCostCenters();
  }

  async createCostCenter(data: any, user: any): Promise<any> {
    if (!data.name || !data.name.trim()) {
      throw new Error('اسم مركز التكلفة مطلوب');
    }
    if (data.parent_id) {
      const parent = await costRepository.getCostCenterById(Number(data.parent_id));
      if (!parent) {
        throw new Error('مركز التكلفة الأب المحدد غير موجود');
      }
    }
    const result = await costRepository.insertCostCenter(data);
    await costRepository.logActivity('إضافة مركز تكلفة', `تم إضافة مركز التكلفة: ${result.name}`, user?.username || 'النظام');
    return result;
  }

  async updateCostCenter(id: number, data: any, user: any): Promise<any> {
    const existing = await costRepository.getCostCenterById(id);
    if (!existing) {
      throw new Error('مركز التكلفة غير موجود');
    }
    if (data.parent_id) {
      const parentId = Number(data.parent_id);
      if (parentId === Number(id)) {
        throw new Error('لا يمكن أن يكون مركز التكلفة أباً لنفسه');
      }
      const parent = await costRepository.getCostCenterById(parentId);
      if (!parent) {
        throw new Error('مركز التكلفة الأب المحدد غير موجود');
      }
    }
    const result = await costRepository.updateCostCenter(id, data);
    await costRepository.logActivity('تعديل مركز تكلفة', `تم تعديل مركز التكلفة: ${result.name}`, user?.username || 'النظام');
    return result;
  }

  async deleteCostCenter(id: number, user: any): Promise<void> {
    const count = await costRepository.countOperatingCostsByCenterId(id);
    if (count > 0) {
      throw new Error(`لا يمكن حذف مركز التكلفة لوجود ${count} مصروف مرتبط به`);
    }
    const deleted = await costRepository.deleteCostCenter(id);
    if (!deleted) {
      throw new Error('فشل حذف مركز التكلفة');
    }
    await costRepository.logActivity('حذف مركز تكلفة', `تم حذف مركز التكلفة رقم #${id}`, user?.username || 'النظام');
  }

  async getCostItems(): Promise<any[]> {
    return costRepository.findCostItems();
  }

  async createCostItem(data: any, user: any): Promise<any> {
    if (!data.name || !data.name.trim()) {
      throw new Error('اسم بند التكلفة مطلوب');
    }
    if (data.parent_id) {
      const parent = await costRepository.getCostItemById(Number(data.parent_id));
      if (!parent) {
        throw new Error('البند الأب المحدد غير موجود');
      }
    }
    const result = await costRepository.insertCostItem(data);
    await costRepository.logActivity('إضافة بند تكلفة', `تم إضافة بند التكلفة: ${result.name}`, user?.username || 'النظام');
    return result;
  }

  async updateCostItem(id: number, data: any, user: any): Promise<any> {
    const existing = await costRepository.getCostItemById(id);
    if (!existing) {
      throw new Error('بند التكلفة غير موجود');
    }
    if (data.parent_id) {
      const parentId = Number(data.parent_id);
      if (parentId === Number(id)) {
        throw new Error('لا يمكن أن يكون البند أباً لنفسه');
      }
      const parent = await costRepository.getCostItemById(parentId);
      if (!parent) {
        throw new Error('البند الأب المحدد غير موجود');
      }
    }
    const result = await costRepository.updateCostItem(id, data);
    await costRepository.logActivity('تعديل بند تكلفة', `تم تعديل بند التكلفة: ${result.name}`, user?.username || 'النظام');
    return result;
  }

  async deleteCostItem(id: number, user: any): Promise<void> {
    const count = await costRepository.countOperatingCostsByItemId(id);
    if (count > 0) {
      throw new Error(`لا يمكن حذف بند التكلفة لوجود ${count} مصروف مرتبط به`);
    }
    const deleted = await costRepository.deleteCostItem(id);
    if (!deleted) {
      throw new Error('فشل حذف بند التكلفة');
    }
    await costRepository.logActivity('حذف بند تكلفة', `تم حذف بند التكلفة رقم #${id}`, user?.username || 'النظام');
  }

  // ────────────────── ESTIMATED BUDGETS ──────────────────

  async getBudgets(): Promise<any[]> {
    return costRepository.findBudgets();
  }

  async createBudget(data: any, user: any): Promise<any> {
    if (!data.name || !data.planned_amount) {
      throw new Error('بيانات الموازنة التقديرية غير مكتملة');
    }
    const result = await costRepository.insertBudget(data);
    await costRepository.logActivity('إضافة موازنة تقديرية', `تم إضافة موازنة: ${result.name} بقيمة ${result.planned_amount}`, user?.username || 'النظام');
    return result;
  }

  async deleteBudget(id: number, user: any): Promise<void> {
    const deleted = await costRepository.deleteBudget(id);
    if (!deleted) {
      throw new Error('فشل حذف الموازنة التقديرية');
    }
    await costRepository.logActivity('حذف موازنة تقديرية', `تم حذف الموازنة رقم #${id}`, user?.username || 'النظام');
  }

  // ────────────────── STANDARD & PRODUCT COSTS ──────────────────

  async getStandardCosts(): Promise<any[]> {
    return costRepository.getStandardCosts();
  }

  async saveStandardCost(data: any, user: any): Promise<any> {
    const result = await costRepository.insertStandardCost(data);
    await costRepository.logActivity('تحديث التكاليف المعيارية', 'تم تحديث معدلات التكلفة المعيارية', user?.username || 'النظام');
    return result;
  }

  async getProductCosts(): Promise<any[]> {
    return costRepository.getProductCosts();
  }

  async saveProductCost(data: any, user: any): Promise<any> {
    const result = await costRepository.insertProductCost(data);
    await costRepository.logActivity('تسجيل تكلفة منتج', `تم تسجيل تكاليف المنتج #${data.product_id}`, user?.username || 'النظام');
    return result;
  }

  // ────────────────── SETTINGS DOMAIN ──────────────────

  async getSettings(): Promise<Record<string, any>> {
    const result = await pool.query(`SELECT key, value FROM system_settings WHERE key LIKE 'cost_%'`);
    const settings: any = {};
    result.rows.forEach((row: any) => {
      settings[row.key] = row.value;
    });
    return settings;
  }

  async saveSettings(settings: Record<string, any>): Promise<void> {
    for (const key in settings) {
      if (Object.prototype.hasOwnProperty.call(settings, key)) {
        await pool.query(`
          INSERT INTO system_settings (key, value) 
          VALUES ($1, $2)
          ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = CURRENT_TIMESTAMP
        `, [key, String(settings[key])]);
      }
    }
  }

  // ────────────────── PRODUCT & RECIPE COSTING FOUNDATION ──────────────────

  async getRecipeProducts(search?: string, warehouseId?: string): Promise<any[]> {
    return costRepository.getRecipeProducts(search, warehouseId);
  }

  async getAllIngredientsWithCost(warehouseId?: number): Promise<any[]> {
    return costRepository.getAllIngredientsWithCost(warehouseId);
  }

  async updateRecipeIngredients(productId: string, ingredients: any[], yieldPortions?: number, user?: any): Promise<void> {
    if (yieldPortions && Number(yieldPortions) > 0) {
      await pool.query(`UPDATE products SET yield_portions = $1 WHERE id = $2 OR CAST(id AS TEXT) = $2 OR name = $2`, [Number(yieldPortions), String(productId)]);
    }
    await costRepository.updateRecipeIngredients(productId, ingredients);
    await costRepository.logActivity('تحديث مكونات الوصفة', `تم تحديث مكونات وصفة المنتج #${productId}`, user?.username || 'النظام');
  }

  /**
   * Central recipe cost calculation engine with Production BOM, Warehouse, Unit Conversion, and Purchase WAC integration
   */
  async calculateRecipeCost(
    productId: string,
    costSourceParam: string = "weighted_avg",
    warehouseId: string = "all",
    visited: string[] = []
  ): Promise<any> {
    const currentId = String(productId);
    if (visited.includes(currentId)) {
      return null; // Prevent circular dependency
    }
    const newVisited = [...visited, currentId];

    const prodRes = await pool.query(`
      SELECT id, name, category, item_code, barcode, sku, price as selling_price, cost_price, unit, yield_portions, show_in_pos, is_active
      FROM products
      WHERE id::text = $1 OR item_code = $1 OR barcode = $1 OR sku = $1 OR name = $1
      LIMIT 1
    `, [String(productId)]);

    let product: any = null;
    let linkedProduct: any = null;

    if (prodRes.rows.length > 0) {
      product = prodRes.rows[0];
      linkedProduct = {
        id: product.id,
        name: product.name,
        category: product.category,
        item_code: product.item_code,
        selling_price: product.selling_price
      };
    } else {
      const bomDirect = await pool.query(`SELECT * FROM production_boms WHERE id::text = $1 OR COALESCE(name, product_name) = $1 LIMIT 1`, [String(productId)]);
      if (bomDirect.rows.length > 0) {
        const b = bomDirect.rows[0];
        product = {
          id: b.id,
          name: b.name || b.product_name || `BOM-${b.id}`,
          category: 'وصفة تصنيع إنتاج',
          item_code: b.bom_code || b.id,
          barcode: '',
          sku: '',
          selling_price: b.total_cost || 0,
          cost_price: b.total_cost || 0,
          unit: 'وحدة',
          yield_portions: 1,
          show_in_pos: false,
          is_active: true
        };

        if (b.product_id || b.product_name) {
          const linkedRes = await pool.query(
            `SELECT id, name, category, item_code, price as selling_price FROM products WHERE CAST(id AS TEXT) = $1 OR name = $2 LIMIT 1`,
            [String(b.product_id || ''), String(b.product_name || b.name || '')]
          );
          if (linkedRes.rows.length > 0) {
            linkedProduct = linkedRes.rows[0];
          }
        }
      } else {
        const cleanId = String(productId).replace(/^ING-/, '');
        const ingDirect = await pool.query(
          `SELECT * FROM ingredients WHERE id::text = $1 OR code = $1 OR item_code = $1 OR name = $2 OR ('ING-' || id::text) = $2 OR barcode = $1 LIMIT 1`,
          [cleanId, String(productId)]
        );
        if (ingDirect.rows.length > 0) {
          const i = ingDirect.rows[0];
          product = {
            id: `ING-${i.id}`,
            name: i.name,
            category: i.category || i.item_group || 'خامات ومكونات',
            item_code: i.code || i.item_code || `ITEM-${i.id}`,
            barcode: i.barcode || '',
            sku: '',
            selling_price: i.cost || i.cost_price || i.avg_cost || 0,
            cost_price: i.cost || i.cost_price || i.avg_cost || 0,
            unit: i.unit || 'كجم',
            yield_portions: 1,
            show_in_pos: false,
            is_active: true
          };
        }
      }
    }

    if (!product) {
      throw new Error('المنتج أو الصنف غير موجود في سجل المنتجات');
    }

    let selectedWarehouse: any = null;
    if (warehouseId && warehouseId !== "all" && warehouseId !== "undefined") {
      const whRes = await pool.query(`SELECT id, name, code FROM warehouses WHERE CAST(id AS TEXT) = $1`, [String(warehouseId)]);
      if (whRes.rows.length > 0) {
        selectedWarehouse = whRes.rows[0];
      }
    }

    // 1. Check if a Production BOM exists in production_boms
    const bomRes = await pool.query(`
      SELECT * FROM production_boms 
      WHERE CAST(product_id AS TEXT) = $1 OR COALESCE(name, product_name) = $2 
      ORDER BY id DESC LIMIT 1
    `, [String(product.id), product.name]);

    let productionBom: any = null;
    let rawItemsList: any[] = [];
    let bomScrap = 0;
    let bomLaborFromRoutings = 0;

    if (bomRes.rows.length > 0) {
      productionBom = bomRes.rows[0];
      bomScrap = parseFloat(productionBom.scrap_percentage) || 0;
      
      if (productionBom.items_json) {
        try {
          const parsed = typeof productionBom.items_json === 'string' ? JSON.parse(productionBom.items_json) : productionBom.items_json;
          if (Array.isArray(parsed) && parsed.length > 0) rawItemsList = parsed;
        } catch (_) {}
      }

      if (rawItemsList.length === 0) {
        const biRes = await pool.query(`
          SELECT bi.*, i.name as ingredient_name, i.unit as base_unit, i.cost_price, i.avg_cost, i.last_purchase_price
          FROM bom_items bi
          LEFT JOIN ingredients i ON bi.ingredient_id = i.id
          WHERE bi.bom_id::text = $1::text
          ORDER BY bi.sort_order, bi.id
        `, [String(productionBom.id)]);
        if (biRes.rows.length > 0) {
          rawItemsList = biRes.rows.map((r: any) => ({
            materialId: r.ingredient_id,
            ingredientId: r.ingredient_id,
            name: r.ingredient_name,
            quantity: Number(r.quantity) || 0,
            unit: r.unit || r.base_unit || 'كجم',
            waste_percent: bomScrap
          }));
        }
      }

      if (productionBom.routings_json) {
        try {
          const routings = typeof productionBom.routings_json === 'string' ? JSON.parse(productionBom.routings_json) : productionBom.routings_json;
          if (Array.isArray(routings)) {
            for (const r of routings) {
              const run = Number(r.runTime) || 0;
              const setup = Number(r.setupTime) || 0;
              const rate = Number(r.costPerHour) || 25;
              const extCost = Number(r.subcontractCost) || 0;
              bomLaborFromRoutings += ((run + setup) / 60) * rate + extCost;
            }
          }
        } catch (_) {}
      }
    }

    // 2. If no Production BOM items found, check recipes & recipe_ingredients (Kitchen/Restaurant module)
    if (rawItemsList.length === 0) {
      const recRes = await pool.query(`
        SELECT r.id, r.name, r.total_yield, ri.ingredient_id, ri.quantity, ri.unit, ri.waste_percent, i.name as ingredient_name
        FROM recipes r
        JOIN recipe_ingredients ri ON r.id = ri.recipe_id
        LEFT JOIN ingredients i ON ri.ingredient_id = i.id
        WHERE r.product_id::text = $1 OR r.name = $2
      `, [String(product.id), product.name]);
      if (recRes.rows.length > 0) {
        rawItemsList = recRes.rows.map((r: any) => ({
          ingredientId: r.ingredient_id,
          materialId: r.ingredient_id,
          name: r.ingredient_name,
          quantity: Number(r.quantity) || 0,
          unit: r.unit || 'كجم',
          waste_percent: Number(r.waste_percent) || 0
        }));
      }
    }

    // 3. If still no items, check product_ingredients table
    if (rawItemsList.length === 0) {
      const piRes = await pool.query(`
        SELECT pi.ingredient_id, pi.quantity, pi.unit, pi.waste_percent, i.name as ingredient_name
        FROM product_ingredients pi
        LEFT JOIN ingredients i ON pi.ingredient_id = i.id
        WHERE pi.product_id::text = $1
      `, [String(product.id)]);
      if (piRes.rows.length > 0) {
        rawItemsList = piRes.rows.map((r: any) => ({
          ingredientId: r.ingredient_id,
          materialId: r.ingredient_id,
          name: r.ingredient_name,
          quantity: Number(r.quantity) || 0,
          unit: r.unit || 'كجم',
          waste_percent: Number(r.waste_percent) || 0
        }));
      }
    }

    const convertDirect = (qty: number, fromUnit: string, toUnit: string): number => {
      if (!qty || !fromUnit || !toUnit) return Number(qty) || 0;
      const res = UnitConversionService.convertStandardDirect(Number(qty) || 0, fromUnit, toUnit);
      if (res.success) {
        return res.toQuantity;
      }
      return Number(qty) || 0;
    };

    let totalIngredientsCost = 0;
    let totalWasteCost = 0;
    let hasMissingCost = false;
    let hasInsufficientStock = false;

    const ingredients: any[] = [];

    for (const item of rawItemsList) {
      const explicitIngredientId = item.ingredientId ?? item.ingredient_id;
      const materialReference = item.materialId ?? item.material_id ?? item.materialCode ?? '';
      const itemCodeReference = String(item.code ?? item.ingredientCode ?? item.item_code ?? materialReference ?? '').trim();
      const itemNameReference = String(item.materialName ?? item.ingredientName ?? item.name ?? '').trim();
      const ingId = explicitIngredientId ?? (parseInt(String(materialReference || '').replace(/[^0-9]/g, '')) || null);
      let ingRow: any = null;

      if (ingId) {
        const r = await pool.query(`SELECT * FROM ingredients WHERE id = $1`, [ingId]);
        if (r.rows.length > 0) ingRow = r.rows[0];
      }
      if (!ingRow && (itemNameReference || itemCodeReference)) {
        const r = await pool.query(`
          SELECT * FROM ingredients
          WHERE ($1 <> '' AND (name = $1 OR code = $1 OR item_code = $1))
             OR ($2 <> '' AND (name = $2 OR code = $2 OR item_code = $2))
          LIMIT 1
        `, [itemCodeReference, itemNameReference]);
        if (r.rows.length > 0) ingRow = r.rows[0];
      }

      const ingName = ingRow?.name || itemNameReference || 'اسم الصنف غير متوفر';
      const itemCode = ingRow?.item_code || ingRow?.code || itemCodeReference || `ITEM-${ingId || '000'}`;
      if (!ingRow && ingName === 'اسم الصنف غير متوفر') {
        console.warn(`[CostService] Missing ingredient relationship for recipe component: code=${itemCode}, id=${ingId ?? 'none'}`);
      }
      const costUnit = ingRow?.unit || item.unit || 'كجم';
      const recipeUnit = item.unit || ingRow?.unit || 'كجم';

      let invRow: any = null;
      if (ingRow) {
        if (selectedWarehouse) {
          const invRes = await pool.query(`
            SELECT * FROM inventory_items 
            WHERE (ingredient_id = $1 OR item_id = $1) AND (warehouse_id = $2 OR warehouse_id::text = $2)
            LIMIT 1
          `, [ingRow.id, selectedWarehouse.id]);
          if (invRes.rows.length > 0) invRow = invRes.rows[0];
        } else {
          const invRes = await pool.query(`
            SELECT 
              AVG(COALESCE(avg_cost, cost)) as avg_cost, 
              MAX(COALESCE(last_cost, 0)) as last_cost, 
              SUM(COALESCE(quantity, available, 0)) as total_stock 
            FROM inventory_items 
            WHERE ingredient_id = $1 OR item_id = $1
          `, [ingRow.id]);
          if (invRes.rows.length > 0 && invRes.rows[0].avg_cost !== null) invRow = invRes.rows[0];
        }
      }

      const wac = Number(invRow?.avg_cost ?? ingRow?.avg_cost ?? ingRow?.cost_price ?? 0);
      const lastPrice = Number(invRow?.last_cost ?? ingRow?.last_purchase_price ?? ingRow?.cost_price ?? 0);
      const stdPrice = Number(ingRow?.cost ?? ingRow?.cost_price ?? 0);

      const whPrefix = selectedWarehouse ? `[${selectedWarehouse.name}] ` : "";

      let unitCost = 0;
      let costSourceLabel = "غير متاح";

      if (costSourceParam === "last_purchase") {
        if (lastPrice > 0) { unitCost = lastPrice; costSourceLabel = `${whPrefix}آخر سعر شراء`; }
        else if (wac > 0) { unitCost = wac; costSourceLabel = `${whPrefix}متوسط الشراء (بديل)`; }
        else if (stdPrice > 0) { unitCost = stdPrice; costSourceLabel = `${whPrefix}تكلفة قياسية (بديل)`; }
      } else if (costSourceParam === "standard") {
        if (stdPrice > 0) { unitCost = stdPrice; costSourceLabel = `${whPrefix}تكلفة قياسية`; }
        else if (wac > 0) { unitCost = wac; costSourceLabel = `${whPrefix}متوسط الشراء (بديل)`; }
        else if (lastPrice > 0) { unitCost = lastPrice; costSourceLabel = `${whPrefix}آخر سعر شراء (بديل)`; }
      } else {
        if (wac > 0) { unitCost = wac; costSourceLabel = `${whPrefix}متوسط سعر الشراء (WAC)`; }
        else if (lastPrice > 0) { unitCost = lastPrice; costSourceLabel = `${whPrefix}آخر سعر شراء`; }
        else if (stdPrice > 0) { unitCost = stdPrice; costSourceLabel = `${whPrefix}تكلفة قياسية`; }
      }

      if (unitCost <= 0) {
        hasMissingCost = true;
        costSourceLabel = "غير متاح - حدد سعراً";
      }

      // ────────────────── RECURSIVE SUB-ASSEMBLY CHECK ──────────────────
      let isSubAssembly = false;
      let subAssemblyDetails = null;
      let subAssemblyCostPerUnit = 0;

      // Check if this ingredient has its own BOM (multi-level BOM)
      const subBomRes = await pool.query(`
        SELECT id FROM production_boms 
        WHERE CAST(product_id AS TEXT) = $1 OR COALESCE(name, product_name) = $2
        ORDER BY id DESC LIMIT 1
      `, [String(ingRow?.id || ''), ingName]);

      if (subBomRes.rows.length > 0) {
        try {
          const subCost = await this.calculateRecipeCost(ingRow?.id ? `ING-${ingRow.id}` : item.name, costSourceParam, warehouseId, newVisited);
          if (subCost && subCost.summary && subCost.summary.cost_per_portion > 0) {
            isSubAssembly = true;
            subAssemblyDetails = subCost;
            subAssemblyCostPerUnit = subCost.summary.cost_per_portion;
            unitCost = subAssemblyCostPerUnit;
            costSourceLabel = "إنتاج داخلي (Sub-Assembly)";
            hasMissingCost = false; // Resolved via recursive calculation
          }
        } catch (subErr) {
          console.warn(`[CostService] Recursive calculation failed for ${ingName}:`, subErr);
        }
      }
      // ─────────────────────────────────────────────────────────────

      const rawQty = Number(item.quantity) || 0;
      const wastePct = Number(item.waste_percent ?? item.wastePercent ?? bomScrap ?? 0);
      const wasteQty = rawQty * (wastePct / 100);
      const effectiveQty = rawQty + wasteQty;

      const convertedEffectiveQty = convertDirect(effectiveQty, recipeUnit, costUnit);
      const convertedRawQty = convertDirect(rawQty, recipeUnit, costUnit);
      const convertedWasteQty = convertDirect(wasteQty, recipeUnit, costUnit);

      const rawCost = convertedRawQty * unitCost;
      const wasteCost = convertedWasteQty * unitCost;
      const totalIngredientCost = convertedEffectiveQty * unitCost;

      const availableStock = Number(invRow?.total_stock ?? invRow?.quantity ?? ingRow?.current_stock ?? 0);
      const stockSufficient = availableStock >= convertedEffectiveQty;
      if (!stockSufficient) {
        hasInsufficientStock = true;
      }

      totalIngredientsCost += totalIngredientCost;
      totalWasteCost += wasteCost;

      ingredients.push({
        ingredient_id: ingRow?.id || ingId,
        item_id: ingRow?.id || ingId,
        item_name: ingName,
        ingredient_name: ingName,
        item_code: itemCode,
        ingredient_category: ingRow?.item_group || ingRow?.category || "خامات ومكونات",
        recipe_quantity: rawQty,
        recipe_unit: recipeUnit,
        waste_percent: wastePct,
        waste_quantity: wasteQty,
        effective_quantity: effectiveQty,
        converted_effective_quantity: convertedEffectiveQty,
        converted_raw_quantity: convertedRawQty,
        converted_waste_quantity: convertedWasteQty,
        cost_unit: costUnit,
        unit_cost: unitCost,
        cost_source_label: costSourceLabel,
        raw_cost: rawCost,
        waste_cost: wasteCost,
        total_ingredient_cost: totalIngredientCost,
        has_cost: unitCost > 0,
        available_stock: availableStock,
        stock_sufficient: stockSufficient,
        is_sub_assembly: isSubAssembly,
        sub_assembly_details: subAssemblyDetails
      });
    }

    const existingCostRes = await pool.query(
      `SELECT * FROM product_costs WHERE CAST(product_id AS TEXT) = $1 ORDER BY id DESC LIMIT 1`,
      [String(product.id)]
    );
    const existingCost = existingCostRes.rows[0] || {};

    // Allocated operating costs are manufacturing overhead only when they are
    // explicitly linked to this product. This keeps generic cost-center pools
    // unassigned until an allocation decision is made and never changes stock.
    let allocatedManufacturingOverhead = 0;
    let allocationDetails: any[] = [];
    try {
      const allocationRes = await pool.query(`
        SELECT ca.id, ca.operating_cost_id, ca.production_order_id, ca.product_id,
               ca.target_cost_center_id, ca.allocation_method, ca.allocation_percent,
               ca.allocated_amount, oc.voucher_no, oc.source, oc.cost_item_id,
               ci.name AS cost_item_name, cc.name AS cost_center_name
        FROM cost_allocations ca
        JOIN operating_costs oc ON oc.id = ca.operating_cost_id
        LEFT JOIN cost_items ci ON ci.id = oc.cost_item_id
        LEFT JOIN cost_centers cc ON cc.id = ca.target_cost_center_id
        WHERE ca.product_id::text = $1
          AND ca.status = 'allocated'
          AND oc.approval_status IN ('Allocated', 'Approved', 'Closed')
        ORDER BY ca.id
      `, [String(product.id)]);
      allocationDetails = allocationRes.rows;
      allocatedManufacturingOverhead = allocationDetails.reduce((sum, row) => sum + Number(row.allocated_amount || 0), 0);
    } catch (allocationError: any) {
      console.warn('[CostService] Product allocation lookup skipped:', allocationError?.message || allocationError);
    }

    const packagingCost = Number(existingCost.packaging) || 0;
    const laborCost = (Number(existingCost.direct_labor) || 0) + bomLaborFromRoutings;
    const baseOverheadCost = (Number(existingCost.electricity) || 0) + (Number(existingCost.maintenance) || 0) + (Number(existingCost.indirect_overhead) || 0);
    const overheadCost = baseOverheadCost + allocatedManufacturingOverhead;

    const grandTotalCost = totalIngredientsCost + packagingCost + laborCost + overheadCost;

    const yieldPortions = Math.max(1, Number(product.yield_portions) || 1);
    const costPerPortion = grandTotalCost / yieldPortions;

    const sellingPrice = Number(product.selling_price) || 0;
    const grossProfit = sellingPrice - costPerPortion;
    const profitMarginPct = sellingPrice > 0 ? (grossProfit / sellingPrice) * 100 : 0;
    const foodCostPct = sellingPrice > 0 ? (costPerPortion / sellingPrice) * 100 : 0;

    let status = "Calculated";
    if (!ingredients.length) {
      status = "No Recipe";
    } else if (hasMissingCost) {
      status = "Missing Costs";
    } else if (Number(product.cost_price) > 0 && Math.abs(Number(product.cost_price) - costPerPortion) > 0.05) {
      status = "Outdated";
    }

    const historyRes = await pool.query(
      `SELECT * FROM recipe_cost_history WHERE CAST(product_id AS TEXT) = $1 ORDER BY id DESC LIMIT 2`,
      [String(product.id)]
    );
    const prevHistory = historyRes.rows[1] || historyRes.rows[0];
    const previousCost = prevHistory ? Number(prevHistory.cost_per_portion) : Number(product.cost_price) || costPerPortion;
    const costDiff = costPerPortion - previousCost;
    const costDiffPct = previousCost > 0 ? (costDiff / previousCost) * 100 : 0;

    return {
      product,
      linked_product: linkedProduct,
      production_bom: productionBom ? {
        id: productionBom.id,
        name: productionBom.name || productionBom.product_name,
        version: productionBom.version,
        scrap_percentage: bomScrap,
        routing_labor_cost: bomLaborFromRoutings,
        linked_product_id: linkedProduct?.id || productionBom.product_id,
        linked_product_name: linkedProduct?.name || productionBom.product_name
      } : null,
      ingredients,
      warehouse: selectedWarehouse ? {
        id: selectedWarehouse.id,
        name: selectedWarehouse.name,
        code: selectedWarehouse.code
      } : {
        id: "all",
        name: "جميع المخازن (المتوسط المرجح العام)",
        code: "ALL"
      },
      cost_allocations: allocationDetails,
      summary: {
        total_ingredients_cost: totalIngredientsCost,
        total_waste_cost: totalWasteCost,
        packaging_cost: packagingCost,
        labor_cost: laborCost,
        overhead_cost: overheadCost,
        base_overhead_cost: baseOverheadCost,
        allocated_manufacturing_overhead: allocatedManufacturingOverhead,
        grand_total_cost: grandTotalCost,
        yield_portions: yieldPortions,
        cost_per_portion: costPerPortion,
        selling_price: sellingPrice,
        gross_profit: grossProfit,
        profit_margin_pct: profitMarginPct,
        food_cost_pct: foodCostPct,
        previous_cost: previousCost,
        cost_diff: costDiff,
        cost_diff_pct: costDiffPct,
        status,
        cost_source_param: costSourceParam,
        has_missing_cost: hasMissingCost,
        has_insufficient_stock: hasInsufficientStock
      }
    };
  }

  async saveRecipeCost(payload: any, user: any): Promise<any> {
    const histRes = await pool.query(`
      INSERT INTO recipe_cost_history (
        product_id, recipe_version, cost_source, total_ingredients_cost, total_waste_cost,
        packaging_cost, labor_cost, overhead_cost, grand_total_cost, yield_portions,
        cost_per_portion, selling_price, gross_profit, profit_margin_pct, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      RETURNING *
    `, [
      String(payload.product_id),
      payload.recipe_version || "V1",
      payload.cost_source || "weighted_avg",
      Number(payload.total_ingredients_cost) || 0,
      Number(payload.total_waste_cost) || 0,
      Number(payload.packaging_cost) || 0,
      Number(payload.labor_cost) || 0,
      Number(payload.overhead_cost) || 0,
      Number(payload.grand_total_cost) || 0,
      Number(payload.yield_portions) || 1,
      Number(payload.cost_per_portion) || 0,
      Number(payload.selling_price) || 0,
      Number(payload.gross_profit) || 0,
      Number(payload.profit_margin_pct) || 0,
      payload.status || "Approved"
    ]);

    await pool.query(`
      UPDATE products
      SET cost_price = $1, price = CASE WHEN $2 > 0 THEN $2 ELSE price END
      WHERE id = $3 OR CAST(id AS TEXT) = $3 OR name = $3
    `, [Number(payload.cost_per_portion), Number(payload.selling_price) || 0, String(payload.product_id)]);

    await pool.query(`
      INSERT INTO product_costs (
        product_id, raw_material, direct_labor, packaging, indirect_overhead, selling_price
      ) VALUES ($1, $2, $3, $4, $5, $6)
    `, [
      String(payload.product_id),
      Number(payload.total_ingredients_cost) || 0,
      Number(payload.labor_cost) || 0,
      Number(payload.packaging_cost) || 0,
      Number(payload.overhead_cost) || 0,
      Number(payload.selling_price) || 0
    ]);

    if (Array.isArray(payload.ingredients) && payload.ingredients.length > 0) {
      try {
        const prodIdNum = parseInt(String(payload.product_id), 10);
        if (!isNaN(prodIdNum)) {
          await pool.query(`DELETE FROM product_ingredients WHERE product_id = $1`, [prodIdNum]);
          for (const item of payload.ingredients) {
            const ingId = parseInt(String(item.ingredient_id || item.ingredientId || item.materialId), 10);
            if (!isNaN(ingId)) {
              await pool.query(
                `INSERT INTO product_ingredients (product_id, ingredient_id, quantity, unit, waste_percent) VALUES ($1, $2, $3, $4, $5)`,
                [prodIdNum, ingId, Number(item.recipe_quantity || item.quantity) || 0, item.recipe_unit || item.unit || 'كجم', Number(item.waste_percent) || 0]
              );
            }
          }
        }
      } catch (err) {
        console.warn('[CostService] Error syncing product_ingredients on saveRecipeCost:', err);
      }
    }

    await costRepository.logActivity(
      "تحديث وتنسيق تكلفة الـ Recipe",
      `تم اعتماد وتحديد تكلفة الوجبة لـ ${payload.product_id}: ${payload.cost_per_portion} ج.م`,
      user?.username || "النظام"
    );

    return histRes.rows[0];
  }

  async getRecipeCostHistory(productId: string): Promise<any[]> {
    return costRepository.getRecipeCostHistory(productId);
  }

  // ────────────────── LANDED COST FOUNDATION (PHASE 3 / 4 PREPARATION) ──────────────────

  /**
   * Authoritative Landed Cost Allocation calculation model:
   * Capitalizes freight, customs, insurance, and other landing expenses across receipt items by value or quantity.
   */
  calculateLandedCostAllocation(
    totalLandedExpenses: { freight: number; customs: number; insurance: number; other: number },
    items: { id: number; quantity: number; unitPrice: number }[],
    allocationMethod: 'by_value' | 'by_quantity' = 'by_value'
  ): LandedCostAllocationItem[] {
    const totalFreight = Math.max(0, Number(totalLandedExpenses.freight) || 0);
    const totalCustoms = Math.max(0, Number(totalLandedExpenses.customs) || 0);
    const totalInsurance = Math.max(0, Number(totalLandedExpenses.insurance) || 0);
    const totalOther = Math.max(0, Number(totalLandedExpenses.other) || 0);
    const grandLandedExpenses = totalFreight + totalCustoms + totalInsurance + totalOther;

    const totalBaseValue = items.reduce((sum, it) => sum + (Number(it.quantity) * Number(it.unitPrice)), 0);
    const totalQuantity = items.reduce((sum, it) => sum + Number(it.quantity), 0);

    return items.map((it) => {
      const qty = Number(it.quantity) || 1;
      const baseAmount = qty * Number(it.unitPrice);
      const ratio = allocationMethod === 'by_value'
        ? (totalBaseValue > 0 ? baseAmount / totalBaseValue : 1 / items.length)
        : (totalQuantity > 0 ? qty / totalQuantity : 1 / items.length);

      const allocatedFreight = Number((totalFreight * ratio).toFixed(2));
      const allocatedCustoms = Number((totalCustoms * ratio).toFixed(2));
      const allocatedInsurance = Number((totalInsurance * ratio).toFixed(2));
      const allocatedOther = Number((totalOther * ratio).toFixed(2));
      const totalItemLanded = baseAmount + allocatedFreight + allocatedCustoms + allocatedInsurance + allocatedOther;
      const finalUnitCost = Number((totalItemLanded / qty).toFixed(4));

      return {
        itemId: it.id,
        quantity: qty,
        baseAmount,
        allocatedFreight,
        allocatedCustoms,
        allocatedInsurance,
        allocatedOther,
        totalLandedCost: Number(totalItemLanded.toFixed(2)),
        finalUnitCost
      };
    });
  }

  // ────────────────── ACTIVITY LOGS & INTEGRATIONS ──────────────────

  async getActivityLogs(limit = 100): Promise<any[]> {
    return costRepository.getActivityLogs(limit);
  }

  async logActivity(action: string, details: string, username: string = 'النظام'): Promise<void> {
    return costRepository.logActivity(action, details, username);
  }

  async getIntegrationEmployees(): Promise<any[]> {
    return costRepository.getIntegrationEmployees();
  }

  async getIntegrationSuppliers(): Promise<any[]> {
    return costRepository.getIntegrationSuppliers();
  }

  async getIntegrationCustomers(): Promise<any[]> {
    return costRepository.getIntegrationCustomers();
  }

  async getIntegrationProducts(): Promise<any[]> {
    return costRepository.getIntegrationProducts();
  }

  async getIntegrationIngredients(): Promise<any[]> {
    return costRepository.getIntegrationIngredients();
  }

  async getIntegrationWarehouses(): Promise<any[]> {
    return costRepository.getIntegrationWarehouses();
  }

  async getIntegrationAccounts(): Promise<any[]> {
    return costRepository.getIntegrationAccounts();
  }
}

export const costService = new CostService();
