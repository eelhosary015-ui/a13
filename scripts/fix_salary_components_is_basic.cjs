/**
 * Fix script for salary_components with is_basic=true that should be false.
 *
 * Background:
 *   The HR form has a "بند أساسي" (base item) checkbox on every salary
 *   component row. Users routinely tick this for بدلات like "بدل إجازة"
 *   or "بدل سكن", interpreting the flag as "fixed monthly component".
 *   The code's real meaning however is "this IS the base salary row"
 *   (i.e. skip it — it is already represented by emp.basic_salary).
 *   The mismatch caused every such بدل to vanish from the payroll sheet.
 *
 * Backend fix already applied (no longer honors is_basic for skip).
 * This script additionally flips is_basic=false for any component whose
 * name does NOT contain "أساسي" / "basic", so the data stays consistent
 * with the corrected semantics.
 */
const fs = require("fs");
const path = require("path");

const dbFilePath = path.join(__dirname, "..", "backups", "offline-db.json");
const bakFilePath = dbFilePath + ".bak-" + Date.now();

if (!fs.existsSync(dbFilePath)) {
  console.error("✗ offline-db.json not found at", dbFilePath);
  process.exit(1);
}

// Backup
fs.copyFileSync(dbFilePath, bakFilePath);
console.log("✓ Backup written:", bakFilePath);

const raw = fs.readFileSync(dbFilePath, "utf8");
const db = JSON.parse(raw);

if (!Array.isArray(db.employees)) {
  console.error("✗ db.employees is not an array");
  process.exit(1);
}

let fixedCount = 0;
let inspectedComps = 0;

db.employees.forEach((emp) => {
  if (!emp.salary_components) return;
  let comps = emp.salary_components;
  if (typeof comps === "string") {
    try { comps = JSON.parse(comps); } catch { return; }
  }
  if (!Array.isArray(comps)) return;

  let dirty = false;
  comps.forEach((c) => {
    if (!c || !c.name) return;
    inspectedComps++;
    const n = String(c.name).toLowerCase();
    const isActuallyBasic = n.includes("أساسي") || n === "basic" || n.includes("مرتب أساسي");
    if (c.is_basic === true && !isActuallyBasic) {
      c.is_basic = false;
      fixedCount++;
      dirty = true;
    }
  });

  if (dirty) {
    // Preserve original storage format (string vs object)
    if (typeof emp.salary_components === "string") {
      emp.salary_components = JSON.stringify(comps);
    } else {
      emp.salary_components = comps;
    }
  }
});

fs.writeFileSync(dbFilePath, JSON.stringify(db, null, 2), "utf8");
console.log(`✓ Done. Inspected ${inspectedComps} components, fixed ${fixedCount} mis-flagged is_basic=true entries.`);
console.log("✓ offline-db.json updated.");
