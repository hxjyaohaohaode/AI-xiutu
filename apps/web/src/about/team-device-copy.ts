import type { Locale } from '../i18n';

export type TeamDemoRole = 'owner' | 'admin' | 'editor' | 'reviewer' | 'viewer';

const zh = {
  teamDemo: '协作方式演示',
  roleLabel: '试试不同角色',
  roles: {
    owner: '所有者',
    admin: '管理员',
    editor: '编辑者',
    reviewer: '审阅者',
    viewer: '查看者',
  },
  edit: '精修并保存',
  comment: '评论与审阅',
  invite: '邀请成员',
  allowed: '可用',
  unavailable: '无此权限',
  roleNotes: {
    owner: '安排分工、邀请成员，也能移交团队所有权。',
    admin: '可邀请编辑者、审阅者和查看者；管理员由所有者邀请。',
    editor: '调整、保存和讨论作品，成员权限由团队管理者安排。',
    reviewer: '留下评论，处理自己的反馈；保存编辑交给编辑者。',
    viewer: '查看获准作品与版本。读取权限也允许下载已有内容。',
  },
  personalTitle: '从自己的作品开始。',
  personalBody: '精修、比较与版本在一个地方。需要共同创作时，再创建团队并安排角色。',
  imageAlt: '实际局部编辑工作台，展示照片、选区和参数面板',
  scenes: [
    {
      title: '让修改范围看得见。',
      body: '选中需要处理的局部，再调整光线。成员的游标与当前区域围绕同一件作品显示。',
      marker: '光线区域',
      detail: '局部调光',
    },
    {
      title: '一起编辑，也保留边界。',
      body: '不相交的局部可以分工。同一目标或重叠区域，会先保护正在进行的修改。',
      marker: '独立局部',
      detail: '区域协作',
    },
    {
      title: '把反馈留在作品旁。',
      body: '评论关联作品与版本，也可以标记具体位置。讨论留下依据，精修继续沿着版本推进。',
      marker: '画面反馈',
      detail: '版本评论',
    },
  ],
  versionsLabel: '版本关系示意',
  versions: [
    {
      name: '原始版本',
      action: '导入并建立起点',
      detail: '保留原片，调整从这一版出发。',
      parent: '原片 → V1',
    },
    {
      name: '局部调光',
      action: '在 V1 上追加调整',
      detail: '形成 V2，V1 仍可查看与对比。',
      parent: 'V1 → V2',
    },
    {
      name: '反馈后精修',
      action: '沿 V2 继续完善',
      detail: '形成 V3，旧版本与修改过程保留。',
      parent: 'V2 → V3',
    },
  ],
  deviceDetailLabel: '当前设备的工作方式',
  devices: [
    {
      title: '展开细节，保留全局。',
      body: '画布与参数并排工作。展开曲线、图层和局部，按习惯移动或停靠面板。',
      steps: ['看全图', '调参数', '对比与导出'],
      alt: '实际桌面工作台，宽画布与可停靠的精修面板',
    },
    {
      title: '工具随手，画面在眼前。',
      body: '在适合平板的空间里选择区域、调整参数。收起面板即可回看完整作品。',
      steps: ['选定区域', '展开工具', '收起看全图'],
      alt: '实际 1024 × 768 平板工作台，适应平板视口的画布与工具布局',
    },
    {
      title: '一次专注一个调整。',
      body: '底部工具接上当前参数。逐层进入、随时返回，主要滑杆与数值就在手边。',
      steps: ['选择工具', '滑动微调', '返回画面'],
      alt: '实际手机工作台，底部工具栏与当前参数面板',
    },
  ],
};

const tw: typeof zh = {
  teamDemo: '協作方式示範',
  roleLabel: '試試不同角色',
  roles: {
    owner: '擁有者',
    admin: '管理員',
    editor: '編輯者',
    reviewer: '審閱者',
    viewer: '檢視者',
  },
  edit: '精修並儲存',
  comment: '評論與審閱',
  invite: '邀請成員',
  allowed: '可用',
  unavailable: '無此權限',
  roleNotes: {
    owner: '安排分工、邀請成員，也能移交團隊擁有權。',
    admin: '可邀請編輯者、審閱者和檢視者；管理員由擁有者邀請。',
    editor: '調整、儲存和討論作品，成員權限由團隊管理者安排。',
    reviewer: '留下評論，處理自己的回饋；儲存編輯交給編輯者。',
    viewer: '檢視獲准作品與版本。讀取權限也允許下載已有內容。',
  },
  personalTitle: '從自己的作品開始。',
  personalBody: '精修、比較與版本在同一處。需要共同創作時，再建立團隊並安排角色。',
  imageAlt: '實際局部編輯工作台，顯示照片、選區和參數面板',
  scenes: [
    {
      title: '讓修改範圍看得見。',
      body: '選中需要處理的局部，再調整光線。成員游標與目前區域圍繞同一件作品顯示。',
      marker: '光線區域',
      detail: '局部調光',
    },
    {
      title: '一起編輯，也保留邊界。',
      body: '不相交的局部可以分工。同一目標或重疊區域，會先保護正在進行的修改。',
      marker: '獨立局部',
      detail: '區域協作',
    },
    {
      title: '把回饋留在作品旁。',
      body: '評論關聯作品與版本，也可以標記具體位置。討論留下依據，精修沿著版本繼續。',
      marker: '畫面回饋',
      detail: '版本評論',
    },
  ],
  versionsLabel: '版本關係示範',
  versions: [
    {
      name: '原始版本',
      action: '匯入並建立起點',
      detail: '保留原片，調整從這一版出發。',
      parent: '原片 → V1',
    },
    {
      name: '局部調光',
      action: '在 V1 上追加調整',
      detail: '形成 V2，V1 仍可查看與比較。',
      parent: 'V1 → V2',
    },
    {
      name: '回饋後精修',
      action: '沿 V2 繼續完善',
      detail: '形成 V3，舊版本與修改過程保留。',
      parent: 'V2 → V3',
    },
  ],
  deviceDetailLabel: '目前裝置的工作方式',
  devices: [
    {
      title: '展開細節，保留全局。',
      body: '畫布與參數並排工作。展開曲線、圖層和局部，按習慣移動或停靠面板。',
      steps: ['看全圖', '調參數', '比較與匯出'],
      alt: '實際桌面工作台，寬畫布與可停靠的精修面板',
    },
    {
      title: '工具隨手，畫面在眼前。',
      body: '在適合平板的空間裡選擇區域、調整參數。收起面板即可回看完整作品。',
      steps: ['選定區域', '展開工具', '收起看全圖'],
      alt: '實際 1024 × 768 平板工作台，適應平板視口的畫布與工具配置',
    },
    {
      title: '一次專注一個調整。',
      body: '底部工具接上目前參數。逐層進入、隨時返回，主要滑桿與數值就在手邊。',
      steps: ['選擇工具', '滑動微調', '返回畫面'],
      alt: '實際手機工作台，底部工具列與目前參數面板',
    },
  ],
};

const en: typeof zh = {
  teamDemo: 'Collaboration walkthrough',
  roleLabel: 'Explore a role',
  roles: {
    owner: 'Owner',
    admin: 'Admin',
    editor: 'Editor',
    reviewer: 'Reviewer',
    viewer: 'Viewer',
  },
  edit: 'Edit & save',
  comment: 'Comment & review',
  invite: 'Invite members',
  allowed: 'Available',
  unavailable: 'Not permitted',
  roleNotes: {
    owner: 'Assign roles, invite members, or transfer ownership of the team.',
    admin: 'Invite editors, reviewers and viewers. Only the owner can invite another admin.',
    editor: 'Edit, save and discuss work. Team managers handle membership permissions.',
    reviewer: 'Leave comments and resolve your own feedback. Editors save image changes.',
    viewer:
      'View permitted work and versions. Read access also permits downloading existing content.',
  },
  personalTitle: 'Start with your own work.',
  personalBody:
    'Keep editing, comparison and versions together. Create a team and assign roles when you want to work with others.',
  imageAlt: 'Actual local editing workspace with the image, selection and adjustment panel',
  scenes: [
    {
      title: 'See where changes happen.',
      body: 'Select an area, then adjust its light. Shared cursors and editing regions stay connected to the same artwork.',
      marker: 'Light region',
      detail: 'Local lighting',
    },
    {
      title: 'Create together, with clear boundaries.',
      body: 'Separate regions can be shared between editors. The same target or overlapping areas protect the edit already in progress.',
      marker: 'Local region',
      detail: 'Region collaboration',
    },
    {
      title: 'Keep feedback beside the work.',
      body: 'Comments connect to an artwork and version, with optional position markers. Discussion informs the next revision.',
      marker: 'Image feedback',
      detail: 'Version comments',
    },
  ],
  versionsLabel: 'Version relationship walkthrough',
  versions: [
    {
      name: 'Original',
      action: 'Import a starting point',
      detail: 'Keep the source. Begin editing from this version.',
      parent: 'Source → V1',
    },
    {
      name: 'Local light',
      action: 'Add an adjustment to V1',
      detail: 'Create V2. V1 stays available to inspect and compare.',
      parent: 'V1 → V2',
    },
    {
      name: 'Refinement',
      action: 'Continue from V2',
      detail: 'Create V3. Earlier versions and their changes remain.',
      parent: 'V2 → V3',
    },
  ],
  deviceDetailLabel: 'Workflow on the selected device',
  devices: [
    {
      title: 'Open the details. Keep the whole.',
      body: 'Work with the canvas and parameters side by side. Open curves, layers and regions, then move or dock the panel.',
      steps: ['See the whole', 'Refine values', 'Compare & export'],
      alt: 'Actual desktop workspace with a wide canvas and a dockable editing panel',
    },
    {
      title: 'Tools at hand. Your image in view.',
      body: 'Select regions and adjust values in a tablet-sized workspace. Collapse the panel to see the complete image again.',
      steps: ['Select an area', 'Open the tools', 'See the whole'],
      alt: 'Actual 1024 by 768 tablet workspace with a viewport-specific canvas and tool layout',
    },
    {
      title: 'Focus on one adjustment.',
      body: 'The bottom toolbar connects to the current parameter. Step into a tool, adjust a value, then return to the image.',
      steps: ['Choose a tool', 'Fine-tune', 'Return to image'],
      alt: 'Actual phone workspace with a bottom toolbar and current parameter panel',
    },
  ],
};

export function teamDeviceCopy(locale: Locale) {
  return locale === 'en' ? en : locale === 'zh-TW' ? tw : zh;
}
