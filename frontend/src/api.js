import axios from 'axios'

const apiBase = import.meta.env.DEV
  ? '/api'
  : `${(import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')}/api`

export const api = axios.create({
  baseURL: apiBase || '/api',
})

export const setAuthToken = (token) => {
  if (token) {
    api.defaults.headers.common.Authorization = `Bearer ${token}`
  } else {
    delete api.defaults.headers.common.Authorization
  }
}
