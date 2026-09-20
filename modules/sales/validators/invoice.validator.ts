import { CreateInvoiceDTO } from "../dto/invoice.dto.js";

function isNonEmptyString(v: any): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function isValidDate(v: any): boolean {
  if (!isNonEmptyString(v)) return false;
  return !isNaN(new Date(v).getTime());
}

function validateItem(item: any, index: number): string | null {
  if (!item || typeof item !== "object") {
    return `Item #${index + 1} is invalid`;
  }
  if (!isNonEmptyString(item.name)) {
    return `Item #${index + 1} must have a name`;
  }
  if (typeof item.qty !== "number" || item.qty <= 0) {
    return `Item #${index + 1} must have a positive qty`;
  }
  if (typeof item.price !== "number" || item.price < 0) {
    return `Item #${index + 1} must have a non-negative price`;
  }
  if (typeof item.total !== "number" || item.total < 0) {
    return `Item #${index + 1} must have a non-negative total`;
  }
  if (item.discountPercent !== undefined) {
    if (typeof item.discountPercent !== "number" || item.discountPercent < 0 || item.discountPercent > 100) {
      return `Item #${index + 1} discountPercent must be between 0 and 100`;
    }
  }
  if (item.vatPercent !== undefined) {
    if (typeof item.vatPercent !== "number" || item.vatPercent < 0) {
      return `Item #${index + 1} vatPercent must be a non-negative number`;
    }
  }
  if (item.ingredientId !== undefined && typeof item.ingredientId !== "number") {
    return `Item #${index + 1} ingredientId must be a number`;
  }
  return null;
}

export function validateInvoice(data: any): { error?: string; value?: CreateInvoiceDTO } {
  if (!data || typeof data !== "object") {
    return { error: "Request body is required" };
  }
  if (!isNonEmptyString(data.customerName)) {
    return { error: "customerName is required" };
  }
  if (data.customerId !== undefined && typeof data.customerId !== "number") {
    return { error: "customerId must be a number" };
  }
  if (data.warehouseId !== undefined && typeof data.warehouseId !== "number") {
    return { error: "warehouseId must be a number" };
  }
  if (!isValidDate(data.date)) {
    return { error: "A valid date is required" };
  }
  if (data.dueDate && !isValidDate(data.dueDate)) {
    return { error: "dueDate is not a valid date" };
  }
  if (data.paidAmount !== undefined) {
    if (typeof data.paidAmount !== "number" || data.paidAmount < 0) {
      return { error: "paidAmount must be a non-negative number" };
    }
  }
  if (!Array.isArray(data.items) || data.items.length === 0) {
    return { error: "Invoice must contain at least one item" };
  }
  for (let i = 0; i < data.items.length; i++) {
    const itemError = validateItem(data.items[i], i);
    if (itemError) return { error: itemError };
  }

  return { value: data as CreateInvoiceDTO };
}

export function validateInvoicePayment(data: any): { error?: string; value?: { amount: number; method?: string; notes?: string } } {
  if (!data || typeof data !== "object") {
    return { error: "Request body is required" };
  }
  if (typeof data.amount !== "number" || data.amount <= 0) {
    return { error: "amount must be a positive number" };
  }
  return { value: { amount: data.amount, method: data.method, notes: data.notes } };
}
