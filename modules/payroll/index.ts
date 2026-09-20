import payrollRoutes from "./routes/payroll.routes.js";
import { initPayrollEvents } from "./events/payroll.events.js";
import { initPayrollJobs } from "./jobs/payroll.jobs.js";

export function bootstrapPayrollModule() {
  console.log("⚡ Bootstrapping Payroll Module...");
  initPayrollEvents();
  initPayrollJobs();
}

export { payrollRoutes };
export * from "./dto/payroll.dto.js";
export * from "./validators/payroll.validator.js";
export * from "./services/payroll.service.js";
export * from "./controllers/payroll.controller.js";
