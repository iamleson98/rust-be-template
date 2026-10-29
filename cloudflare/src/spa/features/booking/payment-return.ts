export interface PaymentReturnLookup {
  /** The booking a payment is for; throws when the caller cannot see it. */
  bookingOf(paymentId: string): Promise<string>;
  /** A booking's ticket code. */
  codeOf(bookingId: string): Promise<string>;
}

/**
 * Where a customer coming back from a payment gateway lands: the ticket the
 * payment is for, which shows how the payment went and keeps checking while
 * the gateway has not said. A payment they cannot see leaves them at their tickets.
 */
export async function paymentReturnTarget(paymentId: string, lookup: PaymentReturnLookup) {
  try {
    const code = await lookup.codeOf(await lookup.bookingOf(paymentId));
    return { to: "/account/trips/$code", params: { code }, replace: true } as const;
  } catch {
    return { to: "/account/trips", replace: true } as const;
  }
}
