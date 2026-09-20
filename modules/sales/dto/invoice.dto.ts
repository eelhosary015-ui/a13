export interface InvoiceItemDTO {
  ingredientId?: number; // links to warehouse stock item, optional (enables real stock deduction)
  code?: string;
  name: string;
  unit?: string;
  qty: number;
  price: number;
  discountPercent?: number;
  vatPercent?: number;
  total: number;
}

export interface CreateInvoiceDTO {
  invoiceNo?: string;
  orderId?: number; // optional link back to the sales order this invoice was generated from
  customerId?: number; // optional link to the customers module for AR/balance tracking
  customerName: string;
  date: string;
  dueDate?: string;
  salesRep?: string;
  branch?: string;
  warehouseId?: number; // optional, enables real stock deduction
  warehouse?: string;
  currency?: string;
  paymentMethod?: string; // "نقدي" | "أجل" | ...
  notes?: string;
  status?: string;
  subtotal?: number;
  discountTotal?: number;
  taxTotal?: number;
  netAmount?: number;
  paidAmount?: number;
  items: InvoiceItemDTO[];
}

export interface UpdateInvoiceDTO extends CreateInvoiceDTO {}

export interface RecordInvoicePaymentDTO {
  amount: number;
  method?: string;
  notes?: string;
}
