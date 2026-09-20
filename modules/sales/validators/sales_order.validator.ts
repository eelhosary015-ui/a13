import { CreateSalesOrderDTO } from "../dto/sales_order.dto.js";

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
  if (typeof item.qtyRequired !== "number" || item.qtyRequired <= 0) {
    return `Item #${index + 1} must have a positive qtyRequired`;
  }
  if (typeof item.price !== "number" || item.price < 0) {
    return `Item #${index + 1} must have a non-negative price`;
  }
  if (item.discountPercent !== undefined) {
    if (typeof item.discountPercent !== "number" || item.discountPercent < 0 || item.discountPercent > 100) {
      return `Item #${index + 1} discountPercent must be between 0 and 100`;
    }
  }
  if (item.qtyDelivered !== undefined) {
    if (typeof item.qtyDelivered !== "number" || item.qtyDelivered < 0) {
      return `Item #${index + 1} qtyDelivered must be a non-negative number`;
    }
    if (item.qtyDelivered > item.qtyRequired) {
      return `Item #${index + 1} qtyDelivered cannot exceed qtyRequired`;
    }
  }
  return null;
}

export function validateSalesOrder(data: any): { error?: string; value?: CreateSalesOrderDTO } {
  if (!data || typeof data !== "object") {
    return { error: "Request body is required" };
  }
  if (!isNonEmptyString(data.customerName)) {
    return { error: "customerName is required" };
  }
  if (!isValidDate(data.date)) {
    return { error: "A valid date is required" };
  }
  if (data.deliveryDate && !isValidDate(data.deliveryDate)) {
    return { error: "deliveryDate is not a valid date" };
  }
  if (data.deliveryDate && new Date(data.deliveryDate).getTime() < new Date(data.date).getTime()) {
    return { error: "deliveryDate cannot be earlier than date" };
  }
  if (!Array.isArray(data.items) || data.items.length === 0) {
    return { error: "Sales order must contain at least one item" };
  }
  for (let i = 0; i < data.items.length; i++) {
    const itemError = validateItem(data.items[i], i);
    if (itemError) return { error: itemError };
  }

  return { value: data as CreateSalesOrderDTO };
}
