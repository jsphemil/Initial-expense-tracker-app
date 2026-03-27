import { useEffect, useMemo, useState } from 'react'
import dayjs from 'dayjs'
import Calendar from 'react-calendar'
import {
  Bar,
  BarChart,
  CartesianGrid,
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
  const [isTxModalOpen, setIsTxModalOpen] = useState(false)
  const [isAccountModalOpen, setIsAccountModalOpen] = useState(false)
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
  })
  const [balanceDrafts, setBalanceDrafts] = useState({})

  useEffect(() => {
    setAuthToken(token)
  }, [token])

  useEffect(() => {
    if (!token) return
    loadAllData()
  }, [token, month])

  const loadAllData = async () => {
    try {
      setError('')
      const [dashRes, accountRes, txRes] = await Promise.all([
        api.get('/dashboard', { params: { month } }),
        api.get('/accounts'),
        api.get('/transactions'),
      ])
      setDashboard(dashRes.data)
      setAccounts(accountRes.data.accounts)
      setTransactions(txRes.data.transactions)
    } catch (err) {
      setError(err.response?.data?.error || 'Could not load dashboard data.')
      if (err.response?.status === 401) {
        handleLogout()
      }
    }
  }

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

  const handleLogout = () => {
    localStorage.removeItem('expense_token')
    setToken('')
    setDashboard(null)
    setAccounts([])
    setTransactions([])
  }

  const handleCreateAccount = async (event) => {
    event.preventDefault()
    if (!accountForm.name.trim()) return
    try {
      await api.post('/accounts', accountForm)
      setAccountForm({ name: '', accountType: 'general', description: '' })
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
    const confirmed = window.confirm('Delete this transaction?')
    if (!confirmed) return
    try {
      await api.delete(`/transactions/${txId}`)
      await loadAllData()
    } catch (err) {
      setError(err.response?.data?.error || 'Could not delete transaction.')
    }
  }

  const openEditAccountModal = (account) => {
    setEditingAccountId(account.id)
    setAccountForm({
      name: account.name,
      accountType: account.accountType,
      description: account.description || '',
    })
    setIsAccountModalOpen(true)
  }

  const handleEditAccount = async (event) => {
    event.preventDefault()
    if (!editingAccountId) return
    try {
      await api.patch(`/accounts/${editingAccountId}`, accountForm)
      setIsAccountModalOpen(false)
      setEditingAccountId(null)
      setAccountForm({ name: '', accountType: 'general', description: '' })
      await loadAllData()
    } catch (err) {
      setError(err.response?.data?.error || 'Could not update account.')
    }
  }

  const handleDeleteAccount = async (accountId) => {
    const confirmed = window.confirm(
      'Delete this account? This is allowed only when the account has no transactions.',
    )
    if (!confirmed) return
    try {
      await api.delete(`/accounts/${accountId}`)
      await loadAllData()
    } catch (err) {
      setError(err.response?.data?.error || 'Could not delete account.')
    }
  }

  const calendarLookup = useMemo(() => {
    if (!dashboard) return {}
    return Object.fromEntries(
      dashboard.dailyExpenses.map((entry) => [entry.date, entry.total]),
    )
  }, [dashboard])

  if (!token) {
    return (
      <main className="auth-shell">
        <section className="card auth-card">
          <h1>Expense Tracker</h1>
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
      <header className="topbar">
        <h1>Wallet Dashboard</h1>
        <div className="topbar-actions">
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            aria-label="Select month"
          />
          <button onClick={() => openTxModal('expense')}>Add Expense</button>
          <button onClick={() => openTxModal('income')}>Add Income</button>
          <button className="text-button" onClick={handleLogout}>
            Logout
          </button>
        </div>
      </header>

      {error && <p className="error">{error}</p>}

      {dashboard && (
        <>
          <section className="stats-grid">
            <article className="card">
              <h3>Wallet Balance</h3>
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
              <h3>{dashboard.month} Summary</h3>
              <p className="muted">
                Income INR {dashboard.monthlyIncome.toFixed(2)} | Expense INR{' '}
                {dashboard.monthlyExpense.toFixed(2)}
              </p>
            </article>
          </section>

          <section className="grid-two">
            <article className="card">
              <h2>Category-wise Expenses</h2>
              <div className="chart-wrap">
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={dashboard.expensesByCategory}
                      dataKey="total"
                      nameKey="category"
                      outerRadius={100}
                      fill="#0ea5e9"
                      label
                    />
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
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
                  <Bar dataKey="monthlyIncome" fill="#16a34a" />
                  <Bar dataKey="monthlyExpense" fill="#dc2626" />
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
                      <td>INR {account.closingBalance.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

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

      <section className="card">
        <h2>Recent Transactions</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th>Account</th>
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
                  <td>{tx.type}</td>
                  <td>{tx.accountName}</td>
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
                value={txForm.category}
                onChange={(e) =>
                  setTxForm((prev) => ({ ...prev, category: e.target.value }))
                }
                placeholder={txType === 'expense' ? 'Expense category' : 'Income source'}
                required
              />
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

      {isAccountModalOpen && (
        <div className="modal-backdrop" onClick={() => setIsAccountModalOpen(false)}>
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
