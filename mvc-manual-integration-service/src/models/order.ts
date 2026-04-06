export type OrderStatus = 'pending' | 'paid' | 'shipped';

export interface Order {
  id: string;
  userId: string;
  item: string;
  amount: number;
  status: OrderStatus;
}

export interface CreateOrderInput {
  userId: string;
  item: string;
  amount: number;
}
