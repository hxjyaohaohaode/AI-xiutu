import { getLocale, type Locale } from '../i18n';

const zh = {
  colorRangeHelp: '色段与连续选区',
  paletteHelp: '色谱与取色',
  localCount: '局部',
  groupHelp: '分组如何生效',
  currentRegion: '当前局部',
  currentGroup: '当前分组',
  addNamedToGroup: '将{name}加入编组选择',
  hideNamed: '隐藏{name}',
  showNamed: '显示{name}',
} as const;

const copy: Record<Locale, Record<keyof typeof zh, string>> = {
  'zh-CN': zh,
  'zh-TW': {
    colorRangeHelp: '色段與連續選區',
    paletteHelp: '色譜與取色',
    localCount: '局部',
    groupHelp: '分組如何生效',
    currentRegion: '目前局部',
    currentGroup: '目前分組',
    addNamedToGroup: '將{name}加入編組選擇',
    hideNamed: '隱藏{name}',
    showNamed: '顯示{name}',
  },
  en: {
    colorRangeHelp: 'Bands and color selections',
    paletteHelp: 'Color spectrum and sampling',
    localCount: 'Regions',
    groupHelp: 'How groups work',
    currentRegion: 'Current region',
    currentGroup: 'Current group',
    addNamedToGroup: 'Add {name} to group selection',
    hideNamed: 'Hide {name}',
    showNamed: 'Show {name}',
  },
};

export const editorFlowText = (
  key: keyof typeof zh,
  values?: Readonly<Record<string, string | number>>,
): string => {
  const text = copy[getLocale()][key];
  return values
    ? text.replace(/\{(\w+)\}/g, (placeholder, name: string) =>
        values[name] === undefined ? placeholder : String(values[name]),
      )
    : text;
};
