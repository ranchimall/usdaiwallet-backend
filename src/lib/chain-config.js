const CHAINS = {
  tron: {
    name: 'Tron',
    nativeSymbol: 'TRX',
    explorerTx: (txid) => `https://tronscan.org/#/transaction/${txid}`,
    tokens: {
      USDT: { contract: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', decimals: 6 },
    },
  },
  ethereum: {
    name: 'Ethereum',
    nativeSymbol: 'ETH',
    explorerTx: (txid) => `https://etherscan.io/tx/${txid}`,
    tokens: {
      USDT: { contract: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6 },
      USDC: { contract: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6 },
    },
  },
  bsc: {
    name: 'BSC',
    nativeSymbol: 'BNB',
    explorerTx: (txid) => `https://bscscan.com/tx/${txid}`,
    tokens: {
      USDT: { contract: '0x55d398326f99059fF775485246999027B3197955', decimals: 18 },
      USDC: { contract: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', decimals: 18 },
    },
  },
};

const CONFIRMATIONS_REQUIRED = {
  tron:     Number(process.env.MIN_CONFIRMATIONS_TRON || 20),
  ethereum: Number(process.env.MIN_CONFIRMATIONS_ETH  || 12),
  bsc:      Number(process.env.MIN_CONFIRMATIONS_BSC  || 15),
};

const TREASURY_ADDRESSES = {
  tron:     process.env.TREASURY_TRON_ADDRESS,
  ethereum: process.env.TREASURY_ETH_ADDRESS,
  bsc:      process.env.TREASURY_BSC_ADDRESS,
};

const GAS_TANK_KEYS = {
  tron:     process.env.GAS_TANK_TRON_PRIVATE_KEY,
  ethereum: process.env.GAS_TANK_ETH_PRIVATE_KEY,
  bsc:      process.env.GAS_TANK_BSC_PRIVATE_KEY,
};

module.exports = {
  CHAINS,
  CONFIRMATIONS_REQUIRED,
  TREASURY_ADDRESSES,
  GAS_TANK_KEYS,
};
