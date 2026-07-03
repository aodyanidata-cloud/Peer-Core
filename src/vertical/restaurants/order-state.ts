/**
 * Order state machine (R2 🔴). Only legal transitions are permitted; an illegal
 * one is rejected, never coerced.
 *
 * NEW → ACCEPTED → PREPARING → READY → (OUT_FOR_DELIVERY → DELIVERED | PICKED_UP) → COMPLETE
 * with REJECTED / CANCELLED branches. Terminal: COMPLETE, REJECTED, CANCELLED.
 */
export type OrderStatus =
  | 'NEW'
  | 'ACCEPTED'
  | 'PREPARING'
  | 'READY'
  | 'OUT_FOR_DELIVERY'
  | 'PICKED_UP'
  | 'DELIVERED'
  | 'COMPLETE'
  | 'REJECTED'
  | 'CANCELLED';

const LEGAL: Record<OrderStatus, OrderStatus[]> = {
  NEW: ['ACCEPTED', 'REJECTED', 'CANCELLED'],
  ACCEPTED: ['PREPARING', 'CANCELLED'],
  PREPARING: ['READY', 'CANCELLED'],
  READY: ['OUT_FOR_DELIVERY', 'PICKED_UP'],
  OUT_FOR_DELIVERY: ['DELIVERED'],
  PICKED_UP: ['COMPLETE'],
  DELIVERED: ['COMPLETE'],
  COMPLETE: [],
  REJECTED: [],
  CANCELLED: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return LEGAL[from]?.includes(to) ?? false;
}
