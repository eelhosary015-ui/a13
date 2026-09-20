import { SalesOrderRepository } from "../repositories/sales_order.repository.js";
import { CreateSalesOrderDTO, UpdateSalesOrderDTO } from "../dto/sales_order.dto.js";
import { ERPCache, ERPEventBus } from "../../../server-erp-core.js";

const LIST_CACHE_KEY = "sales:orders:all";

export class SalesOrderService {
  private repository: SalesOrderRepository;

  constructor() {
    this.repository = new SalesOrderRepository();
  }

  async getSalesOrders(): Promise<any[]> {
    const cached = ERPCache.get(LIST_CACHE_KEY);
    if (cached) return cached;

    const orders = await this.repository.getAll();
    ERPCache.set(LIST_CACHE_KEY, orders, 60);
    return orders;
  }

  async createSalesOrder(dto: CreateSalesOrderDTO): Promise<any> {
    const order = await this.repository.create(dto);
    ERPCache.delete(LIST_CACHE_KEY);

    // Emitted so inventory/accounting modules can eventually reserve stock
    // and post the related journal entry once they subscribe to this event.
    ERPEventBus.getInstance().emitEvent("SalesOrderCreated", {
      orderId: order.id,
      orderNo: order.order_no,
      customerName: order.customer_name,
      totalAmount: order.total_amount,
      warehouse: order.warehouse,
      timestamp: new Date()
    });

    return order;
  }

  async updateSalesOrder(id: number, dto: UpdateSalesOrderDTO): Promise<any> {
    const found = await this.repository.getById(id);
    if (!found) {
      const err: any = new Error("Sales order not found");
      err.statusCode = 404;
      throw err;
    }

    if (found.status === "ملغي") {
      const err: any = new Error("Cannot edit a cancelled sales order");
      err.statusCode = 409;
      throw err;
    }

    const order = await this.repository.update(id, dto);
    ERPCache.delete(LIST_CACHE_KEY);

    ERPEventBus.getInstance().emitEvent("SalesOrderUpdated", {
      orderId: id,
      timestamp: new Date()
    });

    return order;
  }

  async deleteSalesOrder(id: number): Promise<void> {
    const found = await this.repository.getById(id);
    if (!found) {
      const err: any = new Error("Sales order not found");
      err.statusCode = 404;
      throw err;
    }

    if (found.deliveredQty && found.deliveredQty > 0) {
      const err: any = new Error("Cannot delete a sales order that already has delivered quantities");
      err.statusCode = 409;
      throw err;
    }

    await this.repository.delete(id);
    ERPCache.delete(LIST_CACHE_KEY);

    ERPEventBus.getInstance().emitEvent("SalesOrderDeleted", {
      orderId: id,
      timestamp: new Date()
    });
  }
}
