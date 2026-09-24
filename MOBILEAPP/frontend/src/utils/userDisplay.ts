import { userService } from '../services/userService';
import { requestCache } from './requestCache';

/**
 * Display helpers for rendering a user in the UI.
 *
 * These are view-layer only: they never touch the value a form binds or submits.
 * Dropdowns keep posting user ids / emails exactly as before, only the label changes.
 */

// Anything user-shaped we render. Kept loose because the different endpoints hand
// back slightly different shapes (`email` vs `email_address`, name parts vs full_name).
export interface DisplayableUser {
  full_name?: string | null;
  name?: string | null;
  first_name?: string | null;
  middle_initial?: string | null;
  last_name?: string | null;
  username?: string | null;
  email_address?: string | null;
  email?: string | null;
}

/**
 * Resolve the label for a user: full name first, email last.
 *
 * Order: `full_name`/`name` (appended by the User model) -> assembled name parts ->
 * `username` -> email -> `fallback`.
 */
export const getUserDisplayName = (user?: DisplayableUser | null, fallback = ''): string => {
  if (!user) return fallback;

  const fullName = (user.full_name || user.name || '').trim();
  if (fullName) return fullName;

  const assembled = [user.first_name, user.middle_initial ? `${user.middle_initial}.` : '', user.last_name]
    .map(part => (part || '').trim())
    .filter(Boolean)
    .join(' ');
  if (assembled) return assembled;

  return (user.username || '').trim() || (user.email_address || user.email || '').trim() || fallback;
};

export type UserDirectory = Record<string, string>;

const USER_DIRECTORY_KEY = 'user-directory';
const USER_DIRECTORY_TTL = 5 * 60 * 1000;

/**
 * Build a lowercased `email -> full name` map from a single `/users` call.
 *
 * Some tables persist the actor as an email string rather than a foreign key
 * (`service_orders.requested_by`, `work_orders.requested_by`). This lets those views
 * render a name without a lookup per row. The result is cached and de-duplicated by
 * `requestCache`, so concurrent callers share one request.
 */
export const loadUserDirectory = async (): Promise<UserDirectory> => {
  try {
    return await requestCache.get<UserDirectory>(
      USER_DIRECTORY_KEY,
      async () => {
        const response = await userService.getAllUsers();
        const directory: UserDirectory = {};

        (response?.data || []).forEach(user => {
          const email = (user?.email_address || '').trim().toLowerCase();
          const displayName = getUserDisplayName(user as DisplayableUser);
          if (email && displayName && displayName.toLowerCase() !== email) {
            directory[email] = displayName;
          }
        });

        return directory;
      },
      USER_DIRECTORY_TTL
    );
  } catch (error: any) {
    console.error('Load user directory error:', error?.message || error);
    return {};
  }
};

export const invalidateUserDirectory = () => requestCache.invalidate(USER_DIRECTORY_KEY);

/**
 * Swap a stored email for its full name when the directory knows it.
 * Anything else (already a name, `N/A`, empty) is passed through untouched.
 */
export const resolveUserDisplayName = (
  value?: string | null,
  directory?: UserDirectory | null,
  fallback = ''
): string => {
  const raw = (value || '').trim();
  if (!raw) return fallback;
  return directory?.[raw.toLowerCase()] || raw;
};
