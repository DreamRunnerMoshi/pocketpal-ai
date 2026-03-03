/**
 * Provides Google access token for Gmail API. Uses existing Google Sign-In;
 * for Gmail read, the user may need to add scope via addScopes (e.g. from Settings).
 */
import {GoogleSignin} from '@react-native-google-signin/google-signin';

const GMAIL_READ_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

/**
 * Returns the current Google access token if the user is signed in.
 * Can be used for Gmail API; if Gmail scope was not granted, API calls will fail with 403
 * and the Gmail service returns a user-friendly message.
 */
export async function getGmailAccessToken(): Promise<string | null> {
  try {
    const user = GoogleSignin.getCurrentUser();
    if (!user) return null;
    const {accessToken} = await GoogleSignin.getTokens();
    return accessToken ?? null;
  } catch {
    return null;
  }
}

/**
 * Request Gmail read scope. Call when user opts in (e.g. "Connect Gmail" in settings).
 * Returns true if scope was granted (or already present).
 */
export async function requestGmailScope(): Promise<boolean> {
  try {
    const result = await GoogleSignin.addScopes({
      scopes: [GMAIL_READ_SCOPE],
    });
    return result?.type === 'success';
  } catch {
    return false;
  }
}
