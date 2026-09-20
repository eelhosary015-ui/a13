import { Router, Request, Response } from "express";
import { QuotationController } from "./controllers/quotation.controller.js";
import { SalesOrderController } from "./controllers/sales_order.controller.js";
import { DeliveryController } from "./controllers/delivery.controller.js";
import { ReturnController } from "./controllers/return.controller.js";
import { InvoiceController } from "./controllers/invoice.controller.js";
import { erpPool } from "../../server-erp-core.js";

const salesRoutes = Router();
const quotationController = new QuotationController();
const orderController = new SalesOrderController();
const deliveryController = new DeliveryController();
const returnController = new ReturnController();
const invoiceController = new InvoiceController();

// 1. Quotations
salesRoutes.get("/quotations", quotationController.getQuotations);
salesRoutes.post("/quotations", quotationController.createQuotation);
salesRoutes.put("/quotations/:id", quotationController.updateQuotation);
salesRoutes.delete("/quotations/:id", quotationController.deleteQuotation);

// 2. Sales Orders
salesRoutes.get("/orders", orderController.getSalesOrders);
salesRoutes.post("/orders", orderController.createSalesOrder);
salesRoutes.put("/orders/:id", orderController.updateSalesOrder);
salesRoutes.delete("/orders/:id", orderController.deleteSalesOrder);

// 3. Delivery Notes (إذن تسليم)
salesRoutes.get("/deliveries", deliveryController.getDeliveries);
salesRoutes.get("/deliveries/:id", deliveryController.getDeliveryById);
salesRoutes.post("/deliveries", deliveryController.createDelivery);
salesRoutes.put("/deliveries/:id", deliveryController.updateDelivery);
salesRoutes.delete("/deliveries/:id", deliveryController.deleteDelivery);

// 4. Sales Invoices (فاتورة مبيعات)
salesRoutes.get("/invoices", invoiceController.getInvoices);
salesRoutes.get("/invoices/:id", invoiceController.getInvoiceById);
salesRoutes.post("/invoices", invoiceController.createInvoice);
salesRoutes.put("/invoices/:id", invoiceController.updateInvoice);
salesRoutes.delete("/invoices/:id", invoiceController.deleteInvoice);
salesRoutes.post("/invoices/:id/payments", invoiceController.recordPayment);

// 5. Sales Returns (مرتجع مبيعات)
salesRoutes.get("/returns", returnController.getReturns);
salesRoutes.post("/returns", returnController.createReturn);
salesRoutes.put("/returns/:id", returnController.updateReturn);
salesRoutes.delete("/returns/:id", returnController.deleteReturn);

// 6. Contracts (عقود التوريد)
salesRoutes.get("/contracts", async (req: Request, res: Response) => {
  try {
    await erpPool.query(`
      CREATE TABLE IF NOT EXISTS sales_contracts (
        id SERIAL PRIMARY KEY,
        contract_no VARCHAR(100) UNIQUE NOT NULL,
        customer_name VARCHAR(255) NOT NULL,
        start_date DATE NOT NULL,
        end_date DATE NOT NULL,
        total_value DECIMAL(12,2) DEFAULT 0,
        status VARCHAR(50) DEFAULT 'ساري',
        payment_terms TEXT,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    const result = await erpPool.query("SELECT * FROM sales_contracts ORDER BY created_at DESC");
    res.json(result.rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

salesRoutes.post("/contracts", async (req: Request, res: Response) => {
  try {
    const { contract_no, customer_name, start_date, end_date, total_value = 0, status = 'ساري', payment_terms, notes } = req.body;
    const contractNo = contract_no || `CNT-${Date.now().toString().slice(-6)}`;
    const result = await erpPool.query(`
      INSERT INTO sales_contracts (contract_no, customer_name, start_date, end_date, total_value, status, payment_terms, notes)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `, [contractNo, customer_name, start_date, end_date, total_value, status, payment_terms, notes]);
    res.status(201).json(result.rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

salesRoutes.delete("/contracts/:id", async (req: Request, res: Response) => {
  try {
    await erpPool.query("DELETE FROM sales_contracts WHERE id = $1", [req.params.id]);
    res.status(204).send();
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 7. Reservations (حجز البضاعة)
salesRoutes.get("/reservations", async (req: Request, res: Response) => {
  try {
    await erpPool.query(`
      CREATE TABLE IF NOT EXISTS sales_reservations (
        id SERIAL PRIMARY KEY,
        reservation_no VARCHAR(100) UNIQUE NOT NULL,
        customer_name VARCHAR(255) NOT NULL,
        item_name VARCHAR(255) NOT NULL,
        qty DECIMAL(12,2) NOT NULL,
        reserve_date DATE NOT NULL,
        expiry_date DATE NOT NULL,
        status VARCHAR(50) DEFAULT 'محجوز',
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    const result = await erpPool.query("SELECT * FROM sales_reservations ORDER BY created_at DESC");
    res.json(result.rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

salesRoutes.post("/reservations", async (req: Request, res: Response) => {
  try {
    const { reservation_no, customer_name, item_name, qty, reserve_date, expiry_date, status = 'محجوز', notes } = req.body;
    const resNo = reservation_no || `RES-${Date.now().toString().slice(-6)}`;
    const result = await erpPool.query(`
      INSERT INTO sales_reservations (reservation_no, customer_name, item_name, qty, reserve_date, expiry_date, status, notes)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `, [resNo, customer_name, item_name, qty, reserve_date, expiry_date, status, notes]);
    res.status(201).json(result.rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

salesRoutes.delete("/reservations/:id", async (req: Request, res: Response) => {
  try {
    await erpPool.query("DELETE FROM sales_reservations WHERE id = $1", [req.params.id]);
    res.status(204).send();
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 8. Sales Reps & Commissions (المندوبين والعمولات)
salesRoutes.get("/sales-reps", async (req: Request, res: Response) => {
  try {
    await erpPool.query(`
      CREATE TABLE IF NOT EXISTS sales_reps (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        phone VARCHAR(50),
        email VARCHAR(100),
        target_amount DECIMAL(12,2) DEFAULT 0,
        achieved_amount DECIMAL(12,2) DEFAULT 0,
        commission_rate DECIMAL(5,2) DEFAULT 2.5,
        total_commission DECIMAL(12,2) DEFAULT 0,
        status VARCHAR(50) DEFAULT 'نشط',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    const result = await erpPool.query("SELECT * FROM sales_reps ORDER BY name ASC");
    res.json(result.rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

salesRoutes.post("/sales-reps", async (req: Request, res: Response) => {
  try {
    const { name, phone, email, target_amount = 0, achieved_amount = 0, commission_rate = 2.5, status = 'نشط' } = req.body;
    const total_commission = (Number(achieved_amount) * Number(commission_rate)) / 100;
    const result = await erpPool.query(`
      INSERT INTO sales_reps (name, phone, email, target_amount, achieved_amount, commission_rate, total_commission, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `, [name, phone, email, target_amount, achieved_amount, commission_rate, total_commission, status]);
    res.status(201).json(result.rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

salesRoutes.delete("/sales-reps/:id", async (req: Request, res: Response) => {
  try {
    await erpPool.query("DELETE FROM sales_reps WHERE id = $1", [req.params.id]);
    res.status(204).send();
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 9. Price Lists (قوائم الأسعار)
salesRoutes.get("/price-lists", async (req: Request, res: Response) => {
  try {
    await erpPool.query(`
      CREATE TABLE IF NOT EXISTS sales_price_lists (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        type VARCHAR(50) DEFAULT 'جملة',
        discount_percent DECIMAL(5,2) DEFAULT 0,
        is_default BOOLEAN DEFAULT false,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    const result = await erpPool.query("SELECT * FROM sales_price_lists ORDER BY id ASC");
    res.json(result.rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

salesRoutes.post("/price-lists", async (req: Request, res: Response) => {
  try {
    const { name, type = 'جملة', discount_percent = 0, is_default = false, notes } = req.body;
    const result = await erpPool.query(`
      INSERT INTO sales_price_lists (name, type, discount_percent, is_default, notes)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [name, type, discount_percent, is_default, notes]);
    res.status(201).json(result.rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

salesRoutes.delete("/price-lists/:id", async (req: Request, res: Response) => {
  try {
    await erpPool.query("DELETE FROM sales_price_lists WHERE id = $1", [req.params.id]);
    res.status(204).send();
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 10. Clean/Reset Sales Demo Data
salesRoutes.post("/reset-demo-data", async (req: Request, res: Response) => {
  try {
    const tablesToClean = [
      "sales_return_items",
      "sales_returns",
      "sales_invoice_payments",
      "sales_invoice_items",
      "sales_invoices",
      "sales_delivery_note_items",
      "sales_delivery_notes",
      "erp_sales_order_items",
      "erp_sales_orders",
      "sales_quotation_items",
      "sales_quotations",
      "sales_contracts",
      "sales_reservations"
    ];
    for (const table of tablesToClean) {
      try {
        await erpPool.query(`DELETE FROM ${table}`);
      } catch (_) {
        // Table might not exist yet
      }
    }
    res.json({ success: true, message: "تم تفريغ جميع البيانات التجريبية والافتراضية لمديول المبيعات بنجاح، المديول يبدأ من الصفر." });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export function bootstrapSalesModule() {
  console.log("⚡ Bootstrapping Sales (Quotations, Sales Orders, Deliveries, Invoices, Returns & CRM) Module...");
}

export { salesRoutes };
export * from "./dto/quotation.dto.js";
export * from "./dto/sales_order.dto.js";
export * from "./dto/delivery.dto.js";
export * from "./dto/return.dto.js";
export * from "./dto/invoice.dto.js";
export * from "./validators/quotation.validator.js";
export * from "./validators/sales_order.validator.js";
export * from "./validators/return.validator.js";
export * from "./validators/invoice.validator.js";
export * from "./services/quotation.service.js";
export * from "./services/sales_order.service.js";
export * from "./services/delivery.service.js";
export * from "./services/return.service.js";
export * from "./services/invoice.service.js";
