const { ethers } = require('ethers');
const TronWeb = require('tronweb');
const { GAS_TANK_KEYS } = require('./chain-config');
const { waitForTxSuccess } = require('./tx-waiter');

// Minimum gas to keep in a deposit address for one sweep
const MIN_GAS = {
  tron:     30_000_000,             // 30 TRX in sun
  ethereum: ethers.parseEther('0.0008'),
  bsc:      ethers.parseEther('0.0003'),
};

let _ethProvider, _bscProvider, _tronWeb;

function getTronWeb() {
  if (!_tronWeb) {
    _tronWeb = new TronWeb({
      fullHost: process.env.TRON_RPC_URL || 'https://api.trongrid.io',
      privateKey: GAS_TANK_KEYS.tron,
    });
  }
  return _tronWeb;
}

function getEvmProvider(chain) {
  const url = chain === 'ethereum' ? process.env.ETH_RPC_URL : process.env.BSC_RPC_URL;
  if (chain === 'ethereum') {
    if (!_ethProvider) _ethProvider = new ethers.JsonRpcProvider(url);
    return _ethProvider;
  }
  if (!_bscProvider) _bscProvider = new ethers.JsonRpcProvider(url);
  return _bscProvider;
}

async function getTronBalanceSun(address) {
  const tw = getTronWeb();
  const balance = await tw.trx.getBalance(address);
  return BigInt(balance);
}

async function getEvmBalanceWei(chain, address) {
  const provider = getEvmProvider(chain);
  return await provider.getBalance(address);
}

async function getNativeBalance(chain, address) {
  if (chain === 'tron') return getTronBalanceSun(address);
  return getEvmBalanceWei(chain, address);
}

async function sendTronGas(toAddress, amountSun) {
  const tw = getTronWeb();
  const tx = await tw.trx.sendTransaction(toAddress, Number(amountSun));
  return tx.txid || tx.transaction?.txID;
}

async function sendEvmGas(chain, toAddress, amountWei) {
  const provider = getEvmProvider(chain);
  const amount = BigInt(amountWei);
  const before = await provider.getBalance(toAddress);
  const wallet = new ethers.Wallet(GAS_TANK_KEYS[chain], provider);
  const tx = await wallet.sendTransaction({ to: toAddress, value: amount });
  // Success = the balance actually arrived (receipts are gated on free RPCs).
  await waitForTxSuccess(provider, tx.hash, async () => {
    const now = await provider.getBalance(toAddress);
    return now >= before + amount;
  });
  return tx.hash;
}

/**
 * Ensure the given address has at least MIN_GAS native currency.
 */
async function ensureGas(chain, address) {
  const current = await getNativeBalance(chain, address);
  const required = BigInt(MIN_GAS[chain]);

  if (current >= required) return;

  const deficit = required - current;
  const topUp = deficit * 2n;

  console.log(`[gas] Topping up ${chain} address ${address} with ${topUp}`);

  if (chain === 'tron') {
    await sendTronGas(address, topUp);
  } else {
    await sendEvmGas(chain, address, topUp);
  }

  // Wait a bit for the gas tx to confirm
  await new Promise((r) => setTimeout(r, 20_000));
}

module.exports = { ensureGas, MIN_GAS };
