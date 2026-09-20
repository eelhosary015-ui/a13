import { ERPEventBus } from "../../../server-erp-core.js";
import { recordGoodsReceiptCost, recordProductionCost, recordPurchaseCost } from "../services/cost.integration.service.js";

export function initCostEvents() {
  const eventBus = ERPEventBus.getInstance();
  eventBus.on("PurchaseCreated", (data: any) => {
    void recordPurchaseCost(Number(data.purchaseId)).catch((error: any) => {
      console.error(`[Costs Integration] Purchase #${data.purchaseId} could not be recorded:`, error?.message || error);
    });
  });

  eventBus.on("ProductionOrderExecuted", (data: any) => {
    void recordProductionCost(String(data.orderNumber)).catch((error: any) => {
      console.error(`[Costs Integration] Production ${data.orderNumber} could not be recorded:`, error?.message || error);
    });
  });

  eventBus.on("GoodsReceiptPosted", (data: any) => {
    void recordGoodsReceiptCost(Number(data.receiptId)).catch((error: any) => {
      console.error(`[Costs Integration] Goods receipt #${data.receiptId} could not be recorded:`, error?.message || error);
    });
  });

  eventBus.on("CostRecorded", (data: any) => {
    console.log(`[Costs Event] New operational cost recorded: ${data.category} - ${data.amount} EGP.`);
  });
}
