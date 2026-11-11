import type { Locale } from '../i18n';

const zh = {
  tour: '工作台导览',
  image: '真实工作台 · 本地编辑',
  hero: [
    { title: '作品在中心', body: '原片、预览与对比留在同一张画布。放大查看，细节不用靠猜。' },
    {
      title: '工具在手边',
      body: '明暗、色彩、曲线与局部各有自己的控制。切换工具，接着刚才的选择。',
    },
    {
      title: '每一步有来处',
      body: '查看编辑记录，撤销或重做。需要 AI 和协作时，再把上下文交给它们。',
    },
  ],
  detail: '查看界面细节',
  closeDetail: '返回功能导览',
  sample: '示例素材',
  progress: '创作工具',
  sections: [
    ['画布与原片', '色彩控制', '工具与记录'],
    ['选区与范围', '局部参数', '工具与记录'],
    ['人物与画布', '手动精修', '工具与记录'],
    ['画布与图层', '合成控制', '工具与记录'],
  ],
};
const en: typeof zh = {
  tour: 'A tour of the studio',
  image: 'Actual studio · Local editing',
  hero: [
    {
      title: 'The image stays central',
      body: 'Your original, preview and comparison share one canvas. Zoom in and judge the detail.',
    },
    {
      title: 'Tools stay close',
      body: 'Light, colour, curves and local edits have their own controls. Switch tools and keep your place.',
    },
    {
      title: 'A way back at every step',
      body: 'Review the edit history, undo and redo. Bring AI or collaborators into the context when you need them.',
    },
  ],
  detail: 'Inspect the interface',
  closeDetail: 'Back to the tour',
  sample: 'Sample material',
  progress: 'Creative tools',
  sections: [
    ['Canvas & original', 'Colour controls', 'Tools & history'],
    ['Selection & scope', 'Local controls', 'Tools & history'],
    ['Subject & canvas', 'Manual retouching', 'Tools & history'],
    ['Canvas & layers', 'Composition controls', 'Tools & history'],
  ],
};
const tw: typeof zh = {
  tour: '工作台導覽',
  image: '真實工作台 · 本地編輯',
  hero: [
    { title: '作品在中心', body: '原片、預覽與對比留在同一張畫布。放大查看，細節不用靠猜。' },
    {
      title: '工具在手邊',
      body: '明暗、色彩、曲線與局部各有自己的控制。切換工具，接著剛才的選擇。',
    },
    {
      title: '每一步有來處',
      body: '查看編輯記錄，撤銷或重做。需要 AI 和協作時，再把上下文交給它們。',
    },
  ],
  detail: '查看介面細節',
  closeDetail: '返回功能導覽',
  sample: '示例素材',
  progress: '創作工具',
  sections: [
    ['畫布與原片', '色彩控制', '工具與記錄'],
    ['選區與範圍', '局部參數', '工具與記錄'],
    ['人物與畫布', '手動精修', '工具與記錄'],
    ['畫布與圖層', '合成控制', '工具與記錄'],
  ],
};
export const productCopy = (locale: Locale) =>
  locale === 'en' ? en : locale === 'zh-TW' ? tw : zh;
