import { CreateReturnDTO } from "../dto/return.dto.js";

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
  if (!isNonEmptyString(item.itemName)) {
    return `Item #${index + 1} must have an itemName`;
  }
  if (typeof item.qtyReturned !== "number" || item.qtyReturned <= 0) {
    return `Item #${index + 1} must have a positive qtyReturned`;
  }
  if (typeof item.qtyInvoiced !== "number" || item.qtyInvoiced <= 0) {
    return `Item #${index + 1} must have a positive qtyInvoiced`;
  }
  if (item.qtyReturned > item.qtyInvoiced) {
    return `Item #${index + 1} qtyReturned cannot exceed qtyInvoiced`;
  }
  if (typeof item.price !== "number" || item.price < 0) {
    return `Item #${index + 1} must have a non-negative price`;
  }
  if (item.discount !== undefined) {
    if (typeof item.discount !== "number" || item.discount < 0) {
      return `Item #${index + 1} discount must be a non-negative number`;
    }
  }
  if (item.taxRate !== undefined) {
    if (typeof item.taxRate !== "number" || item.taxRate < 0) {
      return `Item #${index + 1} taxRate must be a non-negative number`;
    }
  }
  return null;
}

export function validateReturn(data: any): { error?: string; value?: CreateReturnDTO } {
  if (!data || typeof data !== "object") {
    return { error: "Request body is required" };
  }
  if (!isNonEmptyString(data.customerName)) {
    return { error: "customerName is required" };
  }
  if (!isValidDate(data.date)) {
    return { error: "A valid date is required" };
  }
  if (!Array.isArray(data.items) || data.items.length === 0) {
    return { error: "Return must contain at least one item" };
  }
  for (let i = 0; i < data.items.length; i++) {
    const itemError = validateItem(data.items[i], i);
    if (itemError) return { error: itemError };
  }

  return { value: data as CreateReturnDTO };
}
