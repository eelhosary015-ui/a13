export interface CreateEmployeeDTO {
  name: string;
  role: string;
  phone?: string;
  salary?: number;
  branch_id?: number | null;
}

export interface ClockInOutDTO {
  employee_id: number;
  type: "in" | "out";
  notes?: string;
}
