export interface SalesOrderItemDTO {
  itemCode?: string;
  itemName: string;
  unit?: string;
  qtyRequired: number;
  qtyAvailable?: number;
  qtyReserved?: number;
  qtyDelivered?: number;
  price: number;
  discountPercent?: number;
  total: number;
}

export interface CreateSalesOrderDTO {
  orderNo?: string;
  customerName: string;
  date: string;
  deliveryDate?: string;
  salesRep?: string;
  paymentMethod?: string;
  branch?: string;
  warehouse?: string;
  currency?: string;
  notes?: string;
  status?: string;
  totalQty?: number;
  totalAmount?: number;
  deliveredQty?: number;
  remainingQty?: number;
  items: SalesOrderItemDTO[];
}

export interface UpdateSalesOrderDTO extends CreateSalesOrderDTO {}
