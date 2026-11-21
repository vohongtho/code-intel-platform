export function calculateTotal(subtotal: number): number {
  const tax = subtotal * 0.12;
  return subtotal + tax;
}

export function formatTotal(total: number): string {
  return `$${total.toFixed(2)}`;
}
