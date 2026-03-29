
import { useCallback, useEffect, useMemo, useState } from 'react'
import dayjs from 'dayjs'
import Calendar from 'react-calendar'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { api, setAuthToken } from './api'
import './App.css'
import 'react-calendar/dist/Calendar.css'

const monthValue = dayjs().format('YYYY-MM')
const dateValue = dayjs().format('YYYY-MM-DD')

const NAV_SECTIONS = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'accounts', label: 'Accounts' },
  { id: 'transactions', label: 'Transactions' },
  { id: 'transfers', label: 'Transfers' },
  { id: 'recurring', label: 'Recurring' },
  { id: 'insights', label: 'Insights' },
  { id: 'settings', label: 'Settings' },
]
const CHART_COLORS = ['#22d3ee', '#34d399', '#38bdf8', '#2dd4bf', '#67e8f9', '#10b981']

function App() {
  const [token, setToken] = useState(localStorage.getItem('expense_token') || '')
  const [authMode, setAuthMode] = useState('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [month, setMonth] = useState(monthValue)
  const [dashboard, setDashboard] = useState(null)
  const [accounts, setAccounts] = useState([])
  const [transactions, setTransactions] = useState([])
  const [categories, setCategories] = useState({ incomeCategories: [], expenseCategories: [] })
  const [recurringRules, setRecurringRules] = useState([])
  const [activeSection, setActiveSection] = useState('dashboard')
  const [chartType, setChartType] = useState('pie')

  const [isTxModalOpen, setIsTxModalOpen] = useState(false)
  const [txType, setTxType] = useState('expense')
  const [editingTxId, setEditingTxId] = useState(null)
  const [editingAccountId, setEditingAccountId] = useState(null)

  const [txForm, setTxForm] = useState({
    accountId: '',
    category: '',
    description: '',
    date: dateValue,
    amount: '',
  })

  const [accountForm, setAccountForm] = useState({
    name: '',
    accountType: 'general',
    description: '',
    initialBalance: '0',
  })

  const [transferForm, setTransferForm] = useState({
    fromAccountId: '',
    toAccountId: '',
    amount: '',
    date: dateValue,
    description: '',
  })

  const [recurringForm, setRecurringForm] = useState({
    accountId: '',
    type: 'expense',
    category: '',
    description: '',
    amount: '',
    frequencyUnit: 'month',
    frequencyInterval: '1',
    startDate: dateValue,
    endDate: dayjs().add(6, 'month').format('YYYY-MM-DD'),
  })

  const [balanceDrafts, setBalanceDrafts] = useState({})
  const [txFilters, setTxFilters] = useState({
    month: monthValue,
    startDate: '',
    endDate: '',
    accountId: '',
    type: '',
    category: '',
    search: '',
  })

  const [txFiltersDraft, setTxFiltersDraft] = useState(txFilters)

  useEffect(() => {
    setAuthToken(token)
  }, [token])

  const handleLogout = () => {
    localStorage.removeItem('expense_token')
    setToken('')
    setDashboard(null)
    setAccounts([])
    setTransactions([])
    setRecurringRules([])
    setCategories({ incomeCategories: [], expenseCategories: [] })
  }

  const loadAllData = useCallback(async () => {
    try {
      setError('')
      const [dashRes, accountRes, txRes, categoryRes, recurringRes] = await Promise.all([
        api.get('/dashboard', { params: { month } }),
        api.get('/accounts'),
        api.get('/transactions', { params: txFilters }),
        api.get('/categories'),
        api.get('/recurring-rules'),
      ])
      setDashboard(dashRes.data)
      setAccounts(accountRes.data.accounts)
      setTransactions(txRes.data.transactions)
      setCategories(categoryRes.data)
      setRecurringRules(recurringRes.data.rules)
    } catch (err) {
      setError(err.response?.data?.error || 'Could not load dashboard data.')
      if (err.response?.status === 401) {
        handleLogout()
      }
    }
  }, [month, txFilters])

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!token) return
    loadAllData()
  }, [token, loadAllData])
  /* eslint-enable react-hooks/set-state-in-effect */

  const handleAuth = async (event) => {
    event.preventDefault()
    try {
      setError('')
      const endpoint = authMode === 'login' ? '/auth/login' : '/auth/register'
      const res = await api.post(endpoint, { email, password })
      localStorage.setItem('expense_token', res.data.token)
      setToken(res.data.token)
      setEmail('')
      setPassword('')
    } catch (err) {
      setError(err.response?.data?.error || 'Authentication failed.')
    }
  }

  const handleCreateAccount = async (event) => {
    event.preventDefault()
    if (!accountForm.name.trim()) return
    try {
      await api.post('/accounts', {
        ...accountForm,
        initialBalance: Number(accountForm.initialBalance || 0),
      })
      setAccountForm({
        name: '',
        accountType: 'general',
        description: '',
        initialBalance: '0',
      })
      await loadAllData()
    } catch (err) {
      setError(err.response?.data?.error || 'Could not create account.')
    }
  }

  const handleUpdateInitialBalance = async (accountId) => {
    const value = Number(balanceDrafts[accountId])
    if (!Number.isFinite(value)) return
    try {
      await api.patch(`/accounts/${accountId}/initial-balance`, {
        initialBalance: value,
      })
      await loadAllData()
    } catch (err) {
      setError(err.response?.data?.error || 'Could not update initial balance.')
    }
  }

  const openTxModal = (type) => {
    const fallbackAccount = accounts[0]?.id ? String(accounts[0].id) : ''
    setEditingTxId(null)
    setTxType(type)
    setTxForm({
      accountId: fallbackAccount,
      category: '',
      description: '',
      date: dateValue,
      amount: '',
    })
    setIsTxModalOpen(true)
  }

  const openEditTxModal = (tx) => {
    if (tx.isTransfer) {
      setError('Transfer rows are linked. Delete the transfer and create a new one if needed.')
      return
    }
    setEditingTxId(tx.id)
    setTxType(tx.type)
    setTxForm({
      accountId: String(tx.accountId),
      category: tx.category,
      description: tx.description || '',
      date: tx.date,
      amount: String(tx.amount),
    })
    setIsTxModalOpen(true)
  }

  const handleSaveTransaction = async (event) => {
    event.preventDefault()
    try {
      const payload = {
        ...txForm,
        accountId: Number(txForm.accountId),
        amount: Number(txForm.amount),
        type: txType,
      }
      if (editingTxId) {
        await api.patch(`/transactions/${editingTxId}`, payload)
      } else {
        await api.post('/transactions', payload)
      }
      setIsTxModalOpen(false)
      await loadAllData()
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save transaction.')
    }
  }

  const handleDeleteTransaction = async (txId) => {
    const confirmed = window.confirm('Delete this transaction? Linked transfer rows will be removed together.')
    if (!confirmed) return
    try {
      await api.delete(`/transactions/${txId}`)
      await loadAllData()
    } catch (err) {
      setError(err.response?.data?.error || 'Could not delete transaction.')
    }
  }

  const handleCreateTransfer = async (event) => {
    event.preventDefault()
    try {
      await api.post('/transfers', {
        ...transferForm,
        fromAccountId: Number(transferForm.fromAccountId),
        toAccountId: Number(transferForm.toAccountId),
        amount: Number(transferForm.amount),
      })
      setTransferForm({
        fromAccountId: '',
        toAccountId: '',
        amount: '',
        date: dateValue,
        description: '',
      })
      await loadAllData()
    } catch (err) {
      setError(err.response?.data?.error || 'Could not create transfer.')
    }
  }

  const handleCreateRecurring = async (event) => {
    event.preventDefault()
    try {
      await api.post('/recurring-rules', {
        ...recurringForm,
        accountId: Number(recurringForm.accountId),
        amount: Number(recurringForm.amount),
        frequencyInterval: Number(recurringForm.frequencyInterval),
      })
      setRecurringForm((prev) => ({
        ...prev,
        category: '',
        description: '',
        amount: '',
      }))
      await loadAllData()
    } catch (err) {
      setError(err.response?.data?.error || 'Could not create recurring rule.')
    }
  }

  const handleToggleRecurring = async (rule) => {
    try {
      await api.patch(`/recurring-rules/${rule.id}`, { active: !rule.active })
      await loadAllData()
    } catch (err) {
      setError(err.response?.data?.error || 'Could not update recurring rule.')
    }
  }

  const handleDeleteRecurring = async (ruleId) => {
    const confirmed = window.confirm('Delete this recurring rule?')
    if (!confirmed) return
    try {
      await api.delete(`/recurring-rules/${ruleId}`)
      await loadAllData()
    } catch (err) {
      setError(err.response?.data?.error || 'Could not delete recurring rule.')
    }
  }

  const handleRunRecurringNow = async () => {
    try {
      await api.post('/recurring-rules/run')
      await loadAllData()
    } catch (err) {
      setError(err.response?.data?.error || 'Could not process recurring transactions.')
    }
  }

  const handleApplyTxFilters = (event) => {
    event.preventDefault()
    setTxFilters(txFiltersDraft)
  }

  const handleExportCsv = async () => {
    try {
      const response = await api.get('/transactions/export.csv', {
        params: txFilters,
        responseType: 'blob',
      })
      const url = window.URL.createObjectURL(response.data)
      const link = document.createElement('a')
      link.href = url
      link.download = `transactions-${dayjs().format('YYYY-MM-DD')}.csv`
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(url)
    } catch (err) {
      setError(err.response?.data?.error || 'Could not export CSV.')
    }
  }

  const openEditAccountModal = (account) => {
    setEditingAccountId(account.id)
    setAccountForm({
      name: account.name,
      accountType: account.accountType,
      description: account.description || '',
      initialBalance: String(account.initialBalance ?? 0),
    })
  }

  const handleEditAccount = async (event) => {
    event.preventDefault()
    if (!editingAccountId) return
    try {
      await api.patch(`/accounts/${editingAccountId}`, {
        name: accountForm.name,
        accountType: accountForm.accountType,
        description: accountForm.description,
      })
      setEditingAccountId(null)
      setAccountForm({
        name: '',
        accountType: 'general',
        description: '',
        initialBalance: '0',
      })
      await loadAllData()
    } catch (err) {
      setError(err.response?.data?.error || 'Could not update account.')
    }
  }

  const handleDeleteAccount = async (accountId) => {
    const confirmed = window.confirm(
      'Delete this account? This is allowed only when account has no transactions and no active recurring rules.',
    )
    if (!confirmed) return
    try {
      await api.delete(`/accounts/${accountId}`)
      await loadAllData()
    } catch (err) {
      setError(err.response?.data?.error || 'Could not delete account.')
    }
  }

  const categoryOptions = useMemo(() => {
    return txType === 'income' ? categories.incomeCategories : categories.expenseCategories
  }, [txType, categories])

  const recurringCategoryOptions = useMemo(() => {
    return recurringForm.type === 'income'
      ? categories.incomeCategories
      : categories.expenseCategories
  }, [recurringForm.type, categories])

  const calendarLookup = useMemo(() => {
    if (!dashboard) return {}
    return Object.fromEntries(
      dashboard.dailyExpenses.map((entry) => [entry.date, entry.total]),
    )
  }, [dashboard])

  const onboardingNeeded = token && accounts.length === 0

  if (!token) {
    return (
      <main className="auth-shell">
        <section className="card auth-card">
          <h1>Personal Expense Tracker</h1>
          <p className="muted">Login with email and password.</p>
          <form onSubmit={handleAuth} className="stack">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
              required
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password (8+ chars)"
              required
            />
            <button type="submit">
              {authMode === 'login' ? 'Login' : 'Create Account'}
            </button>
          </form>
          <button
            className="text-button"
            onClick={() =>
              setAuthMode((prev) => (prev === 'login' ? 'register' : 'login'))
            }
          >
            {authMode === 'login'
              ? 'Need an account? Register'
              : 'Already registered? Login'}
          </button>
          {error && <p className="error">{error}</p>}
        </section>
      </main>
    )
  }

  return (
    <main className="app-shell">
      <header className="topbar card">
        <div>
          <p className="muted brand-title">Personal Expense Tracker</p>
          <h1>Dashboard</h1>
        </div>
        <div className="topbar-actions">
          <input
            type="month"
            value={month}
            onChange={(e) => {
              const nextMonth = e.target.value
              setMonth(nextMonth)
              setTxFilters((prev) => ({ ...prev, month: nextMonth }))
              setTxFiltersDraft((prev) => ({ ...prev, month: nextMonth }))
            }}
            aria-label="Select month"
          />
          <button onClick={() => openTxModal('expense')}>Add Expense</button>
          <button onClick={() => openTxModal('income')}>Add Income</button>
          <button className="text-button" onClick={handleLogout}>
            Logout
          </button>
        </div>
      </header>

      <nav className="nav-tabs card" aria-label="Main sections">
        {NAV_SECTIONS.map((section) => (
          <button
            key={section.id}
            className={activeSection === section.id ? 'tab-active' : 'text-button'}
            onClick={() => setActiveSection(section.id)}
          >
            {section.label}
          </button>
        ))}
      </nav>

      {error && <p className="error">{error}</p>}

      {onboardingNeeded && (
        <section className="card onboarding-card">
          <h2>Set up your first account</h2>
          <p className="muted">
            Add at least one account with opening balance to start using the tracker.
          </p>
          <form className="stack" onSubmit={handleCreateAccount}>
            <input
              value={accountForm.name}
              onChange={(e) =>
                setAccountForm((prev) => ({ ...prev, name: e.target.value }))
              }
              placeholder="Account name"
              required
            />
            <select
              value={accountForm.accountType}
              onChange={(e) =>
                setAccountForm((prev) => ({
                  ...prev,
                  accountType: e.target.value,
                }))
              }
            >
              <option value="general">General</option>
              <option value="cash">Cash</option>
              <option value="bank">Bank</option>
              <option value="wallet">Wallet</option>
              <option value="credit">Credit</option>
            </select>
            <input
              type="number"
              step="0.01"
              value={accountForm.initialBalance}
              onChange={(e) =>
                setAccountForm((prev) => ({
                  ...prev,
                  initialBalance: e.target.value,
                }))
              }
              placeholder="Opening balance"
              required
            />
            <textarea
              rows="3"
              value={accountForm.description}
              onChange={(e) =>
                setAccountForm((prev) => ({
                  ...prev,
                  description: e.target.value,
                }))
              }
              placeholder="Short description"
            />
            <button type="submit">Create First Account</button>
          </form>
        </section>
      )}

      {dashboard && (
        <>
          {(activeSection === 'dashboard' || activeSection === 'insights') && (
            <>
              <section className="stats-grid">
                <article className="card">
                  <h3>Total Balance</h3>
                  <p className="value">INR {dashboard.walletBalance.toFixed(2)}</p>
                </article>
                <article className="card">
                  <h3>Total Income</h3>
                  <p className="value positive">INR {dashboard.totalIncome.toFixed(2)}</p>
                </article>
                <article className="card">
                  <h3>Total Expense</h3>
                  <p className="value negative">INR {dashboard.totalExpense.toFixed(2)}</p>
                </article>
                <article className="card">
                  <h3>Monthly Flow ({dashboard.month})</h3>
                  <p className={`value ${dashboard.monthlyNet >= 0 ? 'positive' : 'negative'}`}>
                    INR {dashboard.monthlyNet.toFixed(2)}
                  </p>
                  <p className="muted">
                    Savings Rate {dashboard.savingsRate}% | Top Category:{' '}
                    {dashboard.largestExpenseCategory?.category || 'N/A'}
                  </p>
                </article>
              </section>

              <section className="grid-two">
                <article className="card">
                  <div className="card-head">
                    <h2>Category-wise Expenses</h2>
                  </div>
                  <div className="chart-wrap">
                    <ResponsiveContainer width="100%" height={300}>
                      {chartType === 'pie' ? (
                        <PieChart>
                          <Pie
                            data={dashboard.expensesByCategory}
                            dataKey="total"
                            nameKey="category"
                            outerRadius={96}
                            label
                          >
                            {dashboard.expensesByCategory.map((entry, index) => (
                              <Cell
                                key={`${entry.category}-${index}`}
                                fill={CHART_COLORS[index % CHART_COLORS.length]}
                              />
                            ))}
                          </Pie>
                          <Tooltip />
                        </PieChart>
                      ) : chartType === 'bar' ? (
                        <BarChart data={dashboard.expensesByCategory}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="category" />
                          <YAxis />
                          <Tooltip />
                          <Bar dataKey="total" fill="#00f5a0" />
                        </BarChart>
                      ) : (
                        <LineChart data={dashboard.expensesByCategory}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="category" />
                          <YAxis />
                          <Tooltip />
                          <Line type="monotone" dataKey="total" stroke="#00d4ff" strokeWidth={2} />
                        </LineChart>
                      )}
                    </ResponsiveContainer>
                  </div>
                  <div className="chart-toggle">
                    <button onClick={() => setChartType('pie')} title="Pie chart">?</button>
                    <button onClick={() => setChartType('bar')} title="Bar chart">?</button>
                    <button onClick={() => setChartType('line')} title="Line chart">?</button>
                  </div>
                </article>

                <article className="card">
                  <h2>Daily Expense Calendar</h2>
                  <Calendar
                    value={dayjs(`${month}-01`).toDate()}
                    activeStartDate={dayjs(`${month}-01`).toDate()}
                    tileContent={({ date, view }) => {
                      if (view !== 'month') return null
                      const key = dayjs(date).format('YYYY-MM-DD')
                      const total = calendarLookup[key]
                      return total ? (
                        <span className="calendar-total">INR {Number(total).toFixed(0)}</span>
                      ) : null
                    }}
                  />
                </article>
              </section>

              <section className="card">
                <h2>Account-wise Monthly Overview</h2>
                <div className="chart-wrap">
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={dashboard.accountSummaries}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" />
                      <YAxis />
                      <Tooltip />
                      <Bar dataKey="monthlyIncome" fill="#14b8a6" />
                      <Bar dataKey="monthlyExpense" fill="#38bdf8" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Account</th>
                        <th>Type</th>
                        <th>Opening</th>
                        <th>Income</th>
                        <th>Expense</th>
                        <th>Transfer In</th>
                        <th>Transfer Out</th>
                        <th>Closing</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dashboard.accountSummaries.map((account) => (
                        <tr key={account.id}>
                          <td>{account.name}</td>
                          <td>{account.accountType}</td>
                          <td>INR {account.openingBalance.toFixed(2)}</td>
                          <td className="positive">INR {account.monthlyIncome.toFixed(2)}</td>
                          <td className="negative">INR {account.monthlyExpense.toFixed(2)}</td>
                          <td className="positive">INR {account.transferIn.toFixed(2)}</td>
                          <td className="negative">INR {account.transferOut.toFixed(2)}</td>
                          <td>INR {account.closingBalance.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}

          {(activeSection === 'accounts' || activeSection === 'dashboard') && (
            <section className="grid-two">
              <article className="card">
                <h2>Create Account</h2>
                <form className="stack" onSubmit={handleCreateAccount}>
                  <input
                    value={accountForm.name}
                    onChange={(e) =>
                      setAccountForm((prev) => ({ ...prev, name: e.target.value }))
                    }
                    placeholder="Account name"
                    required
                  />
                  <select
                    value={accountForm.accountType}
                    onChange={(e) =>
                      setAccountForm((prev) => ({
                        ...prev,
                        accountType: e.target.value,
                      }))
                    }
                  >
                    <option value="general">General</option>
                    <option value="cash">Cash</option>
                    <option value="bank">Bank</option>
                    <option value="wallet">Wallet</option>
                    <option value="credit">Credit</option>
                  </select>
                  <input
                    type="number"
                    step="0.01"
                    value={accountForm.initialBalance}
                    onChange={(e) =>
                      setAccountForm((prev) => ({ ...prev, initialBalance: e.target.value }))
                    }
                    placeholder="Opening balance"
                    required
                  />
                  <textarea
                    rows="3"
                    value={accountForm.description}
                    onChange={(e) =>
                      setAccountForm((prev) => ({
                        ...prev,
                        description: e.target.value,
                      }))
                    }
                    placeholder="Short description"
                  />
                  <button type="submit">Create Account</button>
                </form>
              </article>

              <article className="card">
                <h2>Manage Accounts</h2>
                <div className="stack">
                  {accounts.map((account) => (
                    <div className="inline-form actions-4" key={account.id}>
                      <label>{account.name}</label>
                      <input
                        type="number"
                        step="0.01"
                        value={balanceDrafts[account.id] ?? account.initialBalance}
                        onChange={(e) =>
                          setBalanceDrafts((prev) => ({
                            ...prev,
                            [account.id]: e.target.value,
                          }))
                        }
                      />
                      <button onClick={() => handleUpdateInitialBalance(account.id)}>
                        Save Opening
                      </button>
                      <button className="text-button" onClick={() => openEditAccountModal(account)}>
                        Edit
                      </button>
                      <button
                        className="danger-button"
                        onClick={() => handleDeleteAccount(account.id)}
                      >
                        Delete
                      </button>
                    </div>
                  ))}
                  {!accounts.length && <p className="muted">Create an account first.</p>}
                </div>
              </article>
            </section>
          )}

          {(activeSection === 'transactions' || activeSection === 'dashboard') && (
            <section className="card">
              <div className="header-inline">
                <h2>Transactions</h2>
                <button onClick={handleExportCsv}>Export CSV</button>
              </div>
              <form className="filters-grid" onSubmit={handleApplyTxFilters}>
                <input
                  type="month"
                  value={txFiltersDraft.month}
                  onChange={(e) => setTxFiltersDraft((prev) => ({ ...prev, month: e.target.value }))}
                />
                <input
                  type="date"
                  value={txFiltersDraft.startDate}
                  onChange={(e) => setTxFiltersDraft((prev) => ({ ...prev, startDate: e.target.value }))}
                />
                <input
                  type="date"
                  value={txFiltersDraft.endDate}
                  onChange={(e) => setTxFiltersDraft((prev) => ({ ...prev, endDate: e.target.value }))}
                />
                <select
                  value={txFiltersDraft.accountId}
                  onChange={(e) => setTxFiltersDraft((prev) => ({ ...prev, accountId: e.target.value }))}
                >
                  <option value="">All Accounts</option>
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>{account.name}</option>
                  ))}
                </select>
                <select
                  value={txFiltersDraft.type}
                  onChange={(e) => setTxFiltersDraft((prev) => ({ ...prev, type: e.target.value }))}
                >
                  <option value="">All Types</option>
                  <option value="income">Income</option>
                  <option value="expense">Expense</option>
                  <option value="transfer">Transfer</option>
                </select>
                <input
                  value={txFiltersDraft.category}
                  onChange={(e) => setTxFiltersDraft((prev) => ({ ...prev, category: e.target.value }))}
                  placeholder="Category"
                />
                <input
                  value={txFiltersDraft.search}
                  onChange={(e) => setTxFiltersDraft((prev) => ({ ...prev, search: e.target.value }))}
                  placeholder="Search"
                />
                <button type="submit">Apply Filters</button>
              </form>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Type</th>
                      <th>Account</th>
                      <th>Counterparty</th>
                      <th>Category</th>
                      <th>Description</th>
                      <th>Amount</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.map((tx) => (
                      <tr key={tx.id}>
                        <td>{tx.date}</td>
                        <td>
                          {tx.isTransfer
                            ? tx.transferDirection === 'out'
                              ? 'Transfer Out'
                              : 'Transfer In'
                            : tx.type}
                        </td>
                        <td>{tx.accountName}</td>
                        <td>{tx.linkedAccountName || '-'}</td>
                        <td>{tx.category}</td>
                        <td>{tx.description || '-'}</td>
                        <td className={tx.type === 'income' ? 'positive' : 'negative'}>
                          INR {tx.amount.toFixed(2)}
                        </td>
                        <td className="actions-cell">
                          <button className="text-button" onClick={() => openEditTxModal(tx)}>
                            Edit
                          </button>
                          <button
                            className="danger-button"
                            onClick={() => handleDeleteTransaction(tx.id)}
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {activeSection === 'transfers' && (
            <section className="card">
              <h2>Transfer Funds</h2>
              <form className="stack" onSubmit={handleCreateTransfer}>
                <select
                  value={transferForm.fromAccountId}
                  onChange={(e) =>
                    setTransferForm((prev) => ({ ...prev, fromAccountId: e.target.value }))
                  }
                  required
                >
                  <option value="">From account</option>
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>{account.name}</option>
                  ))}
                </select>
                <select
                  value={transferForm.toAccountId}
                  onChange={(e) =>
                    setTransferForm((prev) => ({ ...prev, toAccountId: e.target.value }))
                  }
                  required
                >
                  <option value="">To account</option>
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>{account.name}</option>
                  ))}
                </select>
                <input
                  type="number"
                  step="0.01"
                  value={transferForm.amount}
                  onChange={(e) => setTransferForm((prev) => ({ ...prev, amount: e.target.value }))}
                  placeholder="Amount"
                  required
                />
                <input
                  type="date"
                  value={transferForm.date}
                  onChange={(e) => setTransferForm((prev) => ({ ...prev, date: e.target.value }))}
                  required
                />
                <textarea
                  rows="2"
                  value={transferForm.description}
                  onChange={(e) =>
                    setTransferForm((prev) => ({ ...prev, description: e.target.value }))
                  }
                  placeholder="Description"
                />
                <button type="submit">Create Transfer</button>
              </form>
            </section>
          )}

          {activeSection === 'recurring' && (
            <section className="card">
              <div className="header-inline">
                <h2>Recurring Transactions</h2>
                <button onClick={handleRunRecurringNow}>Run Now</button>
              </div>
              <form className="filters-grid" onSubmit={handleCreateRecurring}>
                <select
                  value={recurringForm.accountId}
                  onChange={(e) =>
                    setRecurringForm((prev) => ({ ...prev, accountId: e.target.value }))
                  }
                  required
                >
                  <option value="">Account</option>
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>{account.name}</option>
                  ))}
                </select>
                <select
                  value={recurringForm.type}
                  onChange={(e) => setRecurringForm((prev) => ({ ...prev, type: e.target.value }))}
                >
                  <option value="expense">Expense</option>
                  <option value="income">Income</option>
                </select>
                <input
                  list="recurring-categories"
                  value={recurringForm.category}
                  onChange={(e) =>
                    setRecurringForm((prev) => ({ ...prev, category: e.target.value }))
                  }
                  placeholder="Category"
                  required
                />
                <datalist id="recurring-categories">
                  {recurringCategoryOptions.map((category) => (
                    <option key={category} value={category} />
                  ))}
                </datalist>
                <input
                  type="number"
                  step="0.01"
                  value={recurringForm.amount}
                  onChange={(e) => setRecurringForm((prev) => ({ ...prev, amount: e.target.value }))}
                  placeholder="Amount"
                  required
                />
                <input
                  value={recurringForm.description}
                  onChange={(e) =>
                    setRecurringForm((prev) => ({ ...prev, description: e.target.value }))
                  }
                  placeholder="Description"
                />
                <select
                  value={recurringForm.frequencyUnit}
                  onChange={(e) =>
                    setRecurringForm((prev) => ({ ...prev, frequencyUnit: e.target.value }))
                  }
                >
                  <option value="day">Day(s)</option>
                  <option value="week">Week(s)</option>
                  <option value="month">Month(s)</option>
                  <option value="year">Year(s)</option>
                </select>
                <input
                  type="number"
                  min="1"
                  value={recurringForm.frequencyInterval}
                  onChange={(e) =>
                    setRecurringForm((prev) => ({ ...prev, frequencyInterval: e.target.value }))
                  }
                  required
                />
                <input
                  type="date"
                  value={recurringForm.startDate}
                  onChange={(e) =>
                    setRecurringForm((prev) => ({ ...prev, startDate: e.target.value }))
                  }
                  required
                />
                <input
                  type="date"
                  value={recurringForm.endDate}
                  onChange={(e) =>
                    setRecurringForm((prev) => ({ ...prev, endDate: e.target.value }))
                  }
                  required
                />
                <button type="submit">Add Rule</button>
              </form>

              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Account</th>
                      <th>Type</th>
                      <th>Category</th>
                      <th>Amount</th>
                      <th>Every</th>
                      <th>Next Run</th>
                      <th>End</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recurringRules.map((rule) => (
                      <tr key={rule.id}>
                        <td>{rule.accountName}</td>
                        <td>{rule.type}</td>
                        <td>{rule.category}</td>
                        <td>INR {rule.amount.toFixed(2)}</td>
                        <td>{rule.frequencyInterval} {rule.frequencyUnit}(s)</td>
                        <td>{rule.nextRunDate}</td>
                        <td>{rule.endDate}</td>
                        <td>{rule.active ? 'Active' : 'Paused'}</td>
                        <td className="actions-cell">
                          <button className="text-button" onClick={() => handleToggleRecurring(rule)}>
                            {rule.active ? 'Pause' : 'Resume'}
                          </button>
                          <button className="danger-button" onClick={() => handleDeleteRecurring(rule.id)}>
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {activeSection === 'settings' && (
            <section className="card">
              <h2>Settings</h2>
              <p className="muted">
                Scheduled recurring job runs hourly in backend service. Configure `CRON_SECRET` and use
                `/api/internal/run-recurring` for external schedulers if needed.
              </p>
            </section>
          )}
        </>
      )}

      {isTxModalOpen && (
        <div className="modal-backdrop" onClick={() => setIsTxModalOpen(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h2>{editingTxId ? 'Edit' : 'Add'} {txType === 'expense' ? 'Expense' : 'Income'}</h2>
            <form className="stack" onSubmit={handleSaveTransaction}>
              <select
                value={txForm.accountId}
                onChange={(e) =>
                  setTxForm((prev) => ({ ...prev, accountId: e.target.value }))
                }
                required
              >
                <option value="">Select account</option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </select>
              <input
                list="tx-categories"
                value={txForm.category}
                onChange={(e) =>
                  setTxForm((prev) => ({ ...prev, category: e.target.value }))
                }
                placeholder={txType === 'expense' ? 'Expense category' : 'Income source'}
                required
              />
              <datalist id="tx-categories">
                {categoryOptions.map((category) => (
                  <option key={category} value={category} />
                ))}
              </datalist>
              <textarea
                rows="3"
                value={txForm.description}
                onChange={(e) =>
                  setTxForm((prev) => ({ ...prev, description: e.target.value }))
                }
                placeholder="Description"
              />
              <input
                type="date"
                value={txForm.date}
                onChange={(e) =>
                  setTxForm((prev) => ({ ...prev, date: e.target.value }))
                }
                required
              />
              <input
                type="number"
                step="0.01"
                value={txForm.amount}
                onChange={(e) =>
                  setTxForm((prev) => ({ ...prev, amount: e.target.value }))
                }
                placeholder="Amount"
                required
              />
              <button type="submit">{editingTxId ? 'Update' : 'Save'}</button>
            </form>
          </div>
        </div>
      )}

      {editingAccountId && (
        <div className="modal-backdrop" onClick={() => setEditingAccountId(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h2>Edit Account</h2>
            <form className="stack" onSubmit={handleEditAccount}>
              <input
                value={accountForm.name}
                onChange={(e) =>
                  setAccountForm((prev) => ({ ...prev, name: e.target.value }))
                }
                placeholder="Account name"
                required
              />
              <select
                value={accountForm.accountType}
                onChange={(e) =>
                  setAccountForm((prev) => ({
                    ...prev,
                    accountType: e.target.value,
                  }))
                }
              >
                <option value="general">General</option>
                <option value="cash">Cash</option>
                <option value="bank">Bank</option>
                <option value="wallet">Wallet</option>
                <option value="credit">Credit</option>
              </select>
              <textarea
                rows="3"
                value={accountForm.description}
                onChange={(e) =>
                  setAccountForm((prev) => ({
                    ...prev,
                    description: e.target.value,
                  }))
                }
                placeholder="Short description"
              />
              <button type="submit">Update Account</button>
            </form>
          </div>
        </div>
      )}
    </main>
  )
}

export default App
