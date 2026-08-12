// Express Aftermarket / Omega provider stub for the `product_admin` category.
//
// Express Aftermarket is the canon-declared alternative VSC + only-source GAP
// product administrator (`canon/integrations.json::providers.express_aftermarket`,
// REST/JSON, HTTP Basic auth, no separate test mode). The full impl arrives
// when refi-portal's GAP-for-refi flow needs it. Until then this stub lets
// canon declare the provider without breaking the facade's provider lookup.

export default {
  id: 'express_aftermarket',
  supportsTestMode: false,
  async getRates(/* input, ctx */) {
    return {
      status: 'not_implemented',
      reason: 'express_aftermarket_provider_stub',
      plan_rates: [],
    };
  },
};
