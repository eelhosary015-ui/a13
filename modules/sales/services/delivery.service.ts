import { DeliveryRepository } from "../repositories/delivery.repository.js";
import { CreateDeliveryDTO, UpdateDeliveryDTO } from "../dto/delivery.dto.js";
import { ERPCache, ERPEventBus, erpPool } from "../../../server-erp-core.js";
import { WarehouseService } from "../../warehouses/services/warehouse.service.js";

const LIST_CACHE_KEY = "sales:deliveries:all";

export class DeliveryService {
  private repository: DeliveryRepository;
  private warehouseService: WarehouseService;

  constructor() {
    this.repository = new DeliveryRepository();
    this.warehouseService = new WarehouseService();
  }

  async getDeliveries(): Promise<any[]> {
    const cached = ERPCache.get(LIST_CACHE_KEY);
    if (cached) return cached;

    const deliveries = await this.repository.getAll();
    ERPCache.set(LIST_CACHE_KEY, deliveries, 60);
    return deliveries;
  }

  async getDeliveryById(id: number): Promise<any> {
    const delivery = await this.repository.getById(id);
    if (!delivery) {
      const err: any = new Error("Delivery note not found");
      err.statusCode = 404;
      throw err;
    }
    return delivery;
  }

  async createDelivery(dto: CreateDeliveryDTO): Promise<any> {
    const delivery = await this.repository.create(dto);
    ERPCache.delete(LIST_CACHE_KEY);

    // If delivery is approved or confirmed, adjust stock and update order
    if (dto.status === "معتمد" || dto.status === "تم التسليم") {
      await this.processDeliveryStockAndOrder(delivery);
    }

    ERPEventBus.getInstance().emitEvent("SalesDeliveryCreated", {
      deliveryId: delivery.id,
      deliveryNo: delivery.deliveryNo,
      customerName: delivery.customerName,
      totalQtyDelivered: delivery.totalQtyDelivered,
      timestamp: new Date()
    });

    return delivery;
  }

  async updateDelivery(id: number, dto: UpdateDeliveryDTO): Promise<any> {
    const found = await this.repository.getById(id);
    if (!found) {
      const err: any = new Error("Delivery note not found");
      err.statusCode = 404;
      throw err;
    }

    const delivery = await this.repository.update(id, dto);
    ERPCache.delete(LIST_CACHE_KEY);

    if ((dto.status === "معتمد" || dto.status === "تم التسليم") && found.status !== "معتمد" && found.status !== "تم التسليم") {
      await this.processDeliveryStockAndOrder(delivery);
    }

    ERPEventBus.getInstance().emitEvent("SalesDeliveryUpdated", {
      deliveryId: id,
      timestamp: new Date()
    });

    return delivery;
  }

  async deleteDelivery(id: number): Promise<void> {
    const found = await this.repository.getById(id);
    if (!found) {
      const err: any = new Error("Delivery note not found");
      err.statusCode = 404;
      throw err;
    }

    // If linked to an order, rollback delivered quantities
    if (found.orderId && found.totalQtyDelivered) {
      try {
        const qty = Number(found.totalQtyDelivered) || 0;
        await erpPool.query(`
          UPDATE erp_sales_orders
          SET delivered_qty = GREATEST(0, COALESCE(delivered_qty, 0) - $1),
              remaining_qty = LEAST(total_qty, COALESCE(remaining_qty, 0) + $1),
              status = CASE 
                WHEN GREATEST(0, COALESCE(delivered_qty, 0) - $1) = 0 THEN 'مؤكد'
                ELSE 'تم التسليم جزئياً'
              END
          WHERE id = $2
        `, [qty, found.orderId]);
        ERPCache.delete("sales:orders:all");
      } catch (e: any) {
        console.warn("Rollback order on delete delivery notice:", e.message);
      }
    }

    await this.repository.delete(id);
    ERPCache.delete(LIST_CACHE_KEY);

    ERPEventBus.getInstance().emitEvent("SalesDeliveryDeleted", {
      deliveryId: id,
      timestamp: new Date()
    });
  }

  private async processDeliveryStockAndOrder(delivery: any): Promise<void> {
    // 1. Stock deduction
    if (delivery.warehouseId || delivery.warehouse) {
      for (const item of (delivery.items || [])) {
        const qty = Number(item.qtyDelivered) || 0;
        if (qty <= 0) continue;

        try {
          // Deduct from warehouse
          if (item.ingredientId) {
            await this.warehouseService.adjustStock({
              warehouse_id: delivery.warehouseId || 1,
              ingredient_id: item.ingredientId,
              quantity: qty,
              type: "deduction",
              notes: `إذن تسليم مبيعات ${delivery.deliveryNo} — ${item.itemName}`
            });
          }
        } catch (e: any) {
          console.warn("Delivery stock adjustment notice:", e.message);
        }
      }
    }

    // 2. Update linked Sales Order delivered & remaining quantities
    if (delivery.orderId) {
      try {
        const totalDelivered = Number(delivery.totalQtyDelivered) || 0;
        await erpPool.query(`
          UPDATE erp_sales_orders
          SET delivered_qty = COALESCE(delivered_qty, 0) + $1,
              remaining_qty = GREATEST(0, total_qty - (COALESCE(delivered_qty, 0) + $1)),
              status = CASE 
                WHEN (total_qty - (COALESCE(delivered_qty, 0) + $1)) <= 0 THEN 'مكتمل'
                ELSE 'تم التسليم جزئياً'
              END
          WHERE id = $2
        `, [totalDelivered, delivery.orderId]);
        ERPCache.delete("sales:orders:all");
      } catch (err: any) {
        console.warn("Could not update sales order quantities:", err.message);
      }
    }
  }
}
