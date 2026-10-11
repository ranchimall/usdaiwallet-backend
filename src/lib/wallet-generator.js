const { ethers } = require('ethers');
const TronWeb = require('tronweb');

function generateWallet(chain) {
  if (chain === 'tron') {
    const account = TronWeb.utils.accounts.generateAccount();
    return {
      address: account.address.base58,
      privateKey: account.privateKey,
    };
  }
  if (chain === 'ethereum' || chain === 'bsc') {
    const wallet = ethers.Wallet.createRandom();
    return {
      address: wallet.address,
      privateKey: wallet.privateKey,
    };
  }
  throw new Error(`Unsupported chain: ${chain}`);
}

module.exports = { generateWallet };
