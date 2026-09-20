export interface CreateRecipeItemDTO {
  ingredient_id: number;
  quantity: number;
}

export interface CreateRecipeDTO {
  product_id: number;
  name: string;
  items: CreateRecipeItemDTO[];
}
