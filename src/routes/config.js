const express = require('express');
const { CHAINS, CONFIRMATIONS_REQUIRED } = require('../lib/chain-config');

const router = express.Router();

// Public — no signature required. Returns everything the
// frontend needs: platform address, supported chains/tokens,
// confirmation targets and minimum withdrawal.
router.get('/config', (_, res) => {
  const chains = {};
  for (const [key, cfg] of Object.entries(CHAINS)) {
    chains[key] = {
      name: cfg.name,
      nativeSymbol: cfg.nativeSymbol,
      tokens: Object.keys(cfg.tokens),
      confirmationsRequired: CONFIRMATIONS_REQUIRED[key],
      explorerTxTemplate: cfg.explorerTx('TXID'),
    };
  }

  res.json({
    success: true,
    platformFloAddress: process.env.PLATFORM_FLO_ADDRESS || null,
    minUsdaiWithdrawal: Number(process.env.MIN_USDAI_WITHDRAWAL || 1),
    depositAddressTtlMinutes: Number(process.env.DEPOSIT_ADDRESS_TTL_MINUTES || 60),
    chains,
  });
});

module.exports = router;
