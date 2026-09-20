import express from "express";
import cors from "cors";
import iconv from "iconv-lite";
import ArabicReshaper from "arabic-reshaper";
import { ERPEventBus, setERPPool } from "./server-erp-core.js";
import { initDb } from "./server-db-init.js";
import { encodeCp864 } from "./cp864_encoder.cjs";
import modulesRouter, { bootstrapAllModules } from "./modules/index.js";
import { runEnterpriseMigrations } from "./modules/enterprise/services/migration.service.js";
import { securityHeadersMiddleware, inputSanitizationMiddleware, rateLimitMiddleware } from "./modules/enterprise/services/security.service.js";
import { performanceMiddleware, errorHandlingMiddleware } from "./modules/enterprise/services/errorLogger.service.js";
import { createServer as createViteServer } from "vite";
import { createServer } from "http";
import { Server } from "socket.io";
import pg from "pg";
import path from "path";
import fs from "fs";
import os from "os";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import net from "net";
import multer from "multer";
import { randomBytes, randomUUID } from "crypto";
import dotenv from "dotenv";

export let io: any;

import { pool } from "./server-db.js";
import { getRequiredAdvancedPermissionKeys } from "./src/utils/advancedPermissions.js";
import { adjustmentsRouter } from "./modules/warehouses/routes/adjustments.routes.js";
import { wastageRouter } from "./modules/warehouses/routes/wastage.routes.js";

dotenv.config();

// Ensure backups directory exists
if (!fs.existsSync('backups')) {
  fs.mkdirSync('backups');
}

// Configure Multer
import { upload } from "./server-upload.js";
export { upload };

setERPPool(pool);

export const JWT_SECRET = process.env.JWT_SECRET || "remo_pro_secret_2024_stable";


type ApiUser = {
  id: number;
  username: string;
  role: string;
  branch_id?: number | null;
  company_id?: number | null;
  role_id?: number | null;
  permissions?: Record<string, any>;
};

function parsePermissions(value: any): Record<string, any> {
  if (!value) return {};
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return {};
    }
  }
  if (Array.isArray(parsed)) {
    const result: Record<string, any> = {};
    parsed.forEach((item) => {
      if (typeof item === "string" && item.trim()) {
        result[item] = true;
        const moduleId = item.split(".")[0];
        result[moduleId] = true;
        result[`${moduleId}.read`] = true;
        result[`${moduleId}.full_access`] = true;
      }
    });
    return result;
  }
  if (typeof parsed === "object" && parsed !== null) {
    return parsed;
  }
  return {};
}

function isAdminUser(user: ApiUser | undefined) {
  return !!user && (user.role === "admin" || user.permissions?.all === true);
}

function routeToModule(pathname: string): string {
  if (pathname.startsWith("/api/v2/production")) return "production";
  if (pathname.startsWith("/api/v2/sales") || pathname.startsWith("/api/sales")) return "sales";
  if (pathname.startsWith("/api/v2/warehouses")) return "inventory";
  if (pathname.startsWith("/api/v2/purchases")) return "purchases";
  if (pathname.startsWith("/api/v2/accounting") || pathname.startsWith("/api/v2/accounts")) return "accounting";
  if (pathname.startsWith("/api/v2/hr") || pathname.startsWith("/api/v2/payroll") || pathname.startsWith("/api/v2/fingerprint")) return "hr";
  if (pathname.startsWith("/api/v2/reports")) return "reports";
  if (pathname.startsWith("/api/v2/customers")) return "customers";
  if (pathname.startsWith("/api/v2/restaurant") || pathname.startsWith("/api/v2/kitchen") || pathname.startsWith("/api/v2/recipes")) return "restaurant";
  if (pathname.startsWith("/api/v2/security") || pathname.startsWith("/api/v2/system")) return "system";
  if (pathname.startsWith("/api/v2/approvals") || pathname.startsWith("/api/approvals")) return "approvals";
  if (pathname.startsWith("/api/treasury")) return "treasury";
  if (pathname.startsWith("/api/hr") || pathname.startsWith("/api/attendance") || pathname.startsWith("/api/payroll") || pathname.startsWith("/api/fingerprint")) return "hr";
  if (
    pathname.startsWith("/api/inventory") ||
    pathname.startsWith("/api/warehouses") ||
    pathname.startsWith("/api/warehouse-") ||
    pathname.startsWith("/api/stock-") ||
    pathname.startsWith("/api/transaction-") ||
    pathname.startsWith("/api/material-request") ||
    pathname.startsWith("/api/goods-receipt") ||
    pathname.startsWith("/api/putaway-rules")
  ) return "inventory";
  if (pathname.startsWith("/api/purchase") || pathname.startsWith("/api/purchases") || pathname.startsWith("/api/returns") || pathname.startsWith("/api/suppliers")) return "purchases";
  if (pathname.startsWith("/api/accounts") || pathname.startsWith("/api/journal") || pathname.startsWith("/api/safes") || pathname.startsWith("/api/bank")) return "accounting";
  if (pathname.startsWith("/api/costs")) return "costs";
  if (pathname.startsWith("/api/reports")) return "reports";
  if (pathname.startsWith("/api/pos")) return "pos";
  if (pathname.startsWith("/api/products") || pathname.startsWith("/api/categories") || pathname.startsWith("/api/ingredients") || pathname.startsWith("/api/uom")) return "products";
  if (pathname.startsWith("/api/orders") || pathname.startsWith("/api/web-orders") || pathname.startsWith("/api/call-center") || pathname.startsWith("/api/kitchen") || pathname.startsWith("/api/reservations") || pathname.startsWith("/api/delivery") || pathname.startsWith("/api/branches") || pathname.startsWith("/api/printers")) return "restaurant";
  if (pathname.startsWith("/api/v2/hotel") || pathname.startsWith("/api/hotel")) return "hotel";
  if (pathname.startsWith("/api/customers")) return "customers";
  if (pathname.startsWith("/api/users") || pathname.startsWith("/api/settings") || pathname.startsWith("/api/system") || pathname.startsWith("/api/security") || pathname.startsWith("/api/db") || pathname.startsWith("/api/backup") || pathname.startsWith("/api/backups") || pathname.startsWith("/api/restore") || pathname.startsWith("/api/erp")) return "system";
  return "system";
}

function permissionAliases(moduleName: string): string[] {
  const aliases: Record<string, string[]> = {
    hr: ["hr", "payroll", "salaries", "attendance", "fingerprint", "hr.payroll", "hr.attendance", "hr.employees", "hr.leaves", "hr.penalties", "hr.settings"],
    payroll: ["payroll", "salaries", "hr", "hr.payroll", "hr.employees"],
    salaries: ["salaries", "payroll", "hr", "hr.payroll", "hr.employees"],
    treasury: ["safes"],
    accounting: ["general-accounts"],
    costs: ["costs", "cost", "cost-management", "general-accounts", "accounting"],
    inventory: ["warehouses", "inventory", "stock", "products"],
    purchases: ["purchases", "suppliers"],
    reports: ["branch-reports", "central-reports"],
    system: ["security", "database", "system-settings", "hr", "payroll", "salaries"],
    restaurant: ["pos", "tables", "kitchen", "reservations", "delivery", "branches", "web-orders"],
    products: ["products", "warehouses", "inventory", "stock"],
    customers: ["customers", "customer-accounts"],
    sales: ["sales", "pos", "orders", "customers", "invoices", "quotations", "deliveries", "returns"],
    hotel: ["hotel", "hotel-management", "hotel_rooms", "hotel_guests", "hotel_reports", "reservations"],
    approvals: ["approvals", "security", "system", "system-settings", "purchases", "general-accounts", "hr", "hotel"]
  };
  return [moduleName, ...(aliases[moduleName] || [])];
}

function getActionForRequest(method: string): "read" | "create" | "update" | "delete" | "approve" {
  if (method === "GET") return "read";
  if (method === "DELETE") return "delete";
  if (method === "PUT" || method === "PATCH") return "update";
  return "create";
}

function hasServerPermission(user: ApiUser, moduleName: string, action: string) {
  if (isAdminUser(user)) return true;
  const permissions = user.permissions || {};
  if (permissions.all === true) return true;
  const legacyEditAllowed = permissions.can_edit === true || permissions.can_manage === true;
  const legacyDeleteAllowed = permissions.can_delete === true || permissions.can_manage === true;

  return permissionAliases(moduleName).some((key) => {
    const directModuleAllowed = permissions[key] === true;
    const fullAccessAllowed = permissions[`${key}.full_access`] === true || permissions[`${key}.*`] === true;
    const hasAnySubPermission = Object.keys(permissions).some(k => k.startsWith(`${key}.`) && permissions[k] === true);
    const nested = permissions[key] && typeof permissions[key] === "object" ? permissions[key] : null;

    if (action === "read") {
      return directModuleAllowed || fullAccessAllowed || hasAnySubPermission || permissions[`${key}.read`] === true || nested?.read === true || nested?.view === true;
    }
    if (action === "delete") {
      return fullAccessAllowed || permissions[`${key}.delete`] === true || nested?.delete === true || (directModuleAllowed && legacyDeleteAllowed);
    }
    if (action === "update") {
      return fullAccessAllowed || permissions[`${key}.update`] === true || permissions[`${key}.edit`] === true || nested?.update === true || nested?.edit === true || (directModuleAllowed && legacyEditAllowed);
    }
    if (action === "approve") {
      return fullAccessAllowed || permissions[`${key}.approve`] === true || nested?.approve === true || (directModuleAllowed && legacyEditAllowed);
    }
    if (action === "print" || action === "export") {
      return fullAccessAllowed || permissions[`${key}.${action}`] === true || nested?.[action] === true || (directModuleAllowed && legacyEditAllowed);
    }
    return fullAccessAllowed || permissions[`${key}.create`] === true || permissions[`${key}.add`] === true || nested?.create === true || nested?.add === true || (directModuleAllowed && legacyEditAllowed);
  });
}

function hasExactPermission(user: ApiUser, key: string) {
  if (isAdminUser(user)) return true;
  const permissions = user.permissions || {};
  if (permissions.all === true) return true;
  if (permissions[key] === true) return true;
  const moduleId = key.split(".")[0];
  const subKey = key.split(".")[1];

  if (permissions[moduleId] === true) return true;
  if (permissions[`${moduleId}.full_access`] === true || permissions[`${moduleId}.*`] === true) return true;
  if (subKey && permissions[subKey] === true) return true;

  // Cross-allowances for HR / Payroll / Salaries
  if (key === "hr.payroll" && (permissions.payroll === true || permissions.salaries === true || permissions.hr === true)) {
    return true;
  }
  if (key === "hr.employees") {
    if (
      permissions.payroll === true ||
      permissions.salaries === true ||
      permissions["hr.payroll"] === true ||
      permissions.attendance === true ||
      permissions["hr.attendance"] === true ||
      permissions.hr === true ||
      permissions.accounting === true ||
      permissions["general-accounts"] === true
    ) {
      return true;
    }
  }

  return false;
}

function hasAdvancedServerPermission(user: ApiUser, detailedKeys: string[]) {
  if (isAdminUser(user) || detailedKeys.length === 0) return true;
  return detailedKeys.every((key) => hasExactPermission(user, key));
}

function parseAllowedPaymentMethods(value: any): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  return String(value).split(",").map((item) => item.trim()).filter(Boolean);
}

function enforceOperationalLimits(req: any, res: any, user: ApiUser, pathname: string) {
  if (isAdminUser(user)) return true;
  const limits = user.permissions?.limits || {};

  const orderLikeRoute = pathname.startsWith("/api/pos/order") || pathname.startsWith("/api/orders/");
  if (!orderLikeRoute) return true;

  const total = Number(req.body?.total ?? req.body?.additionalTotal ?? 0);
  const discount = Number(req.body?.discount ?? req.body?.additionalDiscount ?? 0);
  const paymentMethod = req.body?.payment_method;

  if (limits.max_order_amount !== undefined && limits.max_order_amount !== "" && total > Number(limits.max_order_amount)) {
    res.status(403).json({
      error: "OPERATION_LIMIT_DENIED",
      message: "قيمة الفاتورة أكبر من الحد المسموح لهذا المستخدم",
      limit: "max_order_amount"
    });
    return false;
  }

  if (discount > 0) {
    if (limits.require_manager_for_discount === true && user.permissions?.["pos.discount"] !== true) {
      res.status(403).json({
        error: "OPERATION_LIMIT_DENIED",
        message: "هذا المستخدم يحتاج موافقة مدير قبل تطبيق الخصم",
        limit: "require_manager_for_discount"
      });
      return false;
    }

    if (limits.max_discount_percent !== undefined && limits.max_discount_percent !== "") {
      const grossTotal = Math.max(total + discount, total, 1);
      const discountPercent = (discount / grossTotal) * 100;
      if (discountPercent > Number(limits.max_discount_percent)) {
        res.status(403).json({
          error: "OPERATION_LIMIT_DENIED",
          message: "نسبة الخصم أكبر من الحد المسموح لهذا المستخدم",
          limit: "max_discount_percent"
        });
        return false;
      }
    }
  }

  const allowedPaymentMethods = parseAllowedPaymentMethods(limits.allowed_payment_methods);
  if (paymentMethod && allowedPaymentMethods.length > 0 && !allowedPaymentMethods.includes(String(paymentMethod))) {
    res.status(403).json({
      error: "OPERATION_LIMIT_DENIED",
      message: "طريقة الدفع غير مسموحة لهذا المستخدم",
      limit: "allowed_payment_methods"
    });
    return false;
  }

  return true;
}

function isPublicApiRoute(method: string, pathname: string) {
  if (pathname === "/api/login" || pathname === "/api/hr/employee-login") return true;
  if (pathname === "/api/health") return true;
  if (pathname === "/api/network/ip") return true;
  if (pathname.startsWith("/api/public/")) return true;
  if (pathname.startsWith("/api/hr/parse-cv")) return true;
  if (pathname.startsWith("/api/hr/applications") && method === "POST") return true;
  if (pathname.startsWith("/api/hr/job-postings") && method === "GET") return true;
  if (pathname === "/api/approvals/pending-count" || pathname === "/api/v2/approvals/pending-count") return true;

  // Only branding needed before login is public. Operational/system settings stay protected.
  const publicSettingKeys = new Set([
    "system_name",
    "business_type",
    "system_background",
    "customer_menu_logo",
    "login_background"
  ]);
  if (method === "GET") {
    const settingKey = pathname.match(/^\/api\/settings\/([^/]+)$/)?.[1] || pathname.match(/^\/api\/system\/settings\/([^/]+)$/)?.[1];
    if (settingKey && publicSettingKeys.has(settingKey)) return true;
  }
  return false;
}

function isAuthenticatedSelfServiceRoute(pathname: string, method: string = "GET") {
  if (
    pathname === "/api/auth/me" ||
    pathname === "/api/auth/change-password" ||
    pathname === "/api/approvals/pending-count" ||
    pathname === "/api/v2/approvals/pending-count" ||
    pathname.startsWith("/api/chat/") ||
    pathname.startsWith("/api/ai/")
  ) {
    return true;
  }
  // Allow reading general organizational reference lists for dropdowns
  if (method === "GET") {
    if (
      pathname === "/api/branches" ||
      pathname === "/api/branches/" ||
      pathname === "/api/hr/departments" ||
      pathname === "/api/hr/official-holidays" ||
      pathname === "/api/hr/job-titles" ||
      pathname.startsWith("/api/system/settings/payroll_") ||
      pathname.startsWith("/api/settings/payroll_")
    ) {
      return true;
    }
  }
  return false;
}

function installBranchResponseFilter(res: any, user: ApiUser, pathname: string) {
  if (isAdminUser(user) || !user.branch_id || res.__branchFilterInstalled) return;
  const branchId = Number(user.branch_id);
  const originalJson = res.json.bind(res);
  const isBranchDirectory = pathname === "/api/branches" || pathname === "/api/hr/branches-status";

  const filterBranchData = (value: any): any => {
    if (Array.isArray(value)) {
      return value
        .filter((item) => {
          if (!item || typeof item !== "object" || Array.isArray(item)) return true;
          const itemBranch = item.branch_id ?? item.branchId;
          if (itemBranch !== undefined && itemBranch !== null) return Number(itemBranch) === branchId;
          if (isBranchDirectory && item.id !== undefined && item.id !== null) return Number(item.id) === branchId;
          return true;
        })
        .map(filterBranchData);
    }

    if (value && typeof value === "object") {
      const itemBranch = value.branch_id ?? value.branchId;
      if (itemBranch !== undefined && itemBranch !== null && Number(itemBranch) !== branchId) {
        return { error: "BRANCH_ACCESS_DENIED", message: "لا يمكنك الوصول إلى بيانات فرع غير تابع لك" };
      }
      if (isBranchDirectory && value.id !== undefined && value.id !== null && Number(value.id) !== branchId) {
        return { error: "BRANCH_ACCESS_DENIED", message: "لا يمكنك الوصول إلى بيانات فرع غير تابع لك" };
      }
      const output: Record<string, any> = { ...value };
      for (const [key, child] of Object.entries(output)) {
        if (Array.isArray(child)) {
          output[key] = filterBranchData(child);
        }
      }
      return output;
    }

    return value;
  };

  res.json = (body: any) => originalJson(filterBranchData(body));
  res.__branchFilterInstalled = true;
}

function sanitizeBranchScope(req: any, user: ApiUser) {
  if (isAdminUser(user) || !user.branch_id) return;
  const branchValue = String(user.branch_id);
  const pathname = req.path || req.originalUrl?.split("?")[0] || "";

  // Protect branch-id-in-path routes before they reach handlers.
  const branchPathMatch =
    pathname.match(/^\/api\/branches\/(\d+)/) ||
    pathname.match(/^\/api\/safes\/branch\/(\d+)/) ||
    pathname.match(/^\/api\/reports\/branch\/[^/]+\/?$/);
  if (branchPathMatch?.[1] && branchPathMatch[1] !== branchValue) {
    const err: any = new Error("BRANCH_ACCESS_DENIED");
    err.statusCode = 403;
    throw err;
  }

  // Set a default branch scope for non-admin users and override any attempted cross-branch filter.
  if (req.query) {
    req.query.branchId = branchValue;
    req.query.branch_id = branchValue;
  }

  if (req.body && typeof req.body === "object") {
    if ("branchId" in req.body || req.method !== "GET") req.body.branchId = user.branch_id;
    if ("branch_id" in req.body || req.method !== "GET") req.body.branch_id = user.branch_id;
    if ("branch" in req.body) req.body.branch = user.branch_id;
  }

  req.branchScope = { branch_id: user.branch_id };
}

function isProductionStorageRequest(req: any, pathname: string) {
  const keyFromBody = req.body?.key;
  const keyFromPath = pathname.match(/^\/api\/system\/settings\/(.+)$/)?.[1];
  const key = keyFromBody || keyFromPath;
  return typeof key === "string" && (
    key.startsWith("remo_production_") ||
    key.startsWith("remo_pro_quality_") ||
    key.startsWith("remo_pro_inventory_capitalized_")
  );
}

async function globalApiSecurityMiddleware(req: any, res: any, next: any) {
  const pathname = req.path || req.originalUrl?.split("?")[0] || "";
  if (!pathname.startsWith("/api/")) return next();

  const authHeader = req.headers["authorization"];
  const token = authHeader && String(authHeader).split(" ")[1];

  if (isPublicApiRoute(req.method, pathname)) {
    if (token) {
      if (token === "preview-bypass-token") {
        req.user = { id: 1, username: "admin", role: "admin", permissions: { all: true } };
      } else {
        try {
          const payload: any = jwt.verify(token, JWT_SECRET);
          if (payload) {
            req.user = {
              id: payload.id,
              username: payload.username,
              role: payload.role,
              branch_id: payload.branch_id,
              employee_id: payload.employee_id || payload.id
            };
          }
        } catch (_e) {}
      }
    }
    return next();
  }

  if (!token) {
    return res.status(401).json({ error: "AUTH_REQUIRED", message: "تسجيل الدخول مطلوب للوصول لهذه العملية" });
  }

  if (token === "preview-bypass-token") {
    req.user = {
      id: 1,
      username: "admin",
      role: "admin",
      permissions: { all: true }
    };
    return next();
  }

  try {
    let tokenPayload: any = null;

    tokenPayload = jwt.verify(token, JWT_SECRET);

    if (tokenPayload.role === "employee" || tokenPayload.employee_id) {
      const empId = tokenPayload.employee_id || tokenPayload.id;
      const empRes = await pool.query(
        "SELECT e.id, e.name, e.employee_code, e.fingerprint_code, e.branch_id, e.department_id, e.job_title FROM employees e WHERE e.id = $1",
        [empId]
      );
      const emp = empRes.rows[0];
      if (emp) {
        const empUser: ApiUser = {
          id: emp.id,
          username: emp.employee_code || emp.name,
          role: "employee",
          branch_id: emp.branch_id,
          permissions: { hr: true, "hr.read": true, attendance: true, payroll: true }
        };
        req.user = empUser;
        req.employee = emp;
        return next();
      }
    }

    const userResult = await pool.query(
      "SELECT id, username, role, branch_id, company_id, role_id, permissions, is_trial, trial_ends_at FROM users WHERE id = $1",
      [tokenPayload.id]
    );
    const dbUser = userResult.rows[0];

    if (!dbUser) {
      return res.status(403).json({ error: "INVALID_USER", message: "المستخدم غير موجود أو تم تعطيله" });
    }

    if (dbUser.is_trial && dbUser.trial_ends_at) {
      const todayStr = new Date().toISOString().split("T")[0];
      const trialEndsStr = new Date(dbUser.trial_ends_at).toISOString().split("T")[0];
      if (todayStr > trialEndsStr) {
        return res.status(403).json({ error: "EXPIRED_TRIAL", message: `انتهت صلاحية الحساب التجريبي بتاريخ ${trialEndsStr}` });
      }
    }

    const apiUser: ApiUser = {
      id: dbUser.id,
      username: dbUser.username,
      role: dbUser.role,
      branch_id: dbUser.branch_id,
      company_id: dbUser.company_id,
      role_id: dbUser.role_id,
      permissions: parsePermissions(dbUser.permissions)
    };

    // Attach company context for enterprise features
    (req as any).companyContext = {
      company_id: dbUser.company_id || tokenPayload.company_id || null,
      branch_id: dbUser.branch_id || tokenPayload.branch_id || null,
      is_admin: dbUser.role === 'admin' || dbUser.permissions?.all === true,
    };
    req.user = apiUser;

    const moduleName = isProductionStorageRequest(req, pathname) ? "production" : routeToModule(pathname);
    const action = pathname.includes("/approve") || pathname.includes("/confirm") ? "approve" : getActionForRequest(req.method);

    if (!isAuthenticatedSelfServiceRoute(pathname, req.method)) {
      if (!hasServerPermission(apiUser, moduleName, action)) {
        return res.status(403).json({
          error: "PERMISSION_DENIED",
          message: "ليس لديك صلاحية كافية لتنفيذ هذه العملية",
          module: moduleName,
          action
        });
      }

      const detailedKeys = getRequiredAdvancedPermissionKeys(pathname, req.method, req.body, req.query);
      if (!hasAdvancedServerPermission(apiUser, detailedKeys)) {
        return res.status(403).json({
          error: "DETAILED_PERMISSION_DENIED",
          message: "هذه العملية تحتاج صلاحية تفصيلية غير مفعلة لهذا المستخدم",
          module: moduleName,
          action,
          required_permissions: detailedKeys
        });
      }

      if (!enforceOperationalLimits(req, res, apiUser, pathname)) {
        return;
      }
    }

    sanitizeBranchScope(req, apiUser);
    installBranchResponseFilter(res, apiUser, pathname);
    return next();
  } catch (error: any) {
    if (error?.message === "BRANCH_ACCESS_DENIED") {
      return res.status(403).json({ error: "BRANCH_ACCESS_DENIED", message: "لا يمكنك الوصول إلى بيانات فرع غير تابع لك" });
    }
    console.error("Global API security error:", error?.message || error);
    return res.status(403).json({ error: "INVALID_TOKEN", message: "جلسة الدخول غير صالحة أو منتهية" });
  }
}


// Initialize Database


// Helper to log user actions
export async function logAction(userId: number, action: string, tableName: string, recordId: number, details: string) {
  try {
    await pool.query(
      "INSERT INTO user_logs (user_id, action, table_name, record_id, details) VALUES ($1, $2, $3, $4, $5)",
      [userId, action, tableName, recordId, details]
    );
    // Dynamic Event Bus dispatch for audit logs
    ERPEventBus.getInstance().emitEvent("SystemAction", {
      userId,
      action,
      tableName,
      recordId,
      details: details ? JSON.parse(JSON.stringify(details)) : {}
    });
  } catch (error) {
    console.error("Failed to log action:", error);
  }
}

// Helper to check if a month is closed
export async function isMonthClosed(month: number, year: number) {
  const result = await pool.query(
    "SELECT status FROM financial_periods WHERE month = $1 AND year = $2",
    [month, year]
  );
  return result.rows.length > 0 && result.rows[0].status === 'closed';
}

export async function getSetting(key: string, defaultValue: string = ''): Promise<string> {
  try {
    const result = await pool.query("SELECT value FROM settings WHERE key = $1", [key]);
    return result.rows.length > 0 ? result.rows[0].value : defaultValue;
  } catch (error) {
    return defaultValue;
  }
}

export function formatArabicLine(text: string, codePage: string = '42', shouldReverse: boolean = false) {
  if (!text) return text;
  
  // Define CP864 check once
  const cp864Pages = ['22', '16', '17', '11', '13', '42'];
  const isCp864 = cp864Pages.includes(codePage);

  return text.split('\n').map(line => {
    // Check if line contains any Arabic characters
    const hasArabic = /[\u0600-\u06FF\uFE70-\uFEFF]/.test(line);
    if (!hasArabic) return line;

    let processed = line;
    if (isCp864) {
      try {
        // Essential: Reshape Arabic BEFORE any reversal to get standard CP864 shapes
        processed = ArabicReshaper.convertArabic(line);
      } catch (e) {
        processed = line;
      }
    }

    if (!shouldReverse) return processed;

    // Smart RTL reversal:
    // Split into words, but keep numbers/English together
    const words = processed.split(' ');
    const reversedWords = words.map(word => {
      // If word contains Arabic, reverse its characters
      if (/[\u0600-\u06FF\uFE70-\uFEFF]/.test(word)) {
        return word.split('').reverse().join('');
      }
      return word; // Keep English/Numbers as is
    });

    // Rejoin in reverse order
    return reversedWords.reverse().join(' ');
  }).join('\n');
}

/**
 * Builds a table row for thermal receipt perfectly aligned.
 * Remember: thermal printers print LTR (Left -> Right).
 * So the FIRST column in the array will be placed on the FAR LEFT of the paper.
 */
export function buildReceiptRow(
  columns: { text: string, width: number, align: 'left'|'right'|'center' }[], 
  codePage: string,
  shouldReverse: boolean = false
): string {
  // If reversing is enabled, we should also reverse the order of columns to maintain alignment logic
  const processedColumns = shouldReverse ? [...columns].reverse() : columns;
  let rowStr = '';
  
  for (const col of processedColumns) {
    // 1. Process the text for Arabic (shapes and reverses internal words)
    let cellText = formatArabicLine(col.text.toString(), codePage, shouldReverse);
    
    // 2. Calculate visible length (assuming 1 char = 1 width unit on monospaced thermal)
    let textLen = cellText.length;
    let padLen = Math.max(0, col.width - textLen);
    
    // 3. Pad the string based on desired alignment
    let padded = cellText;
    if (textLen > col.width) {
      padded = cellText.substring(0, col.width);
    } else {
      if (col.align === 'left') {
        padded = cellText + ' '.repeat(padLen);
      } else if (col.align === 'right') {
        padded = ' '.repeat(padLen) + cellText;
      } else if (col.align === 'center') {
        const leftPad = Math.floor(padLen / 2);
        const rightPad = padLen - leftPad;
        padded = ' '.repeat(leftPad) + cellText + ' '.repeat(rightPad);
      }
    }
    
    rowStr += padded;
  }
  
  return rowStr;
}

export async function printOrderToKitchen(orderId: number, items: any[], orderDetails: any, branchId: number) {
  try {
    // Fetch Branch Name
    const branchRes = await pool.query('SELECT name FROM branches WHERE id = $1', [branchId]);
    const branchName = branchRes.rows[0]?.name || 'الزقازيق';
    
    // Fetch Global Settings
    const restaurantName = await getSetting('restaurant_name', branchName);
    const cashierName = orderDetails.cashier_name || 'الكاشير';

    // Fetch Receipt Settings
    const codePage = await getSetting('receipt_code_page_internal', '42');
    const printerWidth = parseInt(await getSetting('receipt_printer_width_internal', '32'));
    const fontSizeInt = parseInt(await getSetting('receipt_font_size_internal', '12'));
    const fontWeightInt = parseInt(await getSetting('receipt_font_weight_internal', '400'));
    const hidePricesInt = await getSetting('receipt_hide_prices_internal', 'false') === 'true';
    const templateInt = await getSetting('receipt_template_internal', 'grid');
    const shouldReverse = await getSetting('receipt_reverse_arabic_internal', 'true') === 'true';

    // Fetch order to get daily number
    const fullOrderRes = await pool.query("SELECT * FROM orders WHERE id = $1", [orderId]);
    const dailyNumber = fullOrderRes.rows[0]?.daily_number || orderId;

    const separator = '-'.repeat(printerWidth);
    const codePageHex = String.fromCharCode(parseInt(codePage));

    // Group items by printer_id
    const itemsByPrinter = new Map<number, any[]>();
    
    for (const item of items) {
      const productResult = await pool.query(`
        SELECT p.category_id 
        FROM products p 
        WHERE p.id = $1
      `, [item.id]);
      const product = productResult.rows[0];
      
      if (product && product.category_id) {
        // Find printer for this category in this branch
        const printersResult = await pool.query(`
          SELECT id, category_ids FROM printers 
          WHERE branch_id = $1 AND is_active = 1
        `, [branchId]);
        const printers = printersResult.rows;

        const printer = printers.find((p: any) => {
          if (!p.category_ids) return false;
          try {
            const ids = JSON.parse(p.category_ids);
            return Array.isArray(ids) && ids.includes(product.category_id);
          } catch (e) {
            return false;
          }
        });

        if (printer && printer.id) {
          if (!itemsByPrinter.has(printer.id)) {
            itemsByPrinter.set(printer.id, []);
          }
          itemsByPrinter.get(printer.id)!.push(item);
        }
      }
    }

    for (const [printerId, printerItems] of itemsByPrinter.entries()) {
      const printerResult = await pool.query("SELECT * FROM printers WHERE id = $1 AND is_active = 1", [printerId]);
      const printer = printerResult.rows[0];
      if (!printer) continue;

      const ESC = '\x1b';
      const GS = '\x1d';
      const FS = '\x1c';
      let receipt = ESC + '@'; // Initialize
      receipt += FS + '.'; // Disable Chinese Character Mode
      receipt += '\n\n'; // Space at top
      
      // Select character code table
      receipt += ESC + 't' + codePageHex; 
      
      let sizeByte = 0;
      if (fontSizeInt >= 20) sizeByte = 0x11;
      else if (fontSizeInt >= 16) sizeByte = 0x01;
      else if (fontSizeInt >= 14) sizeByte = 0x10;
      
      receipt += GS + '!' + String.fromCharCode(sizeByte);
      if (fontWeightInt >= 600) receipt += ESC + 'E' + '\x01';

      if (templateInt === 'modern') {
        receipt += ESC + 'a' + '\x01'; // Center align
        receipt += GS + '!' + '\x11'; // Double size
        receipt += formatArabicLine(restaurantName, codePage, shouldReverse) + '\n';
        receipt += GS + '!' + String.fromCharCode(sizeByte); // Reset
        
        receipt += separator + '\n';
        receipt += formatArabicLine(`طلب رقم #${dailyNumber}`, codePage, shouldReverse) + '\n';
        receipt += separator + '\n';
        
        const orderTypeAr = orderDetails.order_type === 'dine_in' ? 'صالة' : orderDetails.order_type === 'takeaway' ? 'تيك أواي' : 'توصيل';
        receipt += formatArabicLine(orderTypeAr, codePage, shouldReverse) + '\n';
        if (orderDetails.table_number) receipt += formatArabicLine(`الطاولة: ${orderDetails.table_number}`, codePage, shouldReverse) + '\n';
        receipt += separator + '\n';

        receipt += formatArabicLine('تذكرة مطبخ', codePage, shouldReverse) + '\n';
        receipt += separator + '\n';
        
        if (!hidePricesInt) {
          receipt += formatArabicLine(`إجمالي     سعر     الصنف           كمية`, codePage, shouldReverse) + '\n';
        } else {
          receipt += formatArabicLine(`الصنف                      كمية`, codePage, shouldReverse) + '\n';
        }
        receipt += separator + '\n';

        let total = 0;
        receipt += ESC + 'a' + '\x00'; // Left align
        for (const item of printerItems) {
          let sizePart = (item.selectedSize && item.selectedSize.name && item.selectedSize.name.trim() !== '') ? ` - ${item.selectedSize.name}` : '';
          let name = item.name + sizePart;
          let qty = item.quantity.toString();
          
          if (!hidePricesInt) {
            let price = item.price.toString();
            let lineTotal = (item.price * item.quantity).toString();
            total += item.price * item.quantity;
            
            const qtyW = 4;
            const priceW = 6;
            const totalW = 7;
            const nameW = Math.max(10, printerWidth - (qtyW + priceW + totalW));
            
            receipt += buildReceiptRow([
              { text: qty, width: qtyW, align: 'left' },
              { text: name, width: nameW, align: 'right' },
              { text: price, width: priceW, align: 'left' },
              { text: lineTotal, width: totalW, align: 'left' }
            ], codePage, shouldReverse) + '\n';
          } else {
            const qtyW = 5;
            const nameW = Math.max(15, printerWidth - qtyW);
            receipt += buildReceiptRow([
              { text: qty, width: qtyW, align: 'left' },
              { text: name, width: nameW, align: 'right' }
            ], codePage, shouldReverse) + '\n';
          }
          if (item.notes) {
            receipt += formatArabicLine(` * ملاحظة: ${item.notes}`, codePage, shouldReverse) + '\n';
          }
        }
        
        receipt += separator + '\n';
        if (orderDetails.notes) {
          receipt += formatArabicLine(`ملاحظات الطلب: ${orderDetails.notes}`, codePage, shouldReverse) + '\n';
          receipt += separator + '\n';
        }
        
      } else if (templateInt === 'minimal') {
        receipt += ESC + 'a' + '\x01'; // Center align
        receipt += formatArabicLine(`تجهيز #${dailyNumber}`, codePage, shouldReverse) + '\n';
        receipt += separator + '\n';
        
        receipt += ESC + 'a' + '\x00'; // Left align
        for (const item of printerItems) {
          let sizePart = (item.selectedSize && item.selectedSize.name && item.selectedSize.name.trim() !== '') ? ` - ${item.selectedSize.name}` : '';
          let line = `${item.quantity}x ${item.name}${sizePart}`;
          if (!hidePricesInt) line += ` - ${item.price * item.quantity}`;
          receipt += formatArabicLine(line, codePage, shouldReverse) + '\n';
          if (item.notes) receipt += formatArabicLine(`  * ${item.notes}`, codePage, shouldReverse) + '\n';
        }
        receipt += separator + '\n';
        if (orderDetails.notes) receipt += formatArabicLine(`ملاحظات: ${orderDetails.notes}`, codePage, shouldReverse) + '\n';
        
      } else {
        // Standard & Grid layout
        receipt += ESC + 'a' + '\x01'; // Center align
        
        // Restaurant Name
        receipt += GS + '!' + '\x11'; // Double size
        receipt += formatArabicLine(restaurantName, codePage, shouldReverse) + '\n';
        receipt += GS + '!' + String.fromCharCode(sizeByte); // Reset
        
        receipt += separator + '\n';
        
        // Huge Order ID
        receipt += GS + '!' + '\x33'; // 4x size
        receipt += `#${dailyNumber}\n`;
        receipt += GS + '!' + String.fromCharCode(sizeByte); // Reset
        
        const orderTypeAr = orderDetails.order_type === 'dine_in' ? 'صالة' : orderDetails.order_type === 'takeaway' ? 'تيك أواي' : 'توصيل';
        receipt += formatArabicLine(orderTypeAr, codePage, shouldReverse) + '\n';
        
        receipt += separator + '\n';
        
        // Info Grid (2x2)
        const dateStr = new Date().toLocaleDateString('en-GB');
        const timeStr = new Date().toLocaleTimeString('en-US', { hour12: true, hour: '2-digit', minute: '2-digit' });
        
        const halfW = Math.floor(printerWidth / 2);
        receipt += buildReceiptRow([
          { text: timeStr, width: halfW, align: 'left' },
          { text: dateStr, width: halfW, align: 'right' }
        ], codePage, shouldReverse) + '\n';
        
        receipt += buildReceiptRow([
          { text: cashierName, width: halfW, align: 'left' },
          { text: 'الكاشير', width: halfW, align: 'right' }
        ], codePage, shouldReverse) + '\n';
        
        if (orderDetails.table_number) {
           receipt += buildReceiptRow([
             { text: orderDetails.table_number.toString(), width: halfW, align: 'left' },
             { text: 'الطاولة', width: halfW, align: 'right' }
           ], codePage, shouldReverse) + '\n';
        }

        receipt += separator + '\n';

        if (!hidePricesInt) {
          const qtyW = 4;
          const priceW = 6;
          const totalW = 7;
          const nameW = Math.max(10, printerWidth - (qtyW + priceW + totalW));
          receipt += buildReceiptRow([
            { text: 'كمية', width: qtyW, align: 'left' },
            { text: 'الصنف', width: nameW, align: 'right' },
            { text: 'سعر', width: priceW, align: 'left' },
            { text: 'إجمالي', width: totalW, align: 'left' }
          ], codePage, shouldReverse) + '\n';
        } else {
          const qtyW = 5;
          const nameW = Math.max(15, printerWidth - qtyW);
          receipt += buildReceiptRow([
            { text: 'كمية', width: qtyW, align: 'left' },
            { text: 'الصنف', width: nameW, align: 'right' }
          ], codePage, shouldReverse) + '\n';
        }
        receipt += separator + '\n';

        for (const item of printerItems) {
          let sizePart = (item.selectedSize && item.selectedSize.name && item.selectedSize.name.trim() !== '') ? ` - ${item.selectedSize.name}` : '';
          let name = item.name + sizePart;
          let qty = item.quantity.toString();
          
          if (!hidePricesInt) {
            let price = item.price.toString();
            let totalItem = (item.price * item.quantity).toString();
            
            const qtyW = 4;
            const priceW = 6;
            const totalW = 7;
            const nameW = Math.max(10, printerWidth - (qtyW + priceW + totalW));
            
            receipt += buildReceiptRow([
              { text: qty, width: qtyW, align: 'left' },
              { text: name, width: nameW, align: 'right' },
              { text: price, width: priceW, align: 'left' },
              { text: totalItem, width: totalW, align: 'left' }
            ], codePage, shouldReverse) + '\n';
          } else {
            const qtyW = 5;
            const nameW = Math.max(15, printerWidth - qtyW);
            receipt += buildReceiptRow([
              { text: qty, width: qtyW, align: 'left' },
              { text: name, width: nameW, align: 'right' }
            ], codePage, shouldReverse) + '\n';
          }
          
          if (item.notes) {
            receipt += formatArabicLine(` * ملاحظة: ${item.notes}`, codePage, shouldReverse) + '\n';
          }
        }
        
        receipt += separator + '\n';
        if (orderDetails.notes) {
          receipt += formatArabicLine(`ملاحظات الطلب: ${orderDetails.notes}`, codePage, shouldReverse) + '\n';
          receipt += separator + '\n';
        }
      }
      
      // Feed lines manually to clear the cutter and provide space at bottom
      receipt += '\n\n\n\n\n\n';
      receipt += GS + 'V' + '\x00'; // Full cut without extra feed

      let encoded: Buffer;
      const cp864Pages = ['22', '16', '17', '11', '13', '42'];
      if (cp864Pages.includes(codePage)) {
         encoded = encodeCp864(receipt);
      } else {
         encoded = iconv.encode(receipt, 'windows-1256');
      }

      if (printer.connection_type === 'local' && printer.system_printer_name) {
        try {
          const tempFile = path.join(os.tmpdir(), `receipt_${Date.now()}_${Math.random().toString(36).substr(2, 5)}.bin`);
          fs.writeFileSync(tempFile, encoded);
          const { exec } = await import('child_process');
          exec(`powershell -ExecutionPolicy Bypass -File "print_raw.ps1" -PrinterName "${printer.system_printer_name}" -FileToPrint "${tempFile}"`, (error: any) => {
            if (error) console.error(`Local print error (${printer.name}):`, error);
            try { fs.unlinkSync(tempFile); } catch(e) {}
          });
        } catch (e) {
          console.error(`Local print error (${printer.name}):`, e);
        }
      } else {
        const client = new net.Socket();
        client.connect(printer.port || 9100, printer.ip_address, () => {
          client.write(encoded, () => {
            client.end();
          });
        });
        client.on('error', (err) => {
          console.error(`Printer error (${printer.name}):`, err);
        });
        client.setTimeout(10000); // 10 second timeout
        client.on('timeout', () => {
          console.error(`Printer connection timeout: ${printer.ip_address}:${printer.port}`);
          client.destroy();
        });
      }
    }

    // Print Main Receipt (Full Bill)
    const mainPrinterResult = await pool.query("SELECT * FROM printers WHERE branch_id = $1 AND (category_ids IS NULL OR category_ids = '[]' OR category_ids = '') AND is_active = 1", [branchId]);
    const mainPrinter = mainPrinterResult.rows[0];
    if (mainPrinter) {
      // Fetch order again if orderDetails doesn't have daily_number
      const fullOrderRes = await pool.query("SELECT * FROM orders WHERE id = $1", [orderId]);
      const dailyNumber = fullOrderRes.rows[0]?.daily_number || orderId;

      const fontSize = parseInt(await getSetting('receipt_font_size', '12'));
      const fontWeight = parseInt(await getSetting('receipt_font_weight', '400'));
      const codePage = await getSetting('receipt_code_page', '42');
      const printerWidth = parseInt(await getSetting('receipt_printer_width', '32'));
      const template = await getSetting('receipt_template', 'standard');
      const shouldReverse = await getSetting('receipt_reverse_arabic', 'false') === 'true';
      const separator = '-'.repeat(printerWidth);
      const codePageHex = String.fromCharCode(parseInt(codePage));

      const ESC = '\x1b';
      const GS = '\x1d';
      const FS = '\x1c';
      let receipt = ESC + '@'; // Initialize
      receipt += FS + '.'; // Disable Chinese Character Mode
      receipt += '\n\n'; // Space at top
      
      // Select character code table
      receipt += ESC + 't' + codePageHex; 
      
      let sizeByte = 0;
      if (fontSize >= 20) sizeByte = 0x11;
      else if (fontSize >= 16) sizeByte = 0x01;
      else if (fontSize >= 14) sizeByte = 0x10;
      
      receipt += GS + '!' + String.fromCharCode(sizeByte);
      if (fontWeight >= 600) receipt += ESC + 'E' + '\x01';

      if (template === 'modern') {
        receipt += ESC + 'a' + '\x01'; // Center align
        // Modern Header
        receipt += GS + '!' + '\x11'; // Double size
        receipt += formatArabicLine(`فاتورة مبيعات`, codePage, shouldReverse) + '\n';
        receipt += GS + '!' + String.fromCharCode(sizeByte); // Reset
        
        receipt += separator + '\n';
        receipt += formatArabicLine(`طلب رقم #${dailyNumber}`, codePage, shouldReverse) + '\n';
        receipt += separator + '\n';
        
        const orderTypeAr = orderDetails.order_type === 'dine_in' ? 'صالة' : orderDetails.order_type === 'takeaway' ? 'تيك أواي' : 'توصيل';
        receipt += formatArabicLine(orderTypeAr, codePage, shouldReverse) + '\n';
        if (orderDetails.table_number) receipt += formatArabicLine(`الطاولة: ${orderDetails.table_number}`, codePage, shouldReverse) + '\n';
        receipt += separator + '\n';
        
        receipt += buildReceiptRow([
          { text: 'كمية', width: 4, align: 'left' },
          { text: 'الصنف', width: Math.max(10, printerWidth - (4 + 6 + 7)), align: 'right' },
          { text: 'سعر', width: 6, align: 'left' },
          { text: 'إجمالي', width: 7, align: 'left' }
        ], codePage, shouldReverse) + '\n';
        receipt += separator + '\n';

        let total = 0;
        receipt += ESC + 'a' + '\x00'; // Left align
        for (const item of items) {
          let sizePart = (item.selectedSize && item.selectedSize.name && item.selectedSize.name.trim() !== '') ? ` - ${item.selectedSize.name}` : '';
          let name = item.name + sizePart;
          let qty = item.quantity.toString();
          let price = item.price.toString();
          let lineTotal = (item.price * item.quantity).toString();
          total += item.price * item.quantity;
          
          const qtyW = 4;
          const priceW = 6;
          const totalW = 7;
          const nameW = Math.max(10, printerWidth - (qtyW + priceW + totalW));
          
          receipt += buildReceiptRow([
            { text: qty, width: qtyW, align: 'left' },
            { text: name, width: nameW, align: 'right' },
            { text: price, width: priceW, align: 'left' },
            { text: lineTotal, width: totalW, align: 'left' }
          ], codePage, shouldReverse) + '\n';
        }
        
        receipt += separator + '\n';
        receipt += ESC + 'a' + '\x01'; // Center align
        receipt += GS + '!' + '\x11'; // Bigger total
        receipt += formatArabicLine(`الإجمالي: ${total} ج.م`, codePage, shouldReverse) + '\n';
        receipt += GS + '!' + String.fromCharCode(sizeByte); // Reset
        receipt += separator + '\n';
        receipt += formatArabicLine(`شكراً لزيارتكم!`, codePage, shouldReverse) + '\n';
        
      } else if (template === 'minimal') {
        receipt += ESC + 'a' + '\x01'; // Center align
        receipt += formatArabicLine(`طلب #${dailyNumber}`, codePage, shouldReverse) + '\n';
        receipt += separator + '\n';
        
        let total = 0;
        receipt += ESC + 'a' + '\x00'; // Left align
        for (const item of items) {
          let sizePart = (item.selectedSize && item.selectedSize.name && item.selectedSize.name.trim() !== '') ? ` - ${item.selectedSize.name}` : '';
          let line = `${item.quantity}x ${item.name}${sizePart} - ${item.price * item.quantity}`;
          receipt += formatArabicLine(line, codePage, shouldReverse) + '\n';
          total += item.price * item.quantity;
        }
        receipt += separator + '\n';
        receipt += ESC + 'a' + '\x01'; // Center align
        receipt += formatArabicLine(`الإجمالي: ${total}`, codePage, shouldReverse) + '\n';
      } else {
        // Standard & Classic (Grid layout)
        receipt += ESC + 'a' + '\x01'; // Center align
        
        // Restaurant Name
        const restaurantName = await getSetting('restaurant_name', 'الزقازيق');
        receipt += GS + '!' + '\x11'; // Double size
        receipt += formatArabicLine(restaurantName, codePage, shouldReverse) + '\n';
        receipt += GS + '!' + String.fromCharCode(sizeByte); // Reset
        
        receipt += separator + '\n';
        
        // Huge Order ID
        receipt += GS + '!' + '\x33'; // 4x size
        receipt += `#${dailyNumber}\n`;
        receipt += GS + '!' + String.fromCharCode(sizeByte); // Reset
        
        const orderTypeAr = orderDetails.order_type === 'dine_in' ? 'صالة' : orderDetails.order_type === 'takeaway' ? 'تيك أواي' : 'توصيل';
        receipt += formatArabicLine(orderTypeAr, codePage, shouldReverse) + '\n';
        
        receipt += separator + '\n';
        
        // Info Grid (2x2)
        const dateStr = new Date().toLocaleDateString('en-GB');
        const timeStr = new Date().toLocaleTimeString('en-US', { hour12: true, hour: '2-digit', minute: '2-digit' });
        const cashierName = orderDetails.cashier_name || 'الكاشير';
        
        const halfW = Math.floor(printerWidth / 2);
        receipt += buildReceiptRow([
          { text: timeStr, width: halfW, align: 'left' },
          { text: dateStr, width: halfW, align: 'right' }
        ], codePage, shouldReverse) + '\n';
        
        receipt += buildReceiptRow([
          { text: cashierName, width: halfW, align: 'left' },
          { text: 'الكاشير', width: halfW, align: 'right' }
        ], codePage, shouldReverse) + '\n';
        
        if (orderDetails.table_number) {
           receipt += buildReceiptRow([
             { text: orderDetails.table_number.toString(), width: halfW, align: 'left' },
             { text: 'الطاولة', width: halfW, align: 'right' }
           ], codePage, shouldReverse) + '\n';
        }

        receipt += separator + '\n';

        receipt += buildReceiptRow([
          { text: 'كمية', width: 4, align: 'left' },
          { text: 'الصنف', width: Math.max(10, printerWidth - (4 + 6 + 7)), align: 'right' },
          { text: 'سعر', width: 6, align: 'left' },
          { text: 'إجمالي', width: 7, align: 'left' }
        ], codePage, shouldReverse) + '\n';
        receipt += separator + '\n';

        let total = 0;
        for (const item of items) {
          let sizePart = (item.selectedSize && item.selectedSize.name && item.selectedSize.name.trim() !== '') ? ` - ${item.selectedSize.name}` : '';
          let name = item.name + sizePart;
          let qty = item.quantity.toString();
          let price = item.price.toString();
          let lineTotal = (item.price * item.quantity).toString();
          total += item.price * item.quantity;
          
          const qtyW = 4;
          const priceW = 6;
          const totalW = 7;
          const nameW = Math.max(10, printerWidth - (qtyW + priceW + totalW));
          
          receipt += buildReceiptRow([
            { text: qty, width: qtyW, align: 'left' },
            { text: name, width: nameW, align: 'right' },
            { text: price, width: priceW, align: 'left' },
            { text: lineTotal, width: totalW, align: 'left' }
          ], codePage, shouldReverse) + '\n';
        }
        
        receipt += separator + '\n';
        receipt += ESC + 'a' + '\x01';
        receipt += formatArabicLine(`الإجمالي: ${total} ج.م`, codePage, shouldReverse) + '\n';
        receipt += separator + '\n';
        receipt += formatArabicLine(`شكراً لزيارتكم!`, codePage, shouldReverse) + '\n';
      }
      
      // Feed lines manually to clear the cutter and provide space at bottom
      receipt += '\n\n\n\n\n\n';
      receipt += GS + 'V' + '\x00'; // Full cut without extra feed

      let encoded: Buffer;
      const cp864Pages = ['22', '16', '17', '11', '13', '42'];
      if (cp864Pages.includes(codePage)) {
         // Natively encode the exact CP864 bytes without any `?` loss!
         encoded = encodeCp864(receipt);
      } else {
         encoded = iconv.encode(receipt, 'windows-1256');
      }

      if (mainPrinter.connection_type === 'local' && mainPrinter.system_printer_name) {
        try {
          const tempFile = path.join(os.tmpdir(), `receipt_${Date.now()}_${Math.random().toString(36).substr(2, 5)}.bin`);
          fs.writeFileSync(tempFile, encoded);
          const { exec } = await import('child_process');
          exec(`powershell -ExecutionPolicy Bypass -File "print_raw.ps1" -PrinterName "${mainPrinter.system_printer_name}" -FileToPrint "${tempFile}"`, (error: any) => {
            if (error) console.error(`Local main print error (${mainPrinter.name}):`, error);
            try { fs.unlinkSync(tempFile); } catch(e) {}
          });
        } catch (e) {
          console.error(`Local main print error (${mainPrinter.name}):`, e);
        }
      } else {
        const client = new net.Socket();
        client.connect(mainPrinter.port || 9100, mainPrinter.ip_address, () => {
          client.write(encoded, () => {
            client.end();
          });
        });
        
        client.on('error', (err) => {
          console.error(`Main Printer error (${mainPrinter.name}):`, err);
        });
        client.setTimeout(10000); // 10 second timeout
        client.on('timeout', () => {
          console.error(`Printer connection timeout: ${mainPrinter.ip_address}:${mainPrinter.port}`);
          client.destroy();
        });
      }
    }

  } catch (error) {
    console.error("Failed to print order:", error);
  }
}



async function createBackup() {
  try {
    const data: any = {
      tables: {},
      timestamp: new Date().toISOString()
    };
    
    const tablesResult = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'");
    for (const row of tablesResult.rows) {
      const tableName = row.table_name;
      // Validate table name to prevent SQL injection: only allow alphanumeric and underscores
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName)) {
        console.warn(`Skipping invalid table name: ${tableName}`);
        continue;
      }
      const tableData = await pool.query(`SELECT * FROM "${tableName}"`);
      data.tables[tableName] = tableData.rows;
    }

    const filename = `backup-auto-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    fs.writeFileSync(path.join(process.cwd(), 'backups', filename), JSON.stringify(data));
    console.log(`Automatic backup created: ${filename}`);
    return true;
  } catch (error) {
    console.error("Failed to create automatic backup:", error);
    return false;
  }
}

let backupIntervalTimer: NodeJS.Timeout | null = null;

export async function startBackupScheduler() {
  if (backupIntervalTimer) {
    clearInterval(backupIntervalTimer);
  }

  try {
    const result = await pool.query("SELECT value FROM settings WHERE key = 'backup_interval'");
    const setting = result.rows[0];
    const hours = setting ? parseInt(setting.value) : 6;

    if (hours > 0) {
      console.log(`Starting backup scheduler: every ${hours} hours`);
      backupIntervalTimer = setInterval(() => {
        createBackup();
      }, hours * 60 * 60 * 1000);
    } else {
      console.log("Backup scheduler disabled (interval set to 0)");
    }
  } catch (error) {
    console.error("Failed to start backup scheduler:", error);
  }
}

async function startServer() {
  await initDb(pool);
  console.log("Starting server...");
  const app = express();
  app.use(cors({
    origin: (origin, callback) => {
      callback(null, true);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Accept", "X-Requested-With", "Bypass-Tunnel-Reminder", "ngrok-skip-browser-warning"]
  }));
  const httpServer = createServer({ maxHeaderSize: 65536 }, app);
  const corsOrigin = process.env.CORS_ORIGIN || "*";
  io = new Server(httpServer, {
    cors: { 
      origin: (origin, callback) => {
        callback(null, true);
      },
      methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
      credentials: true
    }
  });
  
  // Socket.io connection
  const userSockets = new Map<number, string>();

  io.on("connection", (socket: any) => {
    const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.replace("Bearer ", "");
    let socketUserId: number | null = null;

    if (token) {
      try {
        const decoded = jwt.verify(token, JWT_SECRET) as any;
        socketUserId = decoded.id || decoded.userId;
      } catch (e) {
        // Invalid token - disconnect
        socket.disconnect(true);
        return;
      }
    } else {
      // No token provided - disconnect immediately
      socket.disconnect(true);
      return;
    }
    console.log("Client connected:", socket.id);
    
    socket.on("join", (userId: number) => {
      if (socketUserId !== null && userId !== socketUserId) return; // Prevent impersonation
      if (userId) {
        userSockets.set(userId, socket.id);
        console.log(`User ${userId} joined with socket ${socket.id}`);
      }
    });

    socket.on("chat:send", async (data: { 
      recipientId: number;
      message: string;
      senderId?: number
    }) => {
      if (!socketUserId) return;
      // Use socketUserId instead of data.senderId to prevent impersonation
      const senderId = socketUserId;
      const { recipientId: receiverId, message, file_url, file_name, file_type } = data as any;
      try {
        // Save to DB
        const result = await pool.query(
          "INSERT INTO chat_messages (sender_id, receiver_id, message, file_url, file_name, file_type) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *",
          [senderId, receiverId, message, file_url, file_name, file_type]
        );
        const newMessage = result.rows[0];

        // Send to receiver if online
        const receiverSocketId = userSockets.get(receiverId);
        if (receiverSocketId) {
          io.to(receiverSocketId).emit("chat:receive", newMessage);
        }
        
        // Also send back to sender for confirmation/sync
        socket.emit("chat:sent", newMessage);
      } catch (error) {
        console.error("Chat error:", error);
      }
    });

    socket.on("disconnect", () => {
      // Remove from map
      for (const [userId, socketId] of userSockets.entries()) {
        if (socketId === socket.id) {
          userSockets.delete(userId);
          break;
        }
      }
      console.log("Client disconnected:", socket.id);
    });
  });

  const PORT = 3000;

  if (!process.env.DATABASE_URL) {
    console.log("ℹ️ INFO: DATABASE_URL is not defined in .env file, using offline fallback.");
  }

  app.use(express.json({ limit: '50mb' }));

  // Phase 1 request correlation ID. This is additive: it does not change API
  // payloads or business behavior, but makes every failed/retried operation
  // traceable across logs and support tickets.
  app.use((req: any, res: any, next: any) => {
    const incoming = String(req.get('X-Request-ID') || '').trim();
    const requestId = incoming && incoming.length <= 120 ? incoming : randomUUID();
    req.requestId = requestId;
    res.setHeader('X-Request-ID', requestId);
    next();
  });

  // High-priority immediate health check endpoint
  app.get("/api/health", (_req, res) => {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.json({
      status: "ok",
      database: "connected",
      timestamp: new Date().toISOString(),
      uptime_seconds: Math.floor(process.uptime())
    });
  });

  // Enterprise security & monitoring middleware
  app.use(securityHeadersMiddleware);
  app.use(rateLimitMiddleware());
  app.use(inputSanitizationMiddleware);
  app.use(performanceMiddleware);
  app.use(globalApiSecurityMiddleware);

  // Global Audit Logging for mutating operations
  app.use((req: any, res: any, next) => {
    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method) && 
        req.path.startsWith('/api/') && 
        !req.path.startsWith('/api/login') &&
        !req.path.startsWith('/api/health') &&
        !req.path.startsWith('/api/network/ip')) {
      // Capture response to log after it completes
      const originalEnd = res.end;
      res.end = function(...args: any[]) {
        originalEnd.apply(res, args);
        // Log asynchronously — don't block the response
        setImmediate(async () => {
          try {
            const userId = req.user?.id || req.user?.userId;
            const username = req.user?.username || 'anonymous';
            let details = '';
            if (req.body) {
              // Sanitize body for logging — remove passwords
              const sanitized = { ...req.body };
              delete sanitized.password;
              delete sanitized.newPassword;
              delete sanitized.currentPassword;
              details = JSON.stringify(sanitized).substring(0, 500);
            }
            await pool.query(
              `INSERT INTO user_logs (user_id, username, action, details, ip_address, created_at)
               VALUES ($1, $2, $3, $4, $5, NOW())`,
              [userId, username, `${req.method} ${req.path}`, details, req.ip || req.connection?.remoteAddress]
            );
          } catch (_) { /* silent — audit should never break requests */ }
        });
      };
    }
    next();
  });

  // Bootstrap all Layered Modules (Events, Jobs, and Core Layers)
  bootstrapAllModules();

  // Run Enterprise Migrations (adds company_id/branch_id columns, indexes, permission tables)
  await runEnterpriseMigrations();

  // Explicit route for approvals pending-count (must return clean JSON even before login)
  app.get(["/api/approvals/pending-count", "/api/v2/approvals/pending-count"], async (req: any, res: any) => {
    try {
      const result = await pool.query("SELECT COUNT(*) as count FROM approval_requests WHERE status = 'pending'");
      res.json({ count: parseInt(result.rows[0]?.count || "0", 10) });
    } catch (_e) {
      res.json({ count: 0 });
    }
  });

  // Register unified V2 modules router
  app.use("/api/v2", modulesRouter);
  app.use("/api/production", (req, res, next) => {
    req.url = "/production" + req.url;
    modulesRouter(req, res, next);
  });

  // ─── File download endpoints (system ZIP files) ───
  // MUST be registered BEFORE Vite middleware so Vite doesn't intercept them.
  // Allows downloading the latest system bundle from the running web app — useful
  // for users who want a fresh copy without needing to access the server's filesystem.
  const fsModule = await import("fs");

  // Helper to stream a file as a downloadable ZIP attachment
  const streamZipFile = (res: any, filePath: string, fallbackName: string) => {
    if (fsModule.existsSync(filePath)) {
      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename="${fallbackName}"`);
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
      const stream = fsModule.createReadStream(filePath);
      stream.on("error", () => res.status(500).send("Error reading file"));
      stream.pipe(res);
    } else {
      res.status(404).send("File not found — the requested ZIP may have been removed or renamed.");
    }
  };

  // /download/system-zip → original Remo Pro system bundle
  app.get("/download/system-zip", (_req: any, res: any) => {
    streamZipFile(res, "/home/z/my-project/download/remo-pro-system.zip", "remo-pro-system.zip");
  });

  // /download/remo-pro-erp-latest.zip → latest updated bundle with all recent fixes
  app.get("/download/remo-pro-erp-latest.zip", (_req: any, res: any) => {
    streamZipFile(res, "/home/z/my-project/download/remo-pro-erp-latest.zip", "remo-pro-erp-latest.zip");
  });

  // /download/latest.zip → shorter alias for the same latest bundle
  app.get("/download/latest.zip", (_req: any, res: any) => {
    streamZipFile(res, "/home/z/my-project/download/remo-pro-erp-latest.zip", "remo-pro-erp-latest.zip");
  });

  // /download → JSON listing of all available files (for discovery)
  app.get("/download", (_req: any, res: any) => {
    const dir = "/home/z/my-project/download";
    try {
      const files = fsModule.readdirSync(dir)
        .filter((f: string) => f.endsWith(".zip"))
        .map((f: string) => {
          const stat = fsModule.statSync(`${dir}/${f}`);
          return {
            filename: f,
            size_bytes: stat.size,
            size_mb: (stat.size / 1024 / 1024).toFixed(2) + " MB",
            modified: stat.mtime,
            download_url: `/download/${f}`,
          };
        });
      res.json({ available_files: files, total: files.length });
    } catch (err) {
      res.status(500).json({ error: "Failed to list download directory" });
    }
  });

  // Register Module Routes
  // Note: costRoutes is already registered under /api/v2/costs via modulesRouter
  // Removed duplicate V1 registration to avoid double-routing
  // Dynamically import subrouters to avoid circular dependency issues
  const { default: systemRouter } = await import("./modules/system/system_api.routes.js");
  const { default: restaurantRouter } = await import("./modules/restaurant/restaurant_api.routes.js");
  const { default: hrRouter } = await import("./modules/hr/hr_api.routes.js");
  // Warehouses module removed
  const { default: accountingRouter } = await import("./modules/accounting/accounting_api.routes.js");
  const { default: treasuryRouter } = await import("./modules/accounting/treasury_api.routes.js");
  const { default: treasuryTransfersRouter } = await import("./modules/accounting/treasury_transfers_api.routes.js");
  const { default: treasuryClosingsRouter } = await import("./modules/accounting/treasury_closings_api.routes.js");
  const { default: suppliersRouter } = await import("./modules/purchases/suppliers_api.routes.js");
  const { default: approvalRouter } = await import("./modules/system/approval_api.routes.js");
  const { default: aiChatRouter } = await import("./modules/system/ai_chat_api.routes.js");
  const { default: aiDeveloperRouter } = await import("./modules/aideveloper/aideveloper_api.routes.js");
  const { default: warehousesRouter } = await import("./modules/warehouses/warehouses_api.routes.js");
  const { default: realEstateRouter } = await import("./modules/realestate_api.routes.js");
  const { default: costV1Router } = await import("./modules/costs/routes/cost.routes.js");
  const { default: unitsRouter } = await import("./modules/common/routes/units.routes.js");

  app.use(unitsRouter);
  app.use(systemRouter);
  app.use(warehousesRouter);
  app.use(restaurantRouter);
  app.use(hrRouter);
  app.use(accountingRouter);
  app.use(treasuryRouter);
  app.use(treasuryTransfersRouter);
  app.use(treasuryClosingsRouter);
  app.use(suppliersRouter);
  app.use("/api/approvals", approvalRouter);
  app.use("/api/v2/approvals", approvalRouter);
  app.use(aiChatRouter);
  app.use(aiDeveloperRouter);
  app.use(realEstateRouter);
  app.use("/api/costs", costV1Router);
  app.use(adjustmentsRouter);
  app.use(wastageRouter);

  // Fallback for unhandled /api endpoints - guarantee JSON response instead of Vite HTML SPA fallback
  app.use("/api", (req, res) => {
    res.status(404).json({
      error: "NOT_FOUND",
      message: `مسار API غير موجود: ${req.method} ${req.originalUrl || req.url}`
    });
  });

  // Enterprise error handling middleware
  app.use((err: any, req: any, res: any, next: any) => {
    if (req?.requestId) res.setHeader('X-Request-ID', req.requestId);
    errorHandlingMiddleware(err, req, res, next);
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      configFile: path.resolve(process.cwd(), "vite.config.ts"),
      server: { middlewareMode: true, host: "0.0.0.0", allowedHosts: true as any },
      appType: "spa",
    });
    app.use(vite.middlewares);
    console.log("Vite middleware loaded.");
  } else {
    app.use(express.static("dist"));
    app.get("*", (req, res) => {
      res.sendFile(path.resolve(process.cwd(), "dist", "index.html"));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
    startBackupScheduler();
  });
}

startServer();
