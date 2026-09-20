import { Router } from "express";
import { bootstrapRestaurantModule, orderRoutes } from "./restaurant/index.js";
import { bootstrapAccountingModule, safeRoutes } from "./accounting/index.js";
import { bootstrapHRModule, employeeRoutes } from "./hr/index.js";
import { bootstrapSystemModule, systemRoutes } from "./system/index.js";
import { bootstrapPurchasesModule, purchaseRoutes, supplierRoutes } from "./purchases/index.js";
import { bootstrapProductionModule, productionRoutes } from "./production/index.js";
import { bootstrapCostsModule, costRoutes } from "./costs/index.js";
import { bootstrapAccountsModule, accountRoutes, erpGlRoutes } from "./accounts/index.js";
import { bootstrapKitchenModule, kitchenRoutes } from "./kitchen/index.js";
import { bootstrapComplaintsModule, complaintRoutes } from "./complaints/index.js";
import { bootstrapFingerprintModule, fingerprintRoutes } from "./fingerprint/index.js";
import { bootstrapPayrollModule, payrollRoutes } from "./payroll/index.js";
// Warehouses module removed
import { bootstrapSecurityModule, securityRoutes } from "./security/index.js";
import { bootstrapReportsModule, reportRoutes } from "./reports/index.js";
import { bootstrapRecipesModule, recipeRoutes } from "./recipes/index.js";
import { bootstrapCustomersModule, customerRoutes } from "./customers/index.js";
import { bootstrapSalesModule, salesRoutes } from "./sales/index.js";
import { bootstrapEnterpriseModule, enterpriseRoutes } from "./enterprise/index.js";
import { bootstrapAIDeveloperModule, aiDeveloperRoutes } from "./aideveloper/index.js";
import { bootstrapHotelModule, hotelRoutes } from "./hotel_pms/index.js";
import approvalRouter from "./system/approval_api.routes.js";

// Master function to initialize events/jobs for all modules
export function bootstrapAllModules() {
  console.log("🚀 Starting ERP Layered Architecture Modules...");
  bootstrapRestaurantModule();
  bootstrapAccountingModule();
  bootstrapHRModule();
  bootstrapSystemModule();
  bootstrapPurchasesModule();
  bootstrapProductionModule();
  bootstrapCostsModule();
  bootstrapAccountsModule();
  bootstrapKitchenModule();
  bootstrapComplaintsModule();
  bootstrapFingerprintModule();
  bootstrapPayrollModule();
  // bootstrapWarehousesModule(); // Removed
  bootstrapSecurityModule();
  bootstrapReportsModule();
  bootstrapRecipesModule();
  bootstrapCustomersModule();
  bootstrapSalesModule();
  bootstrapEnterpriseModule();
  bootstrapAIDeveloperModule();
  bootstrapHotelModule();
  console.log('✅ Enterprise & Hotel PMS module routes registered');
}

// Master module router
const modulesRouter = Router();

// Mt. routes
modulesRouter.use(aiDeveloperRoutes);
modulesRouter.use("/restaurant/orders", orderRoutes);
modulesRouter.use("/accounting/safes", safeRoutes);
modulesRouter.use("/hr/employees", employeeRoutes);
modulesRouter.use("/system", systemRoutes);
modulesRouter.use("/purchases", purchaseRoutes);
modulesRouter.use("/suppliers", supplierRoutes);
modulesRouter.use("/production", productionRoutes);
modulesRouter.use("/costs", costRoutes);
modulesRouter.use("/accounts", accountRoutes);
modulesRouter.use("/erp-gl", erpGlRoutes);
modulesRouter.use("/kitchen", kitchenRoutes);
modulesRouter.use("/complaints", complaintRoutes);
modulesRouter.use("/fingerprint", fingerprintRoutes);
modulesRouter.use("/payroll", payrollRoutes);
// modulesRouter.use("/warehouses", warehouseRoutes); // Removed
modulesRouter.use("/security", securityRoutes);
modulesRouter.use("/reports", reportRoutes);
modulesRouter.use("/recipes", recipeRoutes);
modulesRouter.use("/customers", customerRoutes);
modulesRouter.use("/sales", salesRoutes);
modulesRouter.use("/hotel", hotelRoutes);
modulesRouter.use("/approvals", approvalRouter);

modulesRouter.use("/enterprise", enterpriseRoutes);

export default modulesRouter;
