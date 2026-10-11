// ── Must be required FIRST, before any other FLO library ────────

// Shim browser globals that lib.js / floCrypto.js reference
// lib.js runs as (function(GLOBAL){...})(global) in Node, and its
// SecureRandom seed code touches screen/history/location/navigator.
if (typeof global.window === 'undefined') global.window = global;
if (typeof global.self === 'undefined') global.self = global;
if (typeof global.alert === 'undefined') global.alert = () => {};
if (typeof global.navigator === 'undefined') {
  global.navigator = {
    appName: 'Node',
    userAgent: 'Node',
    plugins: [],
    mimeTypes: [],
    cookieEnabled: false,
    language: 'en-US',
  };
} else {
  global.navigator.plugins = global.navigator.plugins || [];
  global.navigator.mimeTypes = global.navigator.mimeTypes || [];
  global.navigator.cookieEnabled = global.navigator.cookieEnabled || false;
  global.navigator.language = global.navigator.language || 'en-US';
  global.navigator.userAgent = global.navigator.userAgent || 'Node';
}
if (typeof global.screen === 'undefined') {
  global.screen = {
    height: 1080, width: 1920, colorDepth: 24,
    availHeight: 1080, availWidth: 1920, pixelDepth: 24,
  };
}
if (typeof global.history === 'undefined') global.history = { length: 0 };
if (typeof global.location === 'undefined') global.location = { href: '', protocol: 'https:' };
if (typeof global.document === 'undefined') {
  global.document = { location: { protocol: 'https:' } };
}

// floGlobals must exist before floBlockchainAPI.js loads
global.floGlobals = {
  blockchain: 'FLO',
  apiURL: {
    FLO: [
      'https://blockbook.flocard.app/',
      'https://blockbook.ranchimall.net/',
    ],
  },
  adminID: 'FMyRTrz9CG4TFNM6rCQgy3VQ5NF23bY2xD',
  sendAmt: 0.0003,
  fee: 0.0002,
};

require('../../public/lib.js');
// floCrypto.js exports via module.exports in Node, but
// floBlockchainAPI.js expects a bare global `floCrypto` (browser style).
// Bridge it onto global BEFORE loading the API file.
const floCryptoModule = require('../../public/floCrypto.js');
global.floCrypto = floCryptoModule;
const floBlockchainAPI = require('../../public/floBlockchainAPI.js');

module.exports = {
  floCrypto: global.floCrypto,
  floBlockchainAPI,
  bitjs: global.bitjs,
  Crypto: global.Crypto,
  Bitcoin: global.Bitcoin,
  BigInteger: global.BigInteger,
  ripemd160: global.ripemd160,
};
