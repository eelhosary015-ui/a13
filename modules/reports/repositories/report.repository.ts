import { erpPool } from "../../../server-erp-core.js";
import { FetchReportDTO } from "../dto/report.dto.js";

export class ReportRepository {
  async getBranchSalesReport(dto: FetchReportDTO): Promise<any[]> {
    const query = `
      SELECT 
        o.branch_id, 
        b.name as branch_name, 
        COALESCE(SUM(o.total_amount), 0) as total_sales,
        COUNT(o.id) as total_orders
      FROM orders o
      LEFT JOIN branches b ON o.branch_id = b.id
      WHERE o.created_at BETWEEN $1 AND $2
        AND ($3::INTEGER IS NULL OR o.branch_id = $3)
      GROUP BY o.branch_id, b.name
    `;
    const result = await erpPool.query(query, [dto.start_date, dto.end_date, dto.branch_id || null]);
    return result.rows;
  }

  async getOperationalProfitability(dto: FetchReportDTO): Promise<any> {
    const salesQuery = `
      SELECT COALESCE(SUM(total_amount), 0) as sales
      FROM orders
      WHERE created_at BETWEEN $1 AND $2
        AND ($3::INTEGER IS NULL OR branch_id = $3)
    `;
    const costsQuery = `
      SELECT COALESCE(SUM(amount), 0) as costs
      FROM operating_costs
      WHERE date BETWEEN $1::DATE AND $2::DATE
        AND ($3::INTEGER IS NULL OR branch_id = $3)
    `;

    const salesRes = await erpPool.query(salesQuery, [dto.start_date, dto.end_date, dto.branch_id || null]);
    const costsRes = await erpPool.query(costsQuery, [dto.start_date, dto.end_date, dto.branch_id || null]);

    const totalSales = Number(salesRes.rows[0].sales || 0);
    const totalCosts = Number(costsRes.rows[0].costs || 0);

    return {
      sales: totalSales,
      costs: totalCosts,
      net_profit: totalSales - totalCosts
    };
  }
}
