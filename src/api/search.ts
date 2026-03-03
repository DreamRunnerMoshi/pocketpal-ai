import axios from 'axios';

const SERPER_BASE = 'https://google.serper.dev';

interface SerperOrganicResult {
  title?: string;
  link?: string;
  snippet?: string;
  position?: number;
}

interface SerperSearchResponse {
  organic?: SerperOrganicResult[];
}

const MAX_RESULTS = 8;

/**
 * Search the web via Serper API and return a formatted string of results
 * suitable for injection into the model context.
 *
 * @param query - Search query string
 * @param apiKey - Serper API key (from env)
 * @returns Formatted string of title, snippet, and link per result, or error message
 */
export async function searchWeb(
  query: string,
  apiKey: string | undefined,
): Promise<string> {
  if (!apiKey || !apiKey.trim()) {
    return '[Web search is not configured. Add SERPER_API_KEY to .env]';
  }

  const trimmed = query.trim();
  if (!trimmed) {
    return '';
  }

  try {
    const response = await axios.post<SerperSearchResponse>(
      `${SERPER_BASE}/search`,
      { q: trimmed, num: MAX_RESULTS },
      {
        headers: {
          'X-API-KEY': apiKey,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      },
    );

    const organic = response.data?.organic;
    if (!organic || !Array.isArray(organic) || organic.length === 0) {
      return '[No web results found for this query.]';
    }

    const lines = organic.slice(0, MAX_RESULTS).map((r, i) => {
      const title = r.title ?? 'No title';
      const snippet = r.snippet ?? '';
      const link = r.link ?? '';
      return `${i + 1}. ${title}\n   ${snippet}\n   ${link}`;
    });

    return lines.join('\n\n');
  } catch (error) {
    const message =
      axios.isAxiosError(error) && error.response?.data
        ? String(error.response.data)
        : error instanceof Error
          ? error.message
          : 'Unknown error';
    console.warn('Web search failed:', message);
    return `[Web search failed: ${message}]`;
  }
}
