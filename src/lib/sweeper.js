const { ethers } = require('ethers');
const TronWeb = require('tronweb');
const { CHAINS, TREASURY_ADDRESSES } = require('./chain-config');
const { waitForTxSuccess } = require('./tx-waiter');

const ERC20_ABI = [
  'function transfer(address to, uint256 amount) returns (bool)',
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
];

async function sweepTron(privateKey, token, amount) {
  const cfg = CHAINS.tron.tokens[token];
  const treasury = TREASURY_ADDRESSES.tron;
  if (!treasury) throw new Error('TREASURY_TRON_ADDRESS not configured');

  const tw = new TronWeb({
    fullHost: process.env.TRON_RPC_URL || 'https://api.trongrid.io',
    privateKey,
  });

  const contract = await tw.contract().at(cfg.contract);
  const rawAmount = Math.floor(amount * 10 ** cfg.decimals);

  const txid = await contract
    .transfer(treasury, rawAmount)
    .send({ feeLimit: 100_000_000 });

  return txid;
}

async function sweepEvm(chain, privateKey, token, amount) {
  const cfg = CHAINS[chain];
  const tokenCfg = cfg.tokens[token];
  const treasury = TREASURY_ADDRESSES[chain];
  if (!treasury) {
    throw new Error(`TREASURY_${chain.toUpperCase()}_ADDRESS not configured`);
  }

  const rpcUrl = chain === 'ethereum' ? process.env.ETH_RPC_URL : process.env.BSC_RPC_URL;
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);
  const contract = new ethers.Contract(tokenCfg.contract, ERC20_ABI, wallet);

  // Sweep the live on-chain balance (not the detected amount) so no dust
  // is left behind — the effects check below requires exactly zero left.
  const liveBal = await contract.balanceOf(wallet.address);
  if (liveBal === 0n) throw new Error('Nothing to sweep (already swept?)');

  const tx = await contract.transfer(treasury, liveBal);
  // Success = the tokens actually left (receipts are gated on free RPCs).
  await waitForTxSuccess(provider, tx.hash, async () => {
    const left = await contract.balanceOf(wallet.address);
    return left === 0n;
  });
  return tx.hash;
}

async function sweepToTreasury(chain, privateKey, token, amount) {
  if (chain === 'tron') return sweepTron(privateKey, token, amount);
  return sweepEvm(chain, privateKey, token, amount);
}

module.exports = { sweepToTreasury };
