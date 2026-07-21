/**
 * The route guard. Unauthenticated visitors go to the sign-in screen; everyone else sees
 * the shell (FR-006).
 *
 * There is no loading state, deliberately. The session is hydrated synchronously from the
 * local store during the provider's first render, so by the time this runs the answer is
 * already known. A spinner here would appear on every cold start, offline, for a farmer
 * whose session was on the device the whole time.
 */

import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './AuthProvider';

export function RequireAuth() {
  const { isAuthenticated, mustEnrolSecondFactor } = useAuth();
  const location = useLocation();

  if (!isAuthenticated) {
    // Remember where they were headed, so signing in lands them there rather than dumping
    // them on the home grid having forgotten what they opened the app to do.
    return <Navigate to="/sign-in" replace state={{ from: location.pathname }} />;
  }

  // The server refuses every route but enrolment for an owner or bookkeeper without a
  // second factor (FR-014). Sending them there is the client agreeing with a decision the
  // API has already made — not the client enforcing it. The enforcement is server-side.
  if (mustEnrolSecondFactor && !location.pathname.startsWith('/security')) {
    return <Navigate to="/security/second-factor" replace />;
  }

  return <Outlet />;
}
