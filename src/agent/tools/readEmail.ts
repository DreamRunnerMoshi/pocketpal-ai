import {DynamicStructuredTool} from '@langchain/core/tools';
import {z} from 'zod';
import {fetchMessagesSummary} from '../../services/gmail/GmailService';

/**
 * Creates the read_email tool. The tool needs the current Google access token at invoke time
 * (from GoogleSignin.getTokens()), so we accept a getter.
 */
export function createReadEmailTool(
  getAccessToken: () => Promise<string | null | undefined>,
): DynamicStructuredTool {
  return new DynamicStructuredTool({
    name: 'read_email',
    description:
      'Read the user\'s Gmail messages. Use an optional Gmail search query (e.g. "is:unread", "from:someone@example.com"). Returns subject, from, date, and snippet for each message. If Gmail is not connected, returns a message asking the user to connect.',
    schema: z.object({
      query: z
        .string()
        .optional()
        .describe('Optional Gmail search query (e.g. is:unread, from:user@example.com)'),
      maxResults: z
        .number()
        .min(1)
        .max(20)
        .optional()
        .default(5)
        .describe('Maximum number of emails to return (default 5)'),
    }),
    func: async ({query, maxResults}) => {
      const accessToken = await getAccessToken();
      return fetchMessagesSummary(accessToken, query, maxResults);
    },
  });
}
