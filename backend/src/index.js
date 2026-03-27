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

app.use(express.json({ limit: "128kb" }));

const ACCOUNT_TYPES = new Set(["general", "cash", "bank", "wallet", "credit"]);

const createToken = (userId) =>
  jwt.sign({ userId }, JWT_SECRET, { expiresIn: "7d" });

const isValidEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const isValidDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value);
const isFiniteAmount = (value) =>
  Number.isFinite(value) && value >= 0 && Number(value) < 1e12;

const normalizeText = (value, max = 120) =>
  String(value || "")
    .trim()
    .slice(0, max);

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
  const safeMonth = /^\d{4}-\d{2}$/.test(month)
    ? month
    : new Date().toISOString().slice(0, 7);
  const start = `${safeMonth}-01`;
  const [y, m] = safeMonth.split("-").map(Number);
  const d = new Date(Date.UTC(y, m, 1));
  const end = d.toISOString().slice(0, 10);
  return { month: safeMonth, start, end };
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
       COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) AS income,
       COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) AS expense
     FROM transactions
     WHERE user_id = ? AND account_id = ? AND tx_date >= ? AND tx_date < ?`
  );

  return accounts.map((account) => {
    const netBefore = stmtBefore.get(userId, account.id, start).net;
    const monthTotals = stmtMonth.get(userId, account.id, start, end);
    const opening = Number(account.initial_balance) + Number(netBefore);
    const closing =
      Number(opening) + Number(monthTotals.income) - Number(monthTotals.expense);
    return {
      id: account.id,
      name: account.name,
      description: account.description,
      accountType: account.account_type,
      initialBalance: Number(account.initial_balance),
      openingBalance: Number(opening.toFixed(2)),
      monthlyIncome: Number(Number(monthTotals.income).toFixed(2)),
      monthlyExpense: Number(Number(monthTotals.expense).toFixed(2)),
      closingBalance: Number(closing.toFixed(2)),
    };
  });
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
    return res
      .status(400)
      .json({ error: "Password must contain at least 8 characters." });
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

app.get("/api/accounts", auth, (req, res) => {
  const rows = db
    .prepare(
      `SELECT id, name, description, account_type AS accountType, initial_balance AS initialBalance
       FROM accounts
       WHERE user_id = ?
       ORDER BY id DESC`
    )
    .all(req.userId)
    .map((row) => ({ ...row, initialBalance: Number(row.initialBalance) }));
  res.json({ accounts: rows });
});

app.post("/api/accounts", auth, (req, res) => {
  const name = normalizeText(req.body?.name, 80);
  const description = normalizeText(req.body?.description, 200);
  const accountType = normalizeText(req.body?.accountType || "general", 20);
  if (!name) {
    return res.status(400).json({ error: "Account name is required." });
  }
  if (!ACCOUNT_TYPES.has(accountType)) {
    return res.status(400).json({ error: "Invalid account type." });
  }

  const insert = db
    .prepare(
      `INSERT INTO accounts(user_id, name, description, account_type)
       VALUES(?, ?, ?, ?)`
    )
    .run(req.userId, name, description, accountType);

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
  if (!isFiniteAmount(balance)) {
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
    .prepare(
      "SELECT COUNT(*) AS count FROM transactions WHERE user_id = ? AND account_id = ?"
    )
    .get(req.userId, accountId).count;
  if (txCount > 0) {
    return res.status(400).json({
      error:
        "Cannot delete an account with transactions. Delete/move transactions first.",
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
  if (!Number.isFinite(amount) || amount <= 0 || amount >= 1e12) {
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
    `INSERT INTO transactions(user_id, account_id, type, category, description, amount, tx_date)
     VALUES(?, ?, ?, ?, ?, ?, ?)`
  ).run(req.userId, accountId, type, category, description, amount, txDate);
  return res.json({ ok: true });
});

app.patch("/api/transactions/:id", auth, (req, res) => {
  const txId = Number(req.params.id);
  const accountId = Number(req.body?.accountId);
  const type = normalizeText(req.body?.type, 20);
  const category = normalizeText(req.body?.category, 80);
  const description = normalizeText(req.body?.description, 240);
  const amount = Number(req.body?.amount);
  const txDate = String(req.body?.date || "").slice(0, 10);

  if (!Number.isInteger(txId)) {
    return res.status(400).json({ error: "Invalid transaction id." });
  }
  if (!Number.isInteger(accountId)) {
    return res.status(400).json({ error: "Account is required." });
  }
  if (!["income", "expense"].includes(type)) {
    return res.status(400).json({ error: "Type must be income or expense." });
  }
  if (!category) {
    return res.status(400).json({ error: "Category is required." });
  }
  if (!Number.isFinite(amount) || amount <= 0 || amount >= 1e12) {
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

  const result = db
    .prepare(
      `UPDATE transactions
       SET account_id = ?, type = ?, category = ?, description = ?, amount = ?, tx_date = ?
       WHERE id = ? AND user_id = ?`
    )
    .run(accountId, type, category, description, amount, txDate, txId, req.userId);
  if (!result.changes) {
    return res.status(404).json({ error: "Transaction not found." });
  }
  return res.json({ ok: true });
});

app.delete("/api/transactions/:id", auth, (req, res) => {
  const txId = Number(req.params.id);
  if (!Number.isInteger(txId)) {
    return res.status(400).json({ error: "Invalid transaction id." });
  }

  const result = db
    .prepare("DELETE FROM transactions WHERE id = ? AND user_id = ?")
    .run(txId, req.userId);
  if (!result.changes) {
    return res.status(404).json({ error: "Transaction not found." });
  }
  return res.json({ ok: true });
});

app.get("/api/dashboard", auth, (req, res) => {
  const month = normalizeText(req.query.month, 7);
  const { month: normalizedMonth, start, end } = monthRange(month);

  const monthly = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) AS income,
         COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) AS expense
       FROM transactions
       WHERE user_id = ? AND tx_date >= ? AND tx_date < ?`
    )
    .get(req.userId, start, end);

  const lifetime = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) AS income,
         COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) AS expense
       FROM transactions
       WHERE user_id = ?`
    )
    .get(req.userId);

  const expensesByCategory = db
    .prepare(
      `SELECT category, ROUND(SUM(amount), 2) AS total
       FROM transactions
       WHERE user_id = ? AND type = 'expense' AND tx_date >= ? AND tx_date < ?
       GROUP BY category
       ORDER BY total DESC`
    )
    .all(req.userId, start, end)
    .map((row) => ({ category: row.category, total: Number(row.total) }));

  const dailyExpenses = db
    .prepare(
      `SELECT tx_date AS date, ROUND(SUM(amount), 2) AS total
       FROM transactions
       WHERE user_id = ? AND type = 'expense' AND tx_date >= ? AND tx_date < ?
       GROUP BY tx_date
       ORDER BY tx_date`
    )
    .all(req.userId, start, end)
    .map((row) => ({ date: row.date, total: Number(row.total) }));

  const accountSummaries = getAccountSummaries(req.userId, normalizedMonth);

  res.json({
    month: normalizedMonth,
    monthlyIncome: Number(Number(monthly.income).toFixed(2)),
    monthlyExpense: Number(Number(monthly.expense).toFixed(2)),
    walletBalance: Number(
      (Number(lifetime.income) - Number(lifetime.expense)).toFixed(2)
    ),
    totalIncome: Number(Number(lifetime.income).toFixed(2)),
    totalExpense: Number(Number(lifetime.expense).toFixed(2)),
    expensesByCategory,
    dailyExpenses,
    accountSummaries,
  });
});

app.get("/api/transactions", auth, (req, res) => {
  const rows = db
    .prepare(
      `SELECT t.id, t.account_id AS accountId, t.type, t.category, t.description, t.amount, t.tx_date AS date,
              a.name AS accountName
       FROM transactions t
       INNER JOIN accounts a ON a.id = t.account_id
       WHERE t.user_id = ?
       ORDER BY t.tx_date DESC, t.id DESC
       LIMIT 300`
    )
    .all(req.userId)
    .map((row) => ({ ...row, amount: Number(row.amount) }));
  res.json({ transactions: rows });
});

app.use((err, _req, res, _next) => {
  if (String(err?.message || "").includes("CORS")) {
    return res.status(403).json({ error: "Request origin is not allowed." });
  }
  return res.status(500).json({ error: "Internal server error." });
});

app.listen(PORT, () => {
  console.log(`Expense tracker backend running on http://localhost:${PORT}`);
  console.log(`Allowed CORS origins: ${allowedOrigins.join(", ")}`);
});
