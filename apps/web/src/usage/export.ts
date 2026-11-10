import { usageEndpoint, type UsageFilter } from './model';

/** Follow the server's fixed high-water cursor. Never label a first page as a full report. */
export async function collectUsageCsv(
  filter: UsageFilter,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<Blob> {
  const frozenFilter = { ...filter };
  const chunks: string[] = [],
    seen = new Set<string>();
  let cursor: string | undefined,
    header = '',
    bytes = 0;
  do {
    signal?.throwIfAborted();
    const url = new URL(
      '/v1' + usageEndpoint(frozenFilter, cursor, 'csv'),
      'https://same-origin.invalid',
    );
    url.searchParams.set('limit', '500');
    const response = await fetcher(url.pathname + url.search, { credentials: 'include', signal });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new Error(body?.error?.message ?? '用量导出未完成，未保存不完整文件。');
    }
    if (!(response.headers.get('content-type') ?? '').includes('text/csv'))
      throw new Error('服务器没有返回 CSV，未保存不完整的导出。');
    const page = (await response.text()).replace(/^\uFEFF/, '');
    signal?.throwIfAborted();
    const breakAt = page.indexOf('\r\n');
    if (breakAt < 0) throw new Error('用量文件结构不完整，请重试。');
    const nextHeader = page.slice(0, breakAt);
    if (header && nextHeader !== header) throw new Error('导出期间账本格式改变，请重新导出。');
    if (!header) {
      header = nextHeader;
      chunks.push('\uFEFF' + header + '\r\n');
    }
    // Only remove the known header. Quoted CSV cell values may themselves contain newlines.
    const body = page.slice(breakAt + 2);
    bytes += new TextEncoder().encode(body).byteLength;
    if (bytes > 64 * 1024 * 1024)
      throw new Error('这个范围的账本超过本机 64 MiB 导出预算，请缩小日期后重试。');
    chunks.push(body);
    cursor = response.headers.get('x-next-cursor') ?? undefined;
    if (cursor) {
      if (seen.has(cursor)) throw new Error('账本分页没有继续前进，未保存不完整的导出。');
      seen.add(cursor);
    }
  } while (cursor);
  signal?.throwIfAborted();
  return new Blob(chunks, { type: 'text/csv;charset=utf-8' });
}
