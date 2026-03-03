/**
 * Gmail API client for reading messages on-device using Google Sign-In access token.
 * Requires scope: https://www.googleapis.com/auth/gmail.readonly
 */

const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

export interface GmailMessageSummary {
  id: string;
  threadId: string;
  snippet?: string;
  subject?: string;
  date?: string;
  from?: string;
}

/**
 * List message IDs (and minimal metadata) for the user.
 * @param accessToken - Google OAuth2 access token from GoogleSignin.getTokens()
 * @param query - Optional Gmail search query (e.g. "is:unread", "from:someone@example.com")
 * @param maxResults - Max number of messages to return (default 10)
 */
export async function listMessages(
  accessToken: string,
  query?: string,
  maxResults: number = 10,
): Promise<{messages: Array<{id: string; threadId: string}>; nextPageToken?: string}> {
  const params = new URLSearchParams();
  params.set('maxResults', String(Math.min(maxResults, 50)));
  if (query?.trim()) params.set('q', query.trim());

  const url = `${GMAIL_API_BASE}/messages?${params.toString()}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gmail list: ${res.status} ${body || res.statusText}`);
  }

  const data = await res.json();
  const messages = (data.messages ?? []).map((m: {id: string; threadId: string}) => ({
    id: m.id,
    threadId: m.threadId,
  }));
  return {messages, nextPageToken: data.nextPageToken};
}

/**
 * Get a single message by ID (metadata + payload for subject/body).
 * @param accessToken - Google OAuth2 access token
 * @param messageId - Gmail message ID
 */
export async function getMessage(
  accessToken: string,
  messageId: string,
): Promise<GmailMessageSummary> {
  const url = `${GMAIL_API_BASE}/messages/${encodeURIComponent(messageId)}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gmail get: ${res.status} ${body || res.statusText}`);
  }

  const data = await res.json();
  const headers = data.payload?.headers ?? [];
  const getHeader = (name: string) =>
    headers.find((h: {name: string; value: string}) => h.name.toLowerCase() === name.toLowerCase())?.value;

  return {
    id: data.id,
    threadId: data.threadId,
    snippet: data.snippet,
    subject: getHeader('Subject'),
    date: getHeader('Date'),
    from: getHeader('From'),
  };
}

/**
 * Fetch messages and return a plain-text summary for the LLM.
 * On missing token or 403, returns a user-facing message so the model can reply in natural language.
 */
export async function fetchMessagesSummary(
  accessToken: string | null | undefined,
  query?: string,
  maxResults: number = 5,
): Promise<string> {
  if (!accessToken?.trim()) {
    return 'Gmail is not connected. Sign in with Google and grant read access to email in settings.';
  }

  try {
    const {messages} = await listMessages(accessToken, query, maxResults);
    if (messages.length === 0) {
      return 'No emails found for this query.';
    }

    const summaries: string[] = [];
    for (let i = 0; i < messages.length; i++) {
      const msg = await getMessage(accessToken, messages[i].id);
      const line = [
        `${i + 1}.`,
        msg.subject ? `Subject: ${msg.subject}` : '',
        msg.from ? `From: ${msg.from}` : '',
        msg.date ? `Date: ${msg.date}` : '',
        msg.snippet ? `Snippet: ${msg.snippet}` : '',
      ]
        .filter(Boolean)
        .join(' ');
      summaries.push(line);
    }
    return summaries.join('\n\n');
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (message.includes('401') || message.includes('403') || message.includes('invalid_grant')) {
      return 'Gmail is not connected or access was denied. Sign in with Google and grant read access to email in settings.';
    }
    return `Failed to read email: ${message}`;
  }
}
