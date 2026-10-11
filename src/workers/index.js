const depositWatcher = require('./deposit-watcher');
const sweepWorker = require('./sweep-worker');
const creditWorker = require('./credit-worker');
const cleanupWorker = require('./cleanup-worker');

function startAll() {
  console.log('Starting background workers...');
  depositWatcher.start();
  sweepWorker.start();
  creditWorker.start();
  cleanupWorker.start();
}

module.exports = { startAll };
