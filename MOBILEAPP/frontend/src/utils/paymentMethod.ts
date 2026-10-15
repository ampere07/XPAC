const normalizedPaymentMethod = (paymentMethod: string | null | undefined): string =>
  String(paymentMethod ?? '').trim().toLowerCase();

export function isCashPaymentMethod(paymentMethod: string | null | undefined): boolean {
  return normalizedPaymentMethod(paymentMethod) === 'cash';
}

export function isChequePaymentMethod(paymentMethod: string | null | undefined): boolean {
  return ['cheque', 'check'].includes(normalizedPaymentMethod(paymentMethod));
}

export function referenceNumberLabel(paymentMethod: string | null | undefined): string {
  return isChequePaymentMethod(paymentMethod) ? 'Cheque No.' : 'Reference No.';
}
