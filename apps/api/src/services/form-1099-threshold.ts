// Form 1099-NEC / 1099-MISC reporting threshold by the year the payment was made.
// Payments made through 2025: $600. Payments made after December 31, 2025: $2,000
// (One Big Beautiful Bill Act, Pub. L. 119-21). From 2027 the $2,000 is indexed for
// inflation; until the IRS publishes those amounts, $2,000 is used, which can only
// over-flag (the indexed figure will be higher), never miss a required form.
// Gross proceeds paid to attorneys (1099-MISC box 10) stay reportable at $600;
// attorney fees (1099-NEC) follow the $2,000 rule. This radar cannot tell
// attorneys apart from other payees, so the preparer confirms those by hand.
export function form1099Threshold(paymentYear: number): number {
  return paymentYear <= 2025 ? 600 : 2000;
}
