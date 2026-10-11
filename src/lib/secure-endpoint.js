const { floCrypto } = require('./flo-node');

const MAX_SKEW_MS = 60_000;

/**
 * Express middleware that verifies a FLO signature on req.body.
 *
 * Required body fields:
 *   floId, time (ms), pubKey (hex), sign (hex)
 *
 * Message signed is: "<prefix>:<floId>:<time>"
 */
function secureEndpoint(options = {}) {
  const { prefix = 'ranchimall-exchange', floIdField = 'floId' } = options;

  return (req, res, next) => {
    try {
      const { time, pubKey, sign } = req.body || {};
      const floId = req.body?.[floIdField];

      if (!floId || !time || !pubKey || !sign) {
        return res.status(400).json({
          success: false,
          error: 'Missing auth fields (floId, time, pubKey, sign)',
        });
      }

      const age = Date.now() - Number(time);
      if (age < -MAX_SKEW_MS || age > MAX_SKEW_MS) {
        return res.status(401).json({
          success: false,
          error: 'Request expired or timestamp invalid',
        });
      }

      const derivedFloId = floCrypto.getFloID(pubKey);
      if (derivedFloId !== floId) {
        return res.status(401).json({
          success: false,
          error: 'pubKey does not match floId',
        });
      }

      const message = `${prefix}:${floId}:${time}`;
      const valid = floCrypto.verifySign(message, sign, pubKey);
      if (!valid) {
        return res.status(401).json({
          success: false,
          error: 'Invalid signature',
        });
      }

      req.floId = floId;
      next();
    } catch (err) {
      console.error('[auth] error:', err.message);
      return res.status(401).json({ success: false, error: 'Auth failed' });
    }
  };
}

module.exports = { secureEndpoint };
