import { CalendarBlank, FolderSimple } from '@phosphor-icons/react';
import { t } from '../i18n';
import BranchedMenu from '../components/react-bits/BranchedMenu';

export type FolderGroup = 'date' | 'project' | 'source' | 'type';
export type FolderCount = { key: string; count: number };
export type LibraryFolder = { key: string; label: string; count: number; children?: LibraryFolder[] };

export function libraryFolders(groups: FolderCount[], label: (key: string) => string, by: FolderGroup): LibraryFolder[] {
  if (by !== 'date') return groups.map(({ key, count }) => ({ key, count, label: label(key) }));
  const years = new Map<string, LibraryFolder>();
  const months = new Map<string, LibraryFolder>();
  for (const { key, count } of groups) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) continue;
    const year = key.slice(0, 4);
    const month = key.slice(0, 7);
    if (!years.has(year)) years.set(year, { key: year, label: label(year), count: 0, children: [] });
    const yearFolder = years.get(year)!;
    yearFolder.count += count;
    if (!months.has(month)) {
      const folder = { key: month, label: label(month), count: 0, children: [] as LibraryFolder[] };
      months.set(month, folder);
      yearFolder.children!.push(folder);
    }
    const monthFolder = months.get(month)!;
    monthFolder.count += count;
    monthFolder.children!.push({ key, count, label: label(key) });
  }
  return [...years.values()];
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

export function LibraryFolders({ folders, selected, onSelect, by }: {
  folders: LibraryFolder[];
  selected: string;
  onSelect(key: string): void;
  by: FolderGroup;
}) {
  const name = (folder: LibraryFolder) => `${folder.label} · ${folder.count}`;
  const row = (folder: LibraryFolder) => ({ label: name(folder), value: folder.key,
    icon: by === 'date' ? <CalendarBlank size={16} /> : <FolderSimple size={16} /> });
  const appearance = { color: 'var(--ink)', accentColor: 'var(--accent-ink)', lineColor: 'var(--line)', width: 212 };
  return (
    <div className="library-folders">
      <BranchedMenu key={folders.length ? 'ready' : 'empty'} {...appearance} ariaLabel={t('素材目录')}
        defaultOpen={folders.length ? 1 : -1}
        activeValue={selected || 'all'} onSelect={(value) => onSelect(value === 'all' ? '' : value)}
        items={[
          { label: t('全部素材'), value: 'all' },
          ...(by === 'date' ? folders.map((year) => ({
            label: name(year), value: year.key,
            children: year.children?.map(row),
            childrenTree: year.children?.find((month) => selected.startsWith(month.key))?.children && (
              <BranchedMenu {...appearance} className="library-days" defaultOpen={0} activeValue={selected}
                onSelect={onSelect} items={[{ label: t('按日查看'),
                  children: year.children.find((month) => selected.startsWith(month.key))!.children!.map(row) }]} />
            ),
          })) : [{ label: t(by === 'project' ? '按项目' : by === 'type' ? '按类型' : '按来源'),
            children: folders.map(row) }]),
        ]} />
    </div>
  );
}
