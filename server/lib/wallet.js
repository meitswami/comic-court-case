// Wallet balance changes.
//
// Every change to a wallet goes through adjustWallet so the balance and its
// ledger row in `transactions` are always written together, inside one
// database transaction with the wallet row locked.

import { pool, generateUUID } from './mysql.js';

export class WalletError extends Error {
  constructor(message, code = 'WALLET_ERROR') {
    super(message);
    this.code = code;
  }
}

const TRANSACTION_TYPES = new Set([
  'wallet_topup',
  'hearing_payment',
  'addon_payment',
  'refund',
  'admin_adjustment',
]);

// amount > 0 credits the wallet, amount < 0 debits it.
// Pass `connection` to take part in a transaction the caller already opened.
export async function adjustWallet({
  userId,
  amount,
  type,
  description = null,
  referenceId = null,
  referenceType = null,
  createdBy = null,
  connection = null,
}) {
  const delta = Math.round(Number(amount) * 100) / 100;
  if (!userId) throw new WalletError('User is required');
  if (!Number.isFinite(delta) || delta === 0) throw new WalletError('Amount must be a non-zero number');
  if (!TRANSACTION_TYPES.has(type)) throw new WalletError('Unknown transaction type');

  const ownConnection = !connection;
  const conn = connection || (await pool.getConnection());

  try {
    if (ownConnection) await conn.beginTransaction();

    let [rows] = await conn.execute(
      'SELECT id, balance FROM user_wallets WHERE user_id = ? FOR UPDATE',
      [userId]
    );

    if (rows.length === 0) {
      await conn.execute(
        'INSERT INTO user_wallets (id, user_id, balance, currency) VALUES (?, ?, 0.00, ?)',
        [generateUUID(), userId, 'INR']
      );
      [rows] = await conn.execute(
        'SELECT id, balance FROM user_wallets WHERE user_id = ? FOR UPDATE',
        [userId]
      );
    }

    const wallet = rows[0];
    const before = Number(wallet.balance) || 0;
    const after = Math.round((before + delta) * 100) / 100;

    if (after < 0) {
      throw new WalletError('Insufficient wallet balance', 'INSUFFICIENT_BALANCE');
    }

    await conn.execute('UPDATE user_wallets SET balance = ? WHERE id = ?', [after, wallet.id]);

    const transactionId = generateUUID();
    await conn.execute(
      `INSERT INTO transactions
         (id, user_id, transaction_type, amount, balance_before, balance_after,
          description, reference_id, reference_type, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [transactionId, userId, type, delta, before, after, description, referenceId, referenceType, createdBy]
    );

    if (ownConnection) await conn.commit();
    return { transactionId, balanceBefore: before, balanceAfter: after };
  } catch (error) {
    if (ownConnection) {
      try {
        await conn.rollback();
      } catch (rollbackError) {
        // ignore
      }
    }
    throw error;
  } finally {
    if (ownConnection) conn.release();
  }
}
