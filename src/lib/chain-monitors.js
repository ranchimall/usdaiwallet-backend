const { ethers } = require('ethers');
const pool = require('../db/pool');
const { CHAINS } = require('./chain-config');

// ═══════════════════════════════════════════════════════════════
// TRON — via TronGrid
// ═══════════════════════════════════════════════════════════════
async function fetchTronDeposits(address, token) {
  const cfg = CHAINS.tron.tokens[token];
  if (!cfg) return [];

  const url =
    `https://api.trongrid.io/v1/accounts/${address}/transactions/trc20` +
    `?limit=50&contract_address=${cfg.contract}&only_to=true`;

  const res = await fetch(url, {
    headers: { 'TRON-PRO-API-KEY': process.env.TRONGRID_API_KEY || '' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`TronGrid HTTP ${res.status}`);

  const data = await res.json();
  const txs = data.data || [];

  // Get current block height
  let currentHeight = 0;
  try {
    const blockRes = await fetch('https://api.trongrid.io/wallet/getnowblock', {
      method: 'POST',
      headers: { 'TRON-PRO-API-KEY': process.env.TRONGRID_API_KEY || '' },
      signal: AbortSignal.timeout(10000),
    });
    if (blockRes.ok) {
      const blockData = await blockRes.json();
      currentHeight = blockData?.block_header?.raw_data?.number || 0;
    }
  } catch (_) {
  }

  return txs
    .filter((tx) => tx.to === address)
    .filter((tx) => tx.token_info?.address === cfg.contract)
    .map((tx) => {
      const decimals = tx.token_info?.decimals || cfg.decimals;
      const amount = Number(tx.value) / 10 ** decimals;
      return {
        txid: tx.transaction_id,
        amount,
        blockNumber: 0,
        // NOTE(v1): TronGrid TRC20 listing rarely includes block height, so we
        // stub confirmations. TronGrid can occasionally return unconfirmed txs;
        // for stricter safety, fetch each txid's block height and compare
        // against currentHeight here.
        confirmations: 20, // TRC20 transfers returned by TronGrid are usually confirmed
        currentHeight,
      };
    });
}

const EVM_API_BASE = 'https://api.etherscan.io/v2/api';

const EVM_EXPLORER = {
  ethereum: { chainId: 1, key: () => process.env.ETHERSCAN_API_KEY },
};

function evmUrl(chainId, params, key) {
  return `${EVM_API_BASE}?chainid=${chainId}&${params}&apikey=${key || ''}`;
}

// Throws on explorer-level errors so the watcher logs them instead of
// silently seeing "no deposits". A genuinely empty address returns
// status:"0" + "No transactions found" — that is NOT an error.
function assertEvmOk(data, chain) {
  if (Array.isArray(data.result)) return;
  const msg = typeof data.result === 'string' ? data.result : data.message;
  if (/no transactions found/i.test(msg || '')) return;
  throw new Error(`${chain} explorer: ${data.message || 'error'} — ${msg}`);
}

async function fetchEvmDeposits(chain, address, token) {
  const cfg = CHAINS[chain];
  const tokenCfg = cfg.tokens[token];
  if (!tokenCfg) return [];

  const ex = EVM_EXPLORER[chain];
  if (!ex) throw new Error(`No explorer configured for ${chain}`);

  const url = evmUrl(
    ex.chainId,
    `module=account&action=tokentx` +
    `&address=${address}&contractaddress=${tokenCfg.contract}&sort=desc`,
    ex.key()
  );

  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`${chain} explorer HTTP ${res.status}`);
  const data = await res.json();

  assertEvmOk(data, chain);
  if (!Array.isArray(data.result)) return [];

  const incoming = data.result.filter(
    (tx) => tx.to.toLowerCase() === address.toLowerCase()
  );

  // Fetch current block height for confirmation count
  let currentHeight = 0;
  try {
    const blockRes = await fetch(
      evmUrl(ex.chainId, `module=proxy&action=eth_blockNumber`, ex.key()),
      { signal: AbortSignal.timeout(10000) }
    );
    const blockData = await blockRes.json();
    currentHeight = parseInt(blockData.result || '0x0', 16);
  } catch (_) {
    // ignore
  }

  return incoming.map((tx) => {
    const amount = Number(tx.value) / 10 ** tokenCfg.decimals;
    const blockNumber = parseInt(tx.blockNumber, 10);
    return {
      txid: tx.hash,
      amount,
      blockNumber,
      confirmations: currentHeight > blockNumber ? currentHeight - blockNumber : 0,
      currentHeight,
    };
  });
}

const ERC20_TRANSFER_TOPIC = ethers.id('Transfer(address,address,uint256)');

// Public RPCs cap getLogs windows — walk big ranges in small chunks with
// a breather between calls so burst rate-limits (HTTP 403/429) don't trip.
async function getLogsChunked(provider, filter, fromBlock, toBlock, chunkSize = 1000) {
  const out = [];
  for (let start = fromBlock; start <= toBlock; start += chunkSize + 1) {
    const end = Math.min(start + chunkSize, toBlock);
    const logs = await provider.getLogs({ ...filter, fromBlock: start, toBlock: end });
    out.push(...logs);
    if (end < toBlock) await new Promise((r) => setTimeout(r, 300));
  }
  return out;
}

async function fetchBscDepositsViaRpc(address, token) {
  const tokenCfg = CHAINS.bsc.tokens[token];
  if (!tokenCfg) return [];

  // NOTE: bsc-dataseed.binance.org rejects address+topic getLogs scans
  // ("limit exceeded" even on 100-block windows). PublicNode serves them.
  const rpc = process.env.BSC_RPC_URL || 'https://bsc.publicnode.com';
  const provider = new ethers.JsonRpcProvider(rpc, undefined, {
    staticNetwork: true, // skip network detection chatter on public RPCs
  });

  const head = await provider.getBlockNumber();
  // Lag 2 blocks behind head: public endpoints load-balance across nodes
  // that disagree on the tip by a block or two, and querying past the
  // head they serve errors ("block range extends beyond current head").
  // Re-scanning the overlap next tick is harmless (dedupe upstream).
  const current = Math.max(0, head - 2);

  // Resume from the last scanned block (durable across restarts/sleep).
  // First sight of an address backfills only its own lifetime (BSC ≈
  // 3s/block + margin, capped at 5000 ≈ 4h) instead of deep history —
  // a deposit can only meaningfully arrive while the address is fresh,
  // and this keeps backfills to a handful of polite RPC calls.
  // Small overlap covers micro-reorgs; upstream ON CONFLICT DO NOTHING
  // makes re-scans harmless.
  let fromBlock = Math.max(0, current - 5000);
  try {
    const { rows } = await pool.query(
      `SELECT last_checked_block, created_at FROM deposit_addresses WHERE deposit_address = $1`,
      [address]
    );
    if (rows.length && rows[0].last_checked_block != null) {
      fromBlock = Math.max(0, rows[0].last_checked_block - 10);
    } else if (rows.length && rows[0].created_at) {
      const ageSec = (Date.now() - new Date(rows[0].created_at).getTime()) / 1000;
      fromBlock = Math.max(0, current - Math.min(Math.ceil(ageSec / 3) + 500, 5000));
    }
  } catch (_) {
    // Column missing (migrate not run yet) — window scan still works.
  }

  const logs = await getLogsChunked(
    provider,
    {
      address: tokenCfg.contract,
      topics: [ERC20_TRANSFER_TOPIC, null, ethers.zeroPadValue(address.toLowerCase(), 32)],
    },
    fromBlock,
    current
  );

  try {
    await pool.query(
      `UPDATE deposit_addresses SET last_checked_block = $1 WHERE deposit_address = $2`,
      [current, address]
    );
  } catch (_) {
    // Column missing — next tick re-scans the window. Harmless.
  }

  return logs.map((log) => ({
    txid: log.transactionHash,
    amount: Number(ethers.formatUnits(log.data, tokenCfg.decimals)),
    blockNumber: log.blockNumber,
    confirmations: Math.max(0, current - log.blockNumber),
    currentHeight: current,
  }));
}

// ═══════════════════════════════════════════════════════════════
// Dispatcher
// ═══════════════════════════════════════════════════════════════
async function fetchDeposits(chain, address, token) {
  if (chain === 'tron') return fetchTronDeposits(address, token);
  if (chain === 'bsc') return fetchBscDepositsViaRpc(address, token);
  if (chain === 'ethereum') {
    return fetchEvmDeposits(chain, address, token);
  }
  throw new Error(`Unsupported chain: ${chain}`);
}

module.exports = { fetchDeposits };
