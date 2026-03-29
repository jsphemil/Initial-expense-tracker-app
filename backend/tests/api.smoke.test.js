const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");

const baseDir = path.join(__dirname, "..");
const port = 4199;
const dbFile = `test-${Date.now()}.db`;
const dbPath = path.join(baseDir, dbFile);
const baseUrl = `http://127.0.0.1:${port}`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const waitForHealth = async (retries = 40, getSpawnError = () => null) => {
  for (let i = 0; i < retries; i += 1) {
    const spawnError = getSpawnError();
    if (spawnError) {
      throw spawnError;
    }
    try {
      const res = await fetch(`${baseUrl}/api/health`);
      if (res.ok) return;
    } catch {
      // ignore until server is up
    }
    await sleep(250);
  }
  throw new Error("Server did not start in time.");
};

const request = async (url, options = {}) => {
  const res = await fetch(`${baseUrl}${url}`, options);
  const text = await res.text();
  const contentType = res.headers.get("content-type") || "";
  const payload = contentType.includes("application/json") && text ? JSON.parse(text) : text;
  return { status: res.status, ok: res.ok, payload };
};

test("API smoke flow: auth, account, tx, transfer, recurring", async (t) => {
  let server;
  try {
    server = spawn("node", ["src/index.js"], {
      cwd: baseDir,
      env: {
        ...process.env,
        PORT: String(port),
        DB_FILE: dbFile,
        JWT_SECRET: "test-jwt-secret-min-16-characters",
        FRONTEND_ORIGIN: "http://127.0.0.1:5173",
        CRON_SECRET: "test-cron-secret",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    if (error?.code === "EPERM") {
      t.skip("Process spawn is restricted in this environment.");
      return;
    }
    throw error;
  }

  let spawnFailed = null;
  server.once("error", (error) => {
    spawnFailed = error;
  });

  let output = "";
  server.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  server.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });

  try {
    if (spawnFailed?.code === "EPERM") {
      t.skip("Process spawn is restricted in this environment.");
      return;
    }
    if (spawnFailed) {
      throw spawnFailed;
    }

    try {
      await waitForHealth(40, () => spawnFailed);
    } catch (error) {
      if (error?.code === "EPERM") {
        t.skip("Process spawn is restricted in this environment.");
        return;
      }
      throw error;
    }

    const email = `smoke-${Date.now()}@mail.com`;
    const password = "password123";
    const reg = await request("/api/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    assert.equal(reg.status, 200);
    assert.ok(reg.payload.token);
    const authHeader = { authorization: `Bearer ${reg.payload.token}` };

    const account1 = await request("/api/accounts", {
      method: "POST",
      headers: { ...authHeader, "content-type": "application/json" },
      body: JSON.stringify({
        name: "Salary Account",
        accountType: "bank",
        initialBalance: 10000,
      }),
    });
    assert.equal(account1.status, 200);

    const account2 = await request("/api/accounts", {
      method: "POST",
      headers: { ...authHeader, "content-type": "application/json" },
      body: JSON.stringify({
        name: "Credit Card",
        accountType: "credit",
        initialBalance: -1000,
      }),
    });
    assert.equal(account2.status, 200);

    const incomeTx = await request("/api/transactions", {
      method: "POST",
      headers: { ...authHeader, "content-type": "application/json" },
      body: JSON.stringify({
        accountId: account1.payload.accountId,
        type: "income",
        category: "Salary",
        amount: 2000,
        date: "2026-03-01",
      }),
    });
    assert.equal(incomeTx.status, 200);

    const expenseTx = await request("/api/transactions", {
      method: "POST",
      headers: { ...authHeader, "content-type": "application/json" },
      body: JSON.stringify({
        accountId: account1.payload.accountId,
        type: "expense",
        category: "Groceries",
        amount: 500,
        date: "2026-03-02",
      }),
    });
    assert.equal(expenseTx.status, 200);

    const transfer = await request("/api/transfers", {
      method: "POST",
      headers: { ...authHeader, "content-type": "application/json" },
      body: JSON.stringify({
        fromAccountId: account1.payload.accountId,
        toAccountId: account2.payload.accountId,
        amount: 1000,
        date: "2026-03-03",
        description: "Card payment",
      }),
    });
    assert.equal(transfer.status, 200);
    assert.ok(transfer.payload.transferGroupId);

    const categories = await request("/api/categories", {
      headers: authHeader,
    });
    assert.equal(categories.status, 200);
    assert.ok(categories.payload.incomeCategories.includes("Salary"));
    assert.ok(categories.payload.expenseCategories.includes("Groceries"));

    const recurring = await request("/api/recurring-rules", {
      method: "POST",
      headers: { ...authHeader, "content-type": "application/json" },
      body: JSON.stringify({
        accountId: account1.payload.accountId,
        type: "expense",
        category: "Rent",
        amount: 100,
        frequencyUnit: "day",
        frequencyInterval: 1,
        startDate: "2026-03-04",
        endDate: "2026-03-04",
      }),
    });
    assert.equal(recurring.status, 200);

    const runRecurring = await request("/api/recurring-rules/run", {
      method: "POST",
      headers: authHeader,
    });
    assert.equal(runRecurring.status, 200);

    const txList = await request("/api/transactions?type=transfer", {
      headers: authHeader,
    });
    assert.equal(txList.status, 200);
    assert.equal(txList.payload.transactions.length, 2);

    const dashboard = await request("/api/dashboard?month=2026-03", {
      headers: authHeader,
    });
    assert.equal(dashboard.status, 200);
    assert.equal(typeof dashboard.payload.walletBalance, "number");
  } finally {
    if (server?.pid) {
      server.kill("SIGTERM");
    }
    await sleep(300);
    if (fs.existsSync(dbPath)) fs.rmSync(dbPath, { force: true });
    if (fs.existsSync(`${dbPath}-wal`)) fs.rmSync(`${dbPath}-wal`, { force: true });
    if (fs.existsSync(`${dbPath}-shm`)) fs.rmSync(`${dbPath}-shm`, { force: true });
  }

  assert.ok(output.includes("Expense tracker backend running"), "Server did not start correctly");
});
