// Login — refi-portal sign-in. Same Doorkeeper password grant as
// MissionControl (see src/lib/session.ts → submitLogin), rendered in the
// refi substrate (React 19 + tailwind-style classes, no redux/redux-form).
//
// On success the shared `blinker_session` cookie is written, so the user is
// also signed in to MissionControl (and any other Blinker subdomain) without
// a second login.
import { useState } from 'react';
import type { FC, FormEvent } from 'react';
import { RefreshCcw, Loader2 } from 'lucide-react';
import { submitLogin } from '../lib/session';

interface LoginProps {
  onAuthed: () => void;
}

const Login: FC<LoginProps> = ({ onAuthed }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await submitLogin(email.trim(), password);
      if (result.duoRequired) {
        setError(
          'This account requires two-factor (Duo) sign-in. Please log in via MissionControl, then return here — you will be signed in automatically.',
        );
        return;
      }
      onAuthed();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-white border border-slate-200 rounded-xl shadow-sm p-8">
        <div className="flex items-center gap-2 mb-6">
          <div className="w-8 h-8 bg-blue-600 rounded-md flex items-center justify-center">
            <RefreshCcw className="w-4 h-4 text-white" />
          </div>
          <span className="font-semibold tracking-tight text-lg">Refi Portal</span>
        </div>

        <h1 className="text-xl font-semibold tracking-tight mb-1">Sign in</h1>
        <p className="text-sm text-slate-500 mb-6">
          Use your Blinker / MissionControl credentials.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-slate-700 mb-1">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
              placeholder="you@blinker.com"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-slate-700 mb-1">
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting || !email || !password}
            className="w-full inline-flex items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
};

export { Login };
export default Login;
