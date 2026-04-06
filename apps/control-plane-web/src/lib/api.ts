import axios from 'axios';
import { getToken, removeToken, removeActiveOrgId } from './auth';

const baseURL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000/api';

export const api = axios.create({
  baseURL,
  headers: {
    'Content-Type': 'application/json',
  },
});

api.interceptors.request.use(
  (config) => {
    const token = getToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 || error.response?.status === 403) {
      // Handle ACCESS_EXPIRED, ORG_SUSPENDED, AUTH_TOKEN_EXPIRED
      const code = error.response?.data?.code;
      if (
        code === 'ACCESS_EXPIRED' ||
        code === 'AUTH_TOKEN_EXPIRED' ||
        error.response.status === 401
      ) {
        removeToken();
        removeActiveOrgId();
        if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
          window.location.href = '/login?reason=session_expired';
        }
      }
    }
    return Promise.reject(error);
  }
);
