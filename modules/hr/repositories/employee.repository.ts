import { erpPool } from "../../../server-erp-core.js";
import { CreateEmployeeDTO, ClockInOutDTO } from "../dto/employee.dto.js";

export class EmployeeRepository {
  async getAll(): Promise<any[]> {
    const result = await erpPool.query("SELECT * FROM employees ORDER BY id ASC");
    return result.rows;
  }

  async findById(id: number): Promise<any> {
    const result = await erpPool.query("SELECT * FROM employees WHERE id = $1", [id]);
    return result.rows.length > 0 ? result.rows[0] : null;
  }

  async create(dto: CreateEmployeeDTO): Promise<any> {
    const query = `
      INSERT INTO employees (name, role, phone, salary, branch_id) 
      VALUES ($1, $2, $3, $4, $5) 
      RETURNING *
    `;
    const result = await erpPool.query(query, [
      dto.name,
      dto.role,
      dto.phone || null,
      dto.salary || 0,
      dto.branch_id || null
    ]);
    return result.rows[0];
  }

  async clockInOut(dto: ClockInOutDTO): Promise<any> {
    const query = `
      INSERT INTO attendance (employee_id, action_type, notes) 
      VALUES ($1, $2, $3) 
      RETURNING *
    `;
    const result = await erpPool.query(query, [
      dto.employee_id,
      dto.type,
      dto.notes || null
    ]);
    return result.rows[0];
  }
}
