const path = require("path");
const Database = require("better-sqlite3");

const dbFileName = process.env.DB_FILE || "expense_tracker.db";
const dbPath = path.join(__dirname, "..", dbFileName);
const db = new Database(dbPath);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    account_type TEXT NOT NULL DEFAULT 'general',
    initial_balance REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    account_id INTEGER NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('income', 'expense')),
    category TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    amount REAL NOT NULL CHECK(amount >= 0),
    tx_date TEXT NOT NULL,
    is_transfer INTEGER NOT NULL DEFAULT 0,
    transfer_group_id TEXT,
    linked_transaction_id INTEGER,
    recurring_rule_id INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
    FOREIGN KEY (recurring_rule_id) REFERENCES recurring_rules(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS recurring_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    account_id INTEGER NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('income', 'expense')),
    category TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    amount REAL NOT NULL CHECK(amount > 0),
    frequency_unit TEXT NOT NULL CHECK(frequency_unit IN ('day', 'week', 'month', 'year')),
    frequency_interval INTEGER NOT NULL DEFAULT 1 CHECK(frequency_interval > 0),
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    next_run_date TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS recurring_rule_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rule_id INTEGER NOT NULL,
    run_date TEXT NOT NULL,
    transaction_id INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (rule_id) REFERENCES recurring_rules(id) ON DELETE CASCADE,
    FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE,
    UNIQUE(rule_id, run_date)
  );

  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('income', 'expense')),
    name TEXT NOT NULL,
    last_used_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(user_id, type, name)
  );

  CREATE INDEX IF NOT EXISTS idx_transactions_user_date
    ON transactions(user_id, tx_date);
  CREATE INDEX IF NOT EXISTS idx_recurring_rules_user_next_run
    ON recurring_rules(user_id, next_run_date);
  CREATE INDEX IF NOT EXISTS idx_categories_user_type
    ON categories(user_id, type, last_used_at DESC);
`);

const getColumnNames = (tableName) =>
  db
    .prepare(`PRAGMA table_info(${tableName})`)
    .all()
    .map((row) => row.name);

const ensureColumn = (tableName, columnName, sqlTypeDef) => {
  const columns = new Set(getColumnNames(tableName));
  if (!columns.has(columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${sqlTypeDef}`);
  }
};

ensureColumn("accounts", "initial_balance", "REAL NOT NULL DEFAULT 0");
ensureColumn("transactions", "is_transfer", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("transactions", "transfer_group_id", "TEXT");
ensureColumn("transactions", "linked_transaction_id", "INTEGER");
ensureColumn("transactions", "recurring_rule_id", "INTEGER");
db.exec(
  "CREATE INDEX IF NOT EXISTS idx_transactions_transfer_group ON transactions(transfer_group_id)"
);

module.exports = db;
