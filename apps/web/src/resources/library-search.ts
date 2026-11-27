import type { AssetOrientation, AssetSource } from '@ai-xiutu/contracts';
type TimeWindow = { start: Date; end?: Date };
export type LibrarySearch = {
  text: string;
  mime?: string;
  source?: AssetSource;
  orientation?: AssetOrientation;
  time?: TimeWindow;
  empty: boolean;
};

const formats: Record<string, string> = {
  jpg: 'jpeg',
  jpeg: 'jpeg',
  png: 'png',
  webp: 'webp',
  gif: 'gif',
  avif: 'avif',
};
const sources: Record<string, AssetSource> = {
  上传: 'upload',
  上傳: 'upload',
  uploaded: 'upload',
  生成图: 'generated',
  生成圖: 'generated',
  ai生成: 'generated',
  generated: 'generated',
  手绘: 'sketch',
  手繪: 'sketch',
  sketch: 'sketch',
  加工素材: 'derived',
  derived: 'derived',
};
const orientations: Record<string, AssetOrientation> = {
  竖图: 'portrait', 直幅: 'portrait', 豎圖: 'portrait', portrait: 'portrait',
  横图: 'landscape', 橫圖: 'landscape', 橫幅: 'landscape', landscape: 'landscape',
  方图: 'square', 方圖: 'square', square: 'square',
};
function timeWindow(value: string, now: Date): TimeWindow | null {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const days = value.match(/^(?:最近|近|last)([1-9]\d{0,2})(?:天|d|days?)$/u)?.[1];
  if (days || ['今天', '今日', 'today'].includes(value)) {
    start.setDate(start.getDate() - (Number(days ?? 1) - 1));
    return { start };
  }
  if (['昨天', '昨日', 'yesterday'].includes(value)) {
    const end = new Date(start);
    start.setDate(start.getDate() - 1);
    return { start, end };
  }
  const day = /^(\d{4})-(\d\d)-(\d\d)$/.exec(value);
  if (!day || Number(day[1]) < 1000) return null;
  start.setFullYear(Number(day[1]), Number(day[2]) - 1, Number(day[3]));
  if (start.getMonth() !== Number(day[2]) - 1 || start.getDate() !== Number(day[3])) return null;
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

/** Recognize complete search terms only. A quoted name remains a literal,
 * including text such as "today", file extensions and consecutive spaces. */
export function parseLibrarySearch(input: string, now: Date): LibrarySearch {
  const result: LibrarySearch = { text: '', empty: false };
  const words: string[] = [];
  const parts = input.match(/"[^"]*"|“[^”]*”|\S+/gu) ?? [];
  for (let i = 0; i < parts.length; i++) {
    const token = parts[i]!;
    if (
      (token.startsWith('"') && token.endsWith('"')) ||
      (token.startsWith('“') && token.endsWith('”'))
    ) {
      words.push(token.slice(1, -1));
      continue;
    }
    let lower = token.toLowerCase();
    if (lower === 'ai' && parts[i + 1] === '生成') {
      lower = 'ai生成';
      i++;
    }
    if (
      lower === 'last' &&
      /^[1-9]\d{0,2}$/.test(parts[i + 1] ?? '') &&
      /^days?$/i.test(parts[i + 2] ?? '')
    ) {
      lower += parts[i + 1] + 'days';
      i += 2;
    }
    const format = Object.hasOwn(formats, lower) ? formats[lower] : undefined;
    const source = Object.hasOwn(sources, lower) ? sources[lower] : undefined;
    const orientation = Object.hasOwn(orientations, lower) ? orientations[lower] : undefined;
    if (format) {
      const mime = 'image/' + format;
      if (result.mime && result.mime !== mime) result.empty = true;
      result.mime = mime;
    } else if (source) {
      if (result.source && result.source !== source) result.empty = true;
      result.source = source;
    } else if (orientation) {
      if (result.orientation && result.orientation !== orientation) result.empty = true;
      result.orientation = orientation;
    } else {
      const time = timeWindow(lower, now);
      if (!time) {
        words.push(token);
        continue;
      }
      const previous = result.time;
      const start = previous && previous.start > time.start ? previous.start : time.start;
      const end =
        time.end && previous?.end
          ? time.end < previous.end
            ? time.end
            : previous.end
          : (time.end ?? previous?.end);
      result.time = { start, end };
      if (end && end <= start) result.empty = true;
    }
  }
  result.text =
    !result.mime && !result.source && !result.orientation && !result.time && !/["“”]/u.test(input)
      ? input.trim()
      : words.join(' ');
  return result;
}

export function dateFolderRange(key: string) {
  const [year, month, day] = key.split('-').map(Number);
  if (!year || !/^\d{4}(-\d{2}){0,2}$/.test(key)) return null;
  const start = new Date(year, (month ?? 1) - 1, day ?? 1);
  const end = new Date(start);
  if (day !== undefined) end.setDate(end.getDate() + 1);
  else if (month !== undefined) end.setMonth(end.getMonth() + 1);
  else end.setFullYear(end.getFullYear() + 1);
  return { start, end };
}
