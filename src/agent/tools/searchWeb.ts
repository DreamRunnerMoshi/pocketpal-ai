import {DynamicStructuredTool} from '@langchain/core/tools';
import {z} from 'zod';
import {searchWeb as searchWebApi} from '../../api/search';
import {SERPER_API_KEY} from '@env';

export const searchWebTool = new DynamicStructuredTool({
  name: 'search_web',
  description:
    'Search the internet for up-to-date information. Use this when you need current facts, news, or general web results.',
  schema: z.object({
    query: z.string().describe('The search query to look up on the web'),
  }),
  func: async (input: {query: string}) => {
    console.log('[search_web] called with query:', input.query);
    const result = await searchWebApi(input.query, SERPER_API_KEY);
    console.log('[search_web] result length:', result.length, 'preview:', result.slice(0, 350) + (result.length > 350 ? '...' : ''));
    return result;
  },
});
