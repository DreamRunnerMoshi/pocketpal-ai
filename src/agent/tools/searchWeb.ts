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
    return searchWebApi(input.query, SERPER_API_KEY);
  },
});
