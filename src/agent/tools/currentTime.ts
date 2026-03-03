import {DynamicStructuredTool} from '@langchain/core/tools';
import {z} from 'zod';

function getCurrentTimeInfo(_input: {timezone?: string}): string {
  const now = new Date();
  const iso = now.toISOString();
  const locale = now.toLocaleString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
  return `Current date and time:\n- ISO 8601: ${iso}\n- Human-readable: ${locale}`;
}

export const currentTimeTool = new DynamicStructuredTool({
  name: 'current_time',
  description:
    'Get the current date and time on this device. Use when the user asks "what time is it?", "what\'s the date?", "what day is it?", or any question about the current moment.',
  schema: z.object({
    timezone: z
      .string()
      .optional()
      .describe('Optional timezone (e.g. UTC, America/New_York). If omitted, device local time is used.'),
  }),
  func: async (input: {timezone?: string}) => {
    console.log('[current_time] called with timezone:', input.timezone ?? '(device local)');
    const result = getCurrentTimeInfo(input);
    return result;
  },
});
