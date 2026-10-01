export function calculateTotal(subtotal: number): number {
  const tax = subtotal * 0.1;
  return subtotal + tax;
}

export function formatTotal(total: number): string {
  return `USD ${total.toFixed(2)}`;
}
