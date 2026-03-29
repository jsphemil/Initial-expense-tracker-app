
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const rateLimit = require("express-rate-limit");
const db = require("./db");

const app = express();
const PORT = Number(process.env.PORT || 4000);
const JWT_SECRET = process.env.JWT_SECRET;
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || "http://127.0.0.1:5173";
const CRON_SECRET = String(process.env.CRON_SECRET || "");

if (!JWT_SECRET || JWT_SECRET.length < 16) {
  throw new Error("JWT_SECRET must be set in backend/.env with at least 16 characters.");
}

const allowedOrigins = FRONTEND_ORIGIN.split(",")
  .map((value) => value.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, cb) {
      if (!origin || allowedOrigins.includes(origin)) {
        return cb(null, true);
      }
      return cb(new Error("Origin not allowed by CORS policy."));
    },
    credentials: false,
  })
);

app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 400,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests. Please try again shortly." },
  })
);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login/register attempts. Try again later." },
});

app.use(express.json({ limit: "256kb" }));

const ACCOUNT_TYPES = new Set(["general", "cash", "bank", "wallet", "credit"]);
const FREQUENCY_UNITS = new Set(["day", "week", "month", "year"]);

const createToken = (userId) => jwt.sign({ userId }, JWT_SECRET, { expiresIn: "7d" });

const isValidEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const isValidDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value);
const isValidMonth = (value) => /^\d{4}-\d{2}$/.test(value);
const isPositiveAmount = (value) => Number.isFinite(value) && value > 0 && Number(value) < 1e12;
const isSignedAmount = (value) => Number.isFinite(value) && Math.abs(Number(value)) < 1e12;

const normalizeText = (value, max = 120) =>
  String(value || "")
    .trim()
    .slice(0, max);

const parseDate = (value) => {
  if (!isValidDate(value)) return null;
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return d;
};

const formatDate = (dateObj) => dateObj.toISOString().slice(0, 10);
const todayDate = () => formatDate(new Date());

const addInterval = (dateStr, unit, interval) => {
  const base = parseDate(dateStr);
  if (!base) return dateStr;
  if (unit === "day") {
    base.setUTCDate(base.getUTCDate() + interval);
    return formatDate(base);
  }
  if (unit === "week") {
    base.setUTCDate(base.getUTCDate() + interval * 7);
    return formatDate(base);
  }
  if (unit === "month") {
    const day = base.getUTCDate();
    base.setUTCDate(1);
    base.setUTCMonth(base.getUTCMonth() + interval);
    const lastDay = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)).getUTCDate();
    base.setUTCDate(Math.min(day, lastDay));
    return formatDate(base);
  }
  if (unit === "year") {
    const month = base.getUTCMonth();
    const day = base.getUTCDate();
    base.setUTCFullYear(base.getUTCFullYear() + interval, month, 1);
    const lastDay = new Date(Date.UTC(base.getUTCFullYear(), month + 1, 0)).getUTCDate();
    base.setUTCDate(Math.min(day, lastDay));
    return formatDate(base);
  }
  return dateStr;
};

const auth = (req, res, next) => {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: "Missing authentication token." });
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.userId = payload.userId;
    return next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token." });
  }
};

const monthRange = (month) => {
  const safeMonth = isValidMonth(month) ? month : new Date().toISOString().slice(0, 7);
  const start = `${safeMonth}-01`;
  const [y, m] = safeMonth.split("-").map(Number);
  const d = new Date(Date.UTC(y, m, 1));
  const end = d.toISOString().slice(0, 10);
  return { month: safeMonth, start, end };
};

const upsertCategory = (userId, type, category) => {
  const safeType = normalizeText(type, 20);
  const safeCategory = normalizeText(category, 80);
  if (!safeCategory || !["income", "expense"].includes(safeType)) return;
  db.prepare(
    `INSERT INTO categories(user_id, type, name, last_used_at)
     VALUES(?, ?, ?, datetime('now'))
     ON CONFLICT(user_id, type, name)
     DO UPDATE SET last_used_at = excluded.last_used_at`
  ).run(userId, safeType, safeCategory);
};

const processRecurringForUser = (userId, untilDate = todayDate()) => {
  const safeUntil = isValidDate(untilDate) ? untilDate : todayDate();
  const rules = db
    .prepare(
      `SELECT id, user_id, account_id, type, category, description, amount,
              frequency_unit, frequency_interval, start_date, end_date, next_run_date, active
       FROM recurring_rules
       WHERE user_id = ? AND active = 1 AND next_run_date <= ?
       ORDER BY next_run_date ASC, id ASC`
    )
    .all(userId, safeUntil);

  const accountExistsStmt = db.prepare("SELECT id FROM accounts WHERE id = ? AND user_id = ?");
  const runExistsStmt = db.prepare(
    "SELECT id FROM recurring_rule_runs WHERE rule_id = ? AND run_date = ?"
  );
  const insertTxStmt = db.prepare(
    `INSERT INTO transactions(user_id, account_id, type, category, description, amount, tx_date, is_transfer, recurring_rule_id)
     VALUES(?, ?, ?, ?, ?, ?, ?, 0, ?)`
  );
  const insertRunStmt = db.prepare(
    "INSERT INTO recurring_rule_runs(rule_id, run_date, transaction_id) VALUES(?, ?, ?)"
  );
  const updateRuleStmt = db.prepare(
    "UPDATE recurring_rules SET next_run_date = ?, active = ? WHERE id = ? AND user_id = ?"
  );

  let createdCount = 0;

  const tx = db.transaction(() => {
    for (const rule of rules) {
      let nextDate = rule.next_run_date;
      let active = 1;
      let guard = 0;

      while (nextDate <= safeUntil && nextDate <= rule.end_date && guard < 1200) {
        const accountExists = accountExistsStmt.get(rule.account_id, rule.user_id);
        if (!accountExists) {
          active = 0;
          break;
        }

        const alreadyRan = runExistsStmt.get(rule.id, nextDate);
        if (!alreadyRan) {
          const inserted = insertTxStmt.run(
            rule.user_id,
            rule.account_id,
            rule.type,
            rule.category,
            rule.description,
            Number(rule.amount),
            nextDate,
            rule.id
          );
          insertRunStmt.run(rule.id, nextDate, inserted.lastInsertRowid);
          upsertCategory(rule.user_id, rule.type, rule.category);
          createdCount += 1;
        }

        nextDate = addInterval(nextDate, rule.frequency_unit, Number(rule.frequency_interval));
        guard += 1;
      }

      if (guard >= 1200 || nextDate > rule.end_date) {
        active = 0;
      }
      updateRuleStmt.run(nextDate, active, rule.id, rule.user_id);
    }
  });

  tx();
  return createdCount;
};

const processRecurringForAllUsers = () => {
  const users = db.prepare("SELECT id FROM users").all();
  let created = 0;
  for (const user of users) {
    created += processRecurringForUser(user.id);
  }
  return { users: users.length, created };
};

const ensureRecurring = (req, _res, next) => {
  processRecurringForUser(req.userId);
  next();
};

const getAccountSummaries = (userId, month) => {
  const { start, end } = monthRange(month);
  const accounts = db
    .prepare(
      `SELECT id, name, description, account_type, initial_balance
       FROM accounts
       WHERE user_id = ?
       ORDER BY id DESC`
    )
    .all(userId);

  const stmtBefore = db.prepare(
    `SELECT COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE -amount END), 0) AS net
     FROM transactions
     WHERE user_id = ? AND account_id = ? AND tx_date < ?`
  );
  const stmtMonth = db.prepare(
    `SELECT
       COALESCE(SUM(CASE WHEN type = 'income' AND is_transfer = 0 THEN amount ELSE 0 END), 0) AS income,
       COALESCE(SUM(CASE WHEN type = 'expense' AND is_transfer = 0 THEN amount ELSE 0 END), 0) AS expense,
       COALESCE(SUM(CASE WHEN type = 'income' AND is_transfer = 1 THEN amount ELSE 0 END), 0) AS transfersIn,
       COALESCE(SUM(CASE WHEN type = 'expense' AND is_transfer = 1 THEN amount ELSE 0 END), 0) AS transfersOut
     FROM transactions
     WHERE user_id = ? AND account_id = ? AND tx_date >= ? AND tx_date < ?`
  );

  return accounts.map((account) => {
    const netBefore = stmtBefore.get(userId, account.id, start).net;
    const monthTotals = stmtMonth.get(userId, account.id, start, end);
    const opening = Number(account.initial_balance) + Number(netBefore);
    const closing =
      Number(opening) +
      Number(monthTotals.income) -
      Number(monthTotals.expense) +
      Number(monthTotals.transfersIn) -
      Number(monthTotals.transfersOut);

    return {
      id: account.id,
      name: account.name,
      description: account.description,
      accountType: account.account_type,
      initialBalance: Number(account.initial_balance),
      openingBalance: Number(opening.toFixed(2)),
      monthlyIncome: Number(Number(monthTotals.income).toFixed(2)),
      monthlyExpense: Number(Number(monthTotals.expense).toFixed(2)),
      transferIn: Number(Number(monthTotals.transfersIn).toFixed(2)),
      transferOut: Number(Number(monthTotals.transfersOut).toFixed(2)),
      closingBalance: Number(closing.toFixed(2)),
    };
  });
};

const buildTransactionFilter = (reqQuery) => {
  const clauses = ["t.user_id = ?"];
  const params = [];

  const month = normalizeText(reqQuery.month, 7);
  const startDate = normalizeText(reqQuery.startDate, 10);
  const endDate = normalizeText(reqQuery.endDate, 10);

  if (month) {
    if (!isValidMonth(month)) {
      return { error: "Month must be YYYY-MM." };
    }
    const range = monthRange(month);
    clauses.push("t.tx_date >= ?", "t.tx_date < ?");
    params.push(range.start, range.end);
  }

  if (startDate) {
    if (!isValidDate(startDate)) {
      return { error: "startDate must be YYYY-MM-DD." };
    }
    clauses.push("t.tx_date >= ?");
    params.push(startDate);
  }

  if (endDate) {
    if (!isValidDate(endDate)) {
      return { error: "endDate must be YYYY-MM-DD." };
    }
    clauses.push("t.tx_date <= ?");
    params.push(endDate);
  }

  const accountId = Number(reqQuery.accountId);
  if (reqQuery.accountId !== undefined && reqQuery.accountId !== "") {
    if (!Number.isInteger(accountId)) {
      return { error: "accountId must be an integer." };
    }
    clauses.push("t.account_id = ?");
    params.push(accountId);
  }

  const type = normalizeText(reqQuery.type, 20);
  if (type) {
    if (type === "transfer") {
      clauses.push("t.is_transfer = 1");
    } else if (["income", "expense"].includes(type)) {
      clauses.push("t.type = ?", "t.is_transfer = 0");
      params.push(type);
    } else {
      return { error: "type must be income, expense, or transfer." };
    }
  }

  const category = normalizeText(reqQuery.category, 80);
  if (category) {
    clauses.push("LOWER(t.category) = LOWER(?)");
    params.push(category);
  }

  const search = normalizeText(reqQuery.search, 80);
  if (search) {
    clauses.push("(LOWER(t.category) LIKE LOWER(?) OR LOWER(t.description) LIKE LOWER(?) OR LOWER(a.name) LIKE LOWER(?))");
    const wildcard = `%${search}%`;
    params.push(wildcard, wildcard, wildcard);
  }

  return { clauses, params };
};

const toCsv = (rows, headers) => {
  const escape = (value) => {
    const text = String(value ?? "");
    if (/[",\n]/.test(text)) {
      return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
  };

  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => escape(row[h])).join(","));
  }
  return lines.join("\n");
};

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/auth/register", authLimiter, (req, res) => {
  const email = normalizeText(req.body?.email, 120).toLowerCase();
  const password = String(req.body?.password || "");
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required." });
  }
  if (!isValidEmail(email)) {
    return res.status(400).json({ error: "Please provide a valid email address." });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: "Password must contain at least 8 characters." });
  }

  const exists = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
  if (exists) {
    return res.status(409).json({ error: "Email is already registered." });
  }

  const passwordHash = bcrypt.hashSync(password, 12);
  const insert = db
    .prepare("INSERT INTO users(email, password_hash) VALUES(?, ?)")
    .run(email, passwordHash);
  return res.json({ token: createToken(insert.lastInsertRowid) });
});

app.post("/api/auth/login", authLimiter, (req, res) => {
  const email = normalizeText(req.body?.email, 120).toLowerCase();
  const password = String(req.body?.password || "");
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required." });
  }
  if (!isValidEmail(email)) {
    return res.status(400).json({ error: "Please provide a valid email address." });
  }

  const user = db
    .prepare("SELECT id, password_hash FROM users WHERE email = ?")
    .get(email);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: "Invalid email or password." });
  }
  return res.json({ token: createToken(user.id) });
});

app.get("/api/accounts", auth, ensureRecurring, (req, res) => {
  const rows = db
    .prepare(
      `SELECT a.id, a.name, a.description, a.account_type AS accountType,
              a.initial_balance AS initialBalance,
              (a.initial_balance + COALESCE((
                SELECT SUM(CASE WHEN t.type = 'income' THEN t.amount ELSE -t.amount END)
                FROM transactions t
                WHERE t.user_id = a.user_id AND t.account_id = a.id
              ), 0)) AS currentBalance
       FROM accounts a
       WHERE a.user_id = ?
       ORDER BY a.id DESC`
    )
    .all(req.userId)
    .map((row) => ({
      ...row,
      initialBalance: Number(row.initialBalance),
      currentBalance: Number(Number(row.currentBalance).toFixed(2)),
    }));
  res.json({ accounts: rows });
});

app.post("/api/accounts", auth, (req, res) => {
  const name = normalizeText(req.body?.name, 80);
  const description = normalizeText(req.body?.description, 200);
  const accountType = normalizeText(req.body?.accountType || "general", 20);
  const initialBalance = Number(req.body?.initialBalance ?? 0);

  if (!name) {
    return res.status(400).json({ error: "Account name is required." });
  }
  if (!ACCOUNT_TYPES.has(accountType)) {
    return res.status(400).json({ error: "Invalid account type." });
  }
  if (!isSignedAmount(initialBalance)) {
    return res.status(400).json({ error: "Initial balance must be numeric." });
  }

  const insert = db
    .prepare(
      `INSERT INTO accounts(user_id, name, description, account_type, initial_balance)
       VALUES(?, ?, ?, ?, ?)`
    )
    .run(req.userId, name, description, accountType, initialBalance);

  return res.json({ accountId: insert.lastInsertRowid });
});

app.patch("/api/accounts/:id", auth, (req, res) => {
  const accountId = Number(req.params.id);
  if (!Number.isInteger(accountId)) {
    return res.status(400).json({ error: "Invalid account id." });
  }
  const name = normalizeText(req.body?.name, 80);
  const description = normalizeText(req.body?.description, 200);
  const accountType = normalizeText(req.body?.accountType || "general", 20);
  if (!name) {
    return res.status(400).json({ error: "Account name is required." });
  }
  if (!ACCOUNT_TYPES.has(accountType)) {
    return res.status(400).json({ error: "Invalid account type." });
  }

  const result = db
    .prepare(
      `UPDATE accounts
       SET name = ?, description = ?, account_type = ?
       WHERE id = ? AND user_id = ?`
    )
    .run(name, description, accountType, accountId, req.userId);
  if (!result.changes) {
    return res.status(404).json({ error: "Account not found." });
  }
  return res.json({ ok: true });
});

app.patch("/api/accounts/:id/initial-balance", auth, (req, res) => {
  const accountId = Number(req.params.id);
  if (!Number.isInteger(accountId)) {
    return res.status(400).json({ error: "Invalid account id." });
  }
  const balance = Number(req.body?.initialBalance);
  if (!isSignedAmount(balance)) {
    return res.status(400).json({ error: "Initial balance must be numeric." });
  }

  const updated = db
    .prepare(
      `UPDATE accounts
       SET initial_balance = ?
       WHERE id = ? AND user_id = ?`
    )
    .run(balance, accountId, req.userId);
  if (!updated.changes) {
    return res.status(404).json({ error: "Account not found." });
  }
  return res.json({ ok: true });
});

app.delete("/api/accounts/:id", auth, (req, res) => {
  const accountId = Number(req.params.id);
  if (!Number.isInteger(accountId)) {
    return res.status(400).json({ error: "Invalid account id." });
  }

  const txCount = db
    .prepare("SELECT COUNT(*) AS count FROM transactions WHERE user_id = ? AND account_id = ?")
    .get(req.userId, accountId).count;
  if (txCount > 0) {
    return res.status(400).json({
      error: "Cannot delete an account with transactions. Delete/move transactions first.",
    });
  }

  const recurringCount = db
    .prepare("SELECT COUNT(*) AS count FROM recurring_rules WHERE user_id = ? AND account_id = ? AND active = 1")
    .get(req.userId, accountId).count;
  if (recurringCount > 0) {
    return res.status(400).json({
      error: "Cannot delete an account with active recurring rules.",
    });
  }

  const result = db
    .prepare("DELETE FROM accounts WHERE id = ? AND user_id = ?")
    .run(accountId, req.userId);
  if (!result.changes) {
    return res.status(404).json({ error: "Account not found." });
  }
  return res.json({ ok: true });
});

app.get("/api/categories", auth, ensureRecurring, (req, res) => {
  const rows = db
    .prepare(
      `SELECT type, name
       FROM categories
       WHERE user_id = ?
       ORDER BY last_used_at DESC, name ASC`
    )
    .all(req.userId);

  const incomeCategories = [];
  const expenseCategories = [];
  const seenIncome = new Set();
  const seenExpense = new Set();

  for (const row of rows) {
    if (row.type === "income" && !seenIncome.has(row.name)) {
      seenIncome.add(row.name);
      incomeCategories.push(row.name);
    }
    if (row.type === "expense" && !seenExpense.has(row.name)) {
      seenExpense.add(row.name);
      expenseCategories.push(row.name);
    }
  }

  res.json({ incomeCategories, expenseCategories });
});

app.post("/api/transactions", auth, (req, res) => {
  const accountId = Number(req.body?.accountId);
  const type = normalizeText(req.body?.type, 20);
  const category = normalizeText(req.body?.category, 80);
  const description = normalizeText(req.body?.description, 240);
  const amount = Number(req.body?.amount);
  const txDate = String(req.body?.date || "").slice(0, 10);

  if (!Number.isInteger(accountId)) {
    return res.status(400).json({ error: "Account is required." });
  }
  if (!["income", "expense"].includes(type)) {
    return res.status(400).json({ error: "Type must be income or expense." });
  }
  if (!category) {
    return res.status(400).json({ error: "Category is required." });
  }
  if (!isPositiveAmount(amount)) {
    return res.status(400).json({ error: "Amount must be greater than 0." });
  }
  if (!isValidDate(txDate)) {
    return res.status(400).json({ error: "Date must be YYYY-MM-DD." });
  }

  const accountExists = db
    .prepare("SELECT id FROM accounts WHERE id = ? AND user_id = ?")
    .get(accountId, req.userId);
  if (!accountExists) {
    return res.status(404).json({ error: "Account not found." });
  }

  db.prepare(
    `INSERT INTO transactions(user_id, account_id, type, category, description, amount, tx_date, is_transfer)
     VALUES(?, ?, ?, ?, ?, ?, ?, 0)`
  ).run(req.userId, accountId, type, category, description, amount, txDate);

  upsertCategory(req.userId, type, category);
  return res.json({ ok: true });
});

app.post("/api/transfers", auth, (req, res) => {
  const fromAccountId = Number(req.body?.fromAccountId);
  const toAccountId = Number(req.body?.toAccountId);
  const amount = Number(req.body?.amount);
  const txDate = String(req.body?.date || "").slice(0, 10);
  const description = normalizeText(req.body?.description, 240);

  if (!Number.isInteger(fromAccountId) || !Number.isInteger(toAccountId)) {
    return res.status(400).json({ error: "From and To accounts are required." });
  }
  if (fromAccountId === toAccountId) {
    return res.status(400).json({ error: "Transfer source and destination cannot be same." });
  }
  if (!isPositiveAmount(amount)) {
    return res.status(400).json({ error: "Amount must be greater than 0." });
  }
  if (!isValidDate(txDate)) {
    return res.status(400).json({ error: "Date must be YYYY-MM-DD." });
  }

  const fromAccount = db
    .prepare("SELECT id, name FROM accounts WHERE id = ? AND user_id = ?")
    .get(fromAccountId, req.userId);
  const toAccount = db
    .prepare("SELECT id, name FROM accounts WHERE id = ? AND user_id = ?")
    .get(toAccountId, req.userId);

  if (!fromAccount || !toAccount) {
    return res.status(404).json({ error: "One or both accounts do not exist." });
  }

  const transferGroupId = `tr_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const txText = description || `Transfer from ${fromAccount.name} to ${toAccount.name}`;

  const insertTransfer = db.transaction(() => {
    const outgoing = db
      .prepare(
        `INSERT INTO transactions(user_id, account_id, type, category, description, amount, tx_date, is_transfer, transfer_group_id)
         VALUES(?, ?, 'expense', ?, ?, ?, ?, 1, ?)`
      )
      .run(
        req.userId,
        fromAccountId,
        `Transfer to ${toAccount.name}`.slice(0, 80),
        txText,
        amount,
        txDate,
        transferGroupId
      );

    const incoming = db
      .prepare(
        `INSERT INTO transactions(user_id, account_id, type, category, description, amount, tx_date, is_transfer, transfer_group_id)
         VALUES(?, ?, 'income', ?, ?, ?, ?, 1, ?)`
      )
      .run(
        req.userId,
        toAccountId,
        `Transfer from ${fromAccount.name}`.slice(0, 80),
        txText,
        amount,
        txDate,
        transferGroupId
      );

    db.prepare("UPDATE transactions SET linked_transaction_id = ? WHERE id = ?")
      .run(incoming.lastInsertRowid, outgoing.lastInsertRowid);
    db.prepare("UPDATE transactions SET linked_transaction_id = ? WHERE id = ?")
      .run(outgoing.lastInsertRowid, incoming.lastInsertRowid);

    return {
      outgoingId: outgoing.lastInsertRowid,
      incomingId: incoming.lastInsertRowid,
      transferGroupId,
    };
  });

  const result = insertTransfer();
  return res.json({ ok: true, ...result });
});
app.patch("/api/transactions/:id", auth, (req, res) => {
  const txId = Number(req.params.id);
  if (!Number.isInteger(txId)) {
    return res.status(400).json({ error: "Invalid transaction id." });
  }

  const existing = db
    .prepare("SELECT id, is_transfer FROM transactions WHERE id = ? AND user_id = ?")
    .get(txId, req.userId);
  if (!existing) {
    return res.status(404).json({ error: "Transaction not found." });
  }
  if (Number(existing.is_transfer) === 1) {
    return res.status(400).json({ error: "Transfer transactions cannot be edited directly." });
  }

  const accountId = Number(req.body?.accountId);
  const type = normalizeText(req.body?.type, 20);
  const category = normalizeText(req.body?.category, 80);
  const description = normalizeText(req.body?.description, 240);
  const amount = Number(req.body?.amount);
  const txDate = String(req.body?.date || "").slice(0, 10);

  if (!Number.isInteger(accountId)) {
    return res.status(400).json({ error: "Account is required." });
  }
  if (!["income", "expense"].includes(type)) {
    return res.status(400).json({ error: "Type must be income or expense." });
  }
  if (!category) {
    return res.status(400).json({ error: "Category is required." });
  }
  if (!isPositiveAmount(amount)) {
    return res.status(400).json({ error: "Amount must be greater than 0." });
  }
  if (!isValidDate(txDate)) {
    return res.status(400).json({ error: "Date must be YYYY-MM-DD." });
  }

  const accountExists = db
    .prepare("SELECT id FROM accounts WHERE id = ? AND user_id = ?")
    .get(accountId, req.userId);
  if (!accountExists) {
    return res.status(404).json({ error: "Account not found." });
  }

  db.prepare(
    `UPDATE transactions
     SET account_id = ?, type = ?, category = ?, description = ?, amount = ?, tx_date = ?
     WHERE id = ? AND user_id = ?`
  ).run(accountId, type, category, description, amount, txDate, txId, req.userId);

  upsertCategory(req.userId, type, category);
  return res.json({ ok: true });
});

app.delete("/api/transactions/:id", auth, (req, res) => {
  const txId = Number(req.params.id);
  if (!Number.isInteger(txId)) {
    return res.status(400).json({ error: "Invalid transaction id." });
  }

  const row = db
    .prepare(
      "SELECT id, is_transfer AS isTransfer, transfer_group_id AS transferGroupId FROM transactions WHERE id = ? AND user_id = ?"
    )
    .get(txId, req.userId);
  if (!row) {
    return res.status(404).json({ error: "Transaction not found." });
  }

  if (Number(row.isTransfer) === 1 && row.transferGroupId) {
    db.prepare("DELETE FROM transactions WHERE user_id = ? AND transfer_group_id = ?")
      .run(req.userId, row.transferGroupId);
  } else {
    db.prepare("DELETE FROM transactions WHERE id = ? AND user_id = ?").run(txId, req.userId);
  }

  return res.json({ ok: true });
});

app.get("/api/dashboard", auth, ensureRecurring, (req, res) => {
  const month = normalizeText(req.query.month, 7);
  const { month: normalizedMonth, start, end } = monthRange(month);

  const monthly = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) AS income,
         COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) AS expense
       FROM transactions
       WHERE user_id = ? AND is_transfer = 0 AND tx_date >= ? AND tx_date < ?`
    )
    .get(req.userId, start, end);

  const lifetime = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) AS income,
         COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) AS expense
       FROM transactions
       WHERE user_id = ? AND is_transfer = 0`
    )
    .get(req.userId);

  const txNetAll = db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE -amount END), 0) AS net
       FROM transactions
       WHERE user_id = ?`
    )
    .get(req.userId);

  const openingBalances = db
    .prepare(
      `SELECT COALESCE(SUM(initial_balance), 0) AS total
       FROM accounts
       WHERE user_id = ?`
    )
    .get(req.userId);

  const expensesByCategory = db
    .prepare(
      `SELECT category, ROUND(SUM(amount), 2) AS total
       FROM transactions
       WHERE user_id = ? AND is_transfer = 0 AND type = 'expense' AND tx_date >= ? AND tx_date < ?
       GROUP BY category
       ORDER BY total DESC`
    )
    .all(req.userId, start, end)
    .map((row) => ({ category: row.category, total: Number(row.total) }));

  const dailyExpenses = db
    .prepare(
      `SELECT tx_date AS date, ROUND(SUM(amount), 2) AS total
       FROM transactions
       WHERE user_id = ? AND is_transfer = 0 AND type = 'expense' AND tx_date >= ? AND tx_date < ?
       GROUP BY tx_date
       ORDER BY tx_date`
    )
    .all(req.userId, start, end)
    .map((row) => ({ date: row.date, total: Number(row.total) }));

  const accountSummaries = getAccountSummaries(req.userId, normalizedMonth);

  const largestExpenseCategory = expensesByCategory[0] || null;
  const topSpendingDay = dailyExpenses.reduce(
    (acc, item) => (Number(item.total) > Number(acc?.total || 0) ? item : acc),
    null
  );

  const monthlyIncome = Number(Number(monthly.income).toFixed(2));
  const monthlyExpense = Number(Number(monthly.expense).toFixed(2));
  const monthlyNet = Number((monthlyIncome - monthlyExpense).toFixed(2));
  const savingsRate =
    monthlyIncome > 0
      ? Number((((monthlyIncome - monthlyExpense) / monthlyIncome) * 100).toFixed(1))
      : 0;

  res.json({
    month: normalizedMonth,
    monthlyIncome,
    monthlyExpense,
    monthlyNet,
    savingsRate,
    walletBalance: Number((Number(openingBalances.total) + Number(txNetAll.net)).toFixed(2)),
    totalIncome: Number(Number(lifetime.income).toFixed(2)),
    totalExpense: Number(Number(lifetime.expense).toFixed(2)),
    largestExpenseCategory,
    topSpendingDay,
    expensesByCategory,
    dailyExpenses,
    accountSummaries,
  });
});

app.get("/api/transactions", auth, ensureRecurring, (req, res) => {
  const filter = buildTransactionFilter(req.query || {});
  if (filter.error) {
    return res.status(400).json({ error: filter.error });
  }

  const limit = Math.min(Math.max(Number(req.query.limit || 300), 1), 1000);

  const sql =
    `SELECT t.id, t.account_id AS accountId, t.type, t.category, t.description, t.amount, t.tx_date AS date,
            t.is_transfer AS isTransfer, t.transfer_group_id AS transferGroupId,
            t.linked_transaction_id AS linkedTransactionId,
            a.name AS accountName,
            la.name AS linkedAccountName
     FROM transactions t
     INNER JOIN accounts a ON a.id = t.account_id
     LEFT JOIN transactions lt ON lt.id = t.linked_transaction_id
     LEFT JOIN accounts la ON la.id = lt.account_id
     WHERE ${filter.clauses.join(" AND ")}
     ORDER BY t.tx_date DESC, t.id DESC
     LIMIT ?`;

  const rows = db
    .prepare(sql)
    .all(req.userId, ...filter.params, limit)
    .map((row) => {
      const isTransfer = Number(row.isTransfer) === 1;
      const transferDirection = isTransfer ? (row.type === "expense" ? "out" : "in") : null;
      return {
        ...row,
        amount: Number(row.amount),
        isTransfer,
        transferDirection,
      };
    });

  res.json({ transactions: rows });
});
app.get("/api/transactions/export.csv", auth, ensureRecurring, (req, res) => {
  const filter = buildTransactionFilter(req.query || {});
  if (filter.error) {
    return res.status(400).json({ error: filter.error });
  }

  const sql =
    `SELECT t.tx_date AS date,
            CASE
              WHEN t.is_transfer = 1 AND t.type = 'expense' THEN 'transfer_out'
              WHEN t.is_transfer = 1 AND t.type = 'income' THEN 'transfer_in'
              ELSE t.type
            END AS type,
            a.name AS account,
            la.name AS linkedAccount,
            t.category AS category,
            t.description AS description,
            t.amount AS amount
     FROM transactions t
     INNER JOIN accounts a ON a.id = t.account_id
     LEFT JOIN transactions lt ON lt.id = t.linked_transaction_id
     LEFT JOIN accounts la ON la.id = lt.account_id
     WHERE ${filter.clauses.join(" AND ")}
     ORDER BY t.tx_date DESC, t.id DESC`;

  const rows = db.prepare(sql).all(req.userId, ...filter.params).map((row) => ({
    ...row,
    amount: Number(row.amount).toFixed(2),
  }));

  const csv = toCsv(rows, ["date", "type", "account", "linkedAccount", "category", "description", "amount"]);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="transactions-${todayDate()}.csv"`);
  res.send(csv);
});

app.get("/api/recurring-rules", auth, ensureRecurring, (req, res) => {
  const rows = db
    .prepare(
      `SELECT r.id, r.account_id AS accountId, a.name AS accountName, r.type, r.category,
              r.description, r.amount, r.frequency_unit AS frequencyUnit,
              r.frequency_interval AS frequencyInterval, r.start_date AS startDate,
              r.end_date AS endDate, r.next_run_date AS nextRunDate, r.active
       FROM recurring_rules r
       INNER JOIN accounts a ON a.id = r.account_id
       WHERE r.user_id = ?
       ORDER BY r.id DESC`
    )
    .all(req.userId)
    .map((row) => ({
      ...row,
      amount: Number(row.amount),
      active: Number(row.active) === 1,
    }));

  res.json({ rules: rows });
});

app.post("/api/recurring-rules", auth, (req, res) => {
  const accountId = Number(req.body?.accountId);
  const type = normalizeText(req.body?.type, 20);
  const category = normalizeText(req.body?.category, 80);
  const description = normalizeText(req.body?.description, 240);
  const amount = Number(req.body?.amount);
  const frequencyUnit = normalizeText(req.body?.frequencyUnit, 20);
  const frequencyInterval = Number(req.body?.frequencyInterval || 1);
  const startDate = normalizeText(req.body?.startDate, 10);
  const endDate = normalizeText(req.body?.endDate, 10);

  if (!Number.isInteger(accountId)) {
    return res.status(400).json({ error: "Account is required." });
  }
  if (!["income", "expense"].includes(type)) {
    return res.status(400).json({ error: "Type must be income or expense." });
  }
  if (!category) {
    return res.status(400).json({ error: "Category is required." });
  }
  if (!isPositiveAmount(amount)) {
    return res.status(400).json({ error: "Amount must be greater than 0." });
  }
  if (!FREQUENCY_UNITS.has(frequencyUnit)) {
    return res.status(400).json({ error: "frequencyUnit must be day, week, month, or year." });
  }
  if (!Number.isInteger(frequencyInterval) || frequencyInterval <= 0 || frequencyInterval > 365) {
    return res.status(400).json({ error: "frequencyInterval must be a positive integer." });
  }
  if (!isValidDate(startDate) || !isValidDate(endDate)) {
    return res.status(400).json({ error: "startDate and endDate must be YYYY-MM-DD." });
  }
  if (endDate < startDate) {
    return res.status(400).json({ error: "endDate must be after startDate." });
  }

  const accountExists = db
    .prepare("SELECT id FROM accounts WHERE id = ? AND user_id = ?")
    .get(accountId, req.userId);
  if (!accountExists) {
    return res.status(404).json({ error: "Account not found." });
  }

  const insert = db
    .prepare(
      `INSERT INTO recurring_rules(
         user_id, account_id, type, category, description, amount,
         frequency_unit, frequency_interval, start_date, end_date, next_run_date, active
       ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
    )
    .run(
      req.userId,
      accountId,
      type,
      category,
      description,
      amount,
      frequencyUnit,
      frequencyInterval,
      startDate,
      endDate,
      startDate
    );

  upsertCategory(req.userId, type, category);
  return res.json({ ruleId: insert.lastInsertRowid });
});

app.patch("/api/recurring-rules/:id", auth, (req, res) => {
  const ruleId = Number(req.params.id);
  if (!Number.isInteger(ruleId)) {
    return res.status(400).json({ error: "Invalid recurring rule id." });
  }

  const existing = db
    .prepare("SELECT id, active, end_date AS endDate FROM recurring_rules WHERE id = ? AND user_id = ?")
    .get(ruleId, req.userId);
  if (!existing) {
    return res.status(404).json({ error: "Recurring rule not found." });
  }

  const nextActive =
    typeof req.body?.active === "boolean"
      ? (req.body.active ? 1 : 0)
      : Number(existing.active) === 1
      ? 1
      : 0;

  const endDate = normalizeText(req.body?.endDate || existing.endDate, 10);
  if (!isValidDate(endDate)) {
    return res.status(400).json({ error: "endDate must be YYYY-MM-DD." });
  }

  db.prepare(
    `UPDATE recurring_rules
     SET active = ?, end_date = ?
     WHERE id = ? AND user_id = ?`
  ).run(nextActive, endDate, ruleId, req.userId);

  return res.json({ ok: true });
});

app.delete("/api/recurring-rules/:id", auth, (req, res) => {
  const ruleId = Number(req.params.id);
  if (!Number.isInteger(ruleId)) {
    return res.status(400).json({ error: "Invalid recurring rule id." });
  }

  const result = db
    .prepare("DELETE FROM recurring_rules WHERE id = ? AND user_id = ?")
    .run(ruleId, req.userId);
  if (!result.changes) {
    return res.status(404).json({ error: "Recurring rule not found." });
  }

  return res.json({ ok: true });
});

app.post("/api/recurring-rules/run", auth, (req, res) => {
  const created = processRecurringForUser(req.userId);
  return res.json({ ok: true, created });
});

app.post("/api/internal/run-recurring", (req, res) => {
  if (!CRON_SECRET) {
    return res.status(503).json({ error: "CRON_SECRET is not configured." });
  }
  const supplied = String(req.headers["x-cron-secret"] || req.query?.key || "");
  if (!supplied || supplied !== CRON_SECRET) {
    return res.status(403).json({ error: "Forbidden." });
  }

  const report = processRecurringForAllUsers();
  return res.json({ ok: true, ...report, runAt: new Date().toISOString() });
});

app.use((err, _req, res, _next) => {
  if (String(err?.message || "").includes("CORS")) {
    return res.status(403).json({ error: "Request origin is not allowed." });
  }
  console.error("Unhandled server error:", err);
  return res.status(500).json({ error: "Internal server error." });
});

const runRecurringJob = () => {
  try {
    const report = processRecurringForAllUsers();
    console.log(`[recurring] users=${report.users} created=${report.created}`);
  } catch (error) {
    console.error("[recurring] failed", error);
  }
};

app.listen(PORT, () => {
  console.log(`Expense tracker backend running on http://localhost:${PORT}`);
  console.log(`Allowed CORS origins: ${allowedOrigins.join(", ")}`);

  setTimeout(runRecurringJob, 5000);
  setInterval(runRecurringJob, 60 * 60 * 1000);
});
