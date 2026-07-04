/**
 * Payment provider abstraction — mock implementation for now.
 * Swap `mockProvider` for a Stripe/Xendit-backed implementation later
 * without touching route logic: just implement the same interface.
 */

const mockProvider = {
  name: 'mock',

  /**
   * Simulate a checkout charge.
   * Always succeeds unless the card number ends in "0000" (lets us test failure UI).
   */
  async charge({ amountCents, cardNumber }) {
    const fails = typeof cardNumber === 'string' && cardNumber.replace(/\s/g, '').endsWith('0000');
    if (fails) {
      return { success: false, error: 'Card declined', reference: null };
    }
    return {
      success: true,
      reference: 'mock_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    };
  },
};

function getProvider() {
  // Future: return Stripe/Xendit provider based on env config.
  return mockProvider;
}

module.exports = { getProvider };
