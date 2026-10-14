export function isCashPaymentMethod(paymentMethod: string | null | undefined): boolean {
  return String(paymentMethod ?? '').trim().toLowerCase() === 'cash';
}
