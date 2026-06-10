'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

export default function LoginForm() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { token, user } = await api.auth.login(username, password);
      if (rememberMe) {
        localStorage.setItem('token', token);
        localStorage.setItem('user', JSON.stringify(user));
      } else {
        sessionStorage.setItem('token', token);
        sessionStorage.setItem('user', JSON.stringify(user));
        localStorage.removeItem('token');
      }
      router.push('/realtime-map');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form id="formAuthentication" className="mb-5" onSubmit={handleSubmit} noValidate>

      {error && (
        <div className="alert alert-danger d-flex align-items-center mb-5" role="alert">
          <i className="ri ri-error-warning-line me-2"></i>
          <span>{error}</span>
        </div>
      )}

      {/* Username */}
      <div className="form-floating form-floating-outline mb-5">
        <input
          type="text"
          className="form-control"
          id="email"
          name="email-username"
          placeholder="Enter your username"
          autoFocus
          value={username}
          onChange={e => setUsername(e.target.value)}
          required
        />
        <label htmlFor="email">Username</label>
      </div>

      {/* Password */}
      <div className="mb-5">
        <div className="form-password-toggle">
          <div className="input-group input-group-merge">
            <div className="form-floating form-floating-outline">
              <input
                type={showPassword ? 'text' : 'password'}
                id="password"
                className="form-control"
                name="password"
                placeholder="············"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
              />
              <label htmlFor="password">Password</label>
            </div>
            <span
              className="input-group-text cursor-pointer"
              onClick={() => setShowPassword(p => !p)}
              role="button"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              <i className={`ri ${showPassword ? 'ri-eye-line' : 'ri-eye-off-line'} icon-20px`}></i>
            </span>
          </div>
        </div>
      </div>

      {/* Remember me / Forgot password */}
      <div className="mb-5 pb-2 d-flex justify-content-between pt-2 align-items-center">
        <div className="form-check mb-0">
          <input
            className="form-check-input"
            type="checkbox"
            id="remember-me"
            checked={rememberMe}
            onChange={e => setRememberMe(e.target.checked)}
          />
          <label className="form-check-label" htmlFor="remember-me">
            Remember Me
          </label>
        </div>
        <a href="/forgot-password" className="float-end mb-1">
          <span>Forgot Password?</span>
        </a>
      </div>

      {/* Submit */}
      <div className="mb-5">
        <button
          className="btn btn-login d-grid w-100"
          type="submit"
          disabled={loading}
        >
          {loading ? (
            <>
              <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
              Signing in…
            </>
          ) : (
            'Login'
          )}
        </button>
      </div>

    </form>
  );
}
