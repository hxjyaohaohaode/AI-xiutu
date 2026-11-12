import type { Locale } from '../i18n';

export type OverviewScreenName =
  | 'workspace'
  | 'desktop-flow'
  | 'local'
  | 'portrait'
  | 'layers'
  | 'tablet'
  | 'phone'
  | 'library'
  | 'collaboration'
  | 'assistant'
  | 'delivery';

export type OverviewCopy = {
  skip: string;
  home: string;
  nav: string[];
  login: string;
  start: string;
  resume: string;
  heroLabel: string;
  heroTitle: string[];
  heroBody: string;
  scroll: string;
  screen: string;
  craftLabel: string;
  craftTitle: string[];
  craftBody: string;
  craftItems: string[][];
  portraitLabel: string;
  portraitTitle: string[];
  portraitBody: string;
  portraitItems: string[];
  layersLabel: string;
  layersTitle: string[];
  layersBody: string;
  layersItems: string[];
  assistantLabel: string;
  assistantTitle: string[];
  assistantBody: string;
  assistantSteps: string[][];
  assistantNote: string;
  togetherLabel: string;
  togetherTitle: string[];
  togetherBody: string;
  togetherItems: string[][];
  devicesTitle: string;
  devicesBody: string;
  deviceLabels: string[];
  libraryTitle: string;
  libraryBody: string;
  screenError: string;
  retry: string;
  deliveryLabel: string;
  deliveryTitle: string[];
  deliveryBody: string;
  deliveryItems: string[];
  deliveryAction: string;
  questionsTitle: string;
  questions: string[][];
  endTitle: string;
  footer: string;
  backTop: string;
  alts: Record<OverviewScreenName, string>;
};

const copy: Record<Locale, OverviewCopy> = {
  'zh-CN': {
    skip: '跳至内容',
    home: '首页',
    nav: ['精修', 'AI 助手', '协作与交付'],
    login: '登录',
    start: '打开工作台',
    resume: '继续编辑',
    heroLabel: '照片编辑 · AI 创作 · 团队协作',
    heroTitle: ['从第一张照片，', '到最终交付。'],
    heroBody: '调色、局部、人像与图层，在一张画布上完成；作品、讨论与版本，留在同一个项目里。',
    scroll: '向下探索',
    screen: '真实工作台界面',
    craftLabel: '01 / 精修',
    craftTitle: ['看清整体，', '调准每一处。'],
    craftBody: '全局定下光影与色彩，局部选区处理细节。选中参数就能拖动，也能直接输入准确数值。',
    craftItems: [
      ['光影与色彩', '曝光、白平衡、曲线与 HSL。'],
      ['RAW · HDR 原件', '保留原件，高精度调整曲线与局部色彩。'],
      ['局部调整', '画出选区，只改变需要改变的地方。'],
      ['随时比较', '查看原图与当前效果，保留每一步修改。'],
    ],
    portraitLabel: '02 / 人像',
    portraitTitle: ['选中一个人，', '专注一处细节。'],
    portraitBody: '识别人像后，再调节肤质、五官和身形。保留原片与每一步编辑，随时对照力度。',
    portraitItems: ['美肤与五官', '身形与姿态', '力度随时可调'],
    layersLabel: '03 / 绘制与合成',
    layersTitle: ['照片、文字、手绘，', '各有自己的图层。'],
    layersBody:
      '在画布中安排位置，逐层调整尺寸、透明度与混合。需要时继续修改，不必把所有内容压在一起。',
    layersItems: ['画笔与形状', '文字与图片图层', '位置、透明度与混合'],
    assistantLabel: '04 / AI 助手',
    assistantTitle: ['告诉助手你的想法。', '由你决定最后一步。'],
    assistantBody: '输入要求、提供参考或选定范围。查看真实候选与变更，再决定应用、继续调整或放弃。',
    assistantSteps: [
      ['描述想法', '选择当前照片、参考图或选区。'],
      ['查看候选', '在画面中预览，继续补充要求。'],
      ['确认应用', '满意后采用；也可以取消预览。'],
    ],
    assistantNote: '在线模型、语音与生成能力取决于当前服务配置和账号额度。',
    togetherLabel: '05 / 项目与协作',
    togetherTitle: ['从一个人的创作，', '到一群人的配合。'],
    togetherBody: '作品、素材、版本、讨论与任务归在项目里。成员按权限协作，编辑有迹可循。',
    togetherItems: [
      ['作品与素材', '整理图片，复用素材，随时打开继续编辑。'],
      ['讨论与任务', '围绕同一份作品沟通，把待办留在项目中。'],
      ['版本与权限', '查看修改记录，为成员分配相应权限。'],
      ['项目文档', '说明、记录与交付要求，和作品放在一起。'],
    ],
    devicesTitle: '换个屏幕，继续创作。',
    devicesBody: '桌面展开多区工作台，平板留出画布，手机集中显示当前工具与参数。',
    deviceLabels: ['平板工作台', '手机工作台'],
    deliveryLabel: '06 / 交付',
    deliveryTitle: ['对照效果，', '带走完成的作品。'],
    deliveryBody: '导出当前画面，选择 PNG、JPEG 或 WebP；也可以保存调色配方，继续编辑同一份原图。',
    deliveryItems: ['PNG · JPEG · WebP', '原图与效果对照', '调色配方'],
    deliveryAction: '开始编辑',
    questionsTitle: '开始之前，你可能想知道',
    questions: [
      [
        '需要先注册吗？',
        '可以直接打开工作台，在本地编辑照片。保存云端项目、团队协作与在线 AI 服务需要登录。',
      ],
      [
        '照片会自动上传吗？',
        '本地打开与编辑不会自动上传。使用云端项目或在线服务时，再按实际操作上传所需内容。',
      ],
      ['能撤销修改吗？', '编辑过程中可以撤销、重做与比较原图；云端作品还可查看已保存的版本。'],
      [
        'AI 会直接覆盖作品吗？',
        '调节候选先预览，再由你确认采用。在线生成任务、模型与额度在工作台内查看。',
      ],
    ],
    endTitle: '下一张作品，从这里开始。',
    footer: '照片编辑与创作工作台',
    backTop: '返回顶部',
    alts: {
      workspace: '精修工作台：当前照片、工具与调节参数',
      local: '局部编辑工作台：选区与调色控制',
      portrait: '人像编辑工作台：实际照片与人像参数',
      layers: '图层工作台：绘制、图层与画布',
      tablet: '平板工作台实际界面',
      phone: '手机工作台实际界面',
      library: '项目作品与素材的实际界面',
      collaboration: '项目讨论与任务的实际界面',
      assistant: 'AI 助手的实际输入界面与当前服务状态',
      'desktop-flow': '桌面端同时显示照片、调节和 AI 助手',
      delivery: '图片导出的实际格式、质量与下载界面',
    },
    libraryTitle: '素材和作品，回到同一个项目。',
    libraryBody: '找到原图，打开已有作品，查看保存的版本。项目里的文件与编辑记录一起保留。',
    screenError: '界面预览暂未载入',
    retry: '重新加载',
  },
  'zh-TW': {
    skip: '跳至內容',
    home: '首頁',
    nav: ['精修', 'AI 助手', '協作與交付'],
    login: '登入',
    start: '開啟工作台',
    resume: '繼續編輯',
    heroLabel: '照片編輯 · AI 創作 · 團隊協作',
    heroTitle: ['從第一張照片，', '到最終交付。'],
    heroBody: '調色、局部、人像與圖層，在一張畫布上完成；作品、討論與版本，留在同一個專案裡。',
    scroll: '向下探索',
    screen: '真實工作台介面',
    craftLabel: '01 / 精修',
    craftTitle: ['看清整體，', '調準每一處。'],
    craftBody: '全域定下光影與色彩，局部選區處理細節。選取參數就能拖動，也能直接輸入準確數值。',
    craftItems: [
      ['光影與色彩', '曝光、白平衡、曲線與 HSL。'],
      ['RAW · HDR 原件', '保留原件，以高精度調整曲線與局部色彩。'],
      ['局部調整', '畫出選區，只改變需要改變的地方。'],
      ['隨時比較', '查看原圖與目前效果，保留每一步修改。'],
    ],
    portraitLabel: '02 / 人像',
    portraitTitle: ['選中一個人，', '專注一處細節。'],
    portraitBody: '辨識人像後，再調整膚質、五官和身形。保留原片與每一步編輯，隨時對照力度。',
    portraitItems: ['美膚與五官', '身形與姿態', '力度隨時可調'],
    layersLabel: '03 / 繪製與合成',
    layersTitle: ['照片、文字、手繪，', '各有自己的圖層。'],
    layersBody:
      '在畫布中安排位置，逐層調整尺寸、透明度與混合。需要時繼續修改，不必把所有內容壓在一起。',
    layersItems: ['畫筆與形狀', '文字與圖片圖層', '位置、透明度與混合'],
    assistantLabel: '04 / AI 助手',
    assistantTitle: ['告訴助手你的想法。', '由你決定最後一步。'],
    assistantBody: '輸入要求、提供參考或選定範圍。查看真實候選與變更，再決定套用、繼續調整或放棄。',
    assistantSteps: [
      ['描述想法', '選擇目前照片、參考圖或選區。'],
      ['查看候選', '在畫面中預覽，繼續補充要求。'],
      ['確認套用', '滿意後採用；也可以取消預覽。'],
    ],
    assistantNote: '線上模型、語音與生成能力取決於目前服務設定和帳號額度。',
    togetherLabel: '05 / 專案與協作',
    togetherTitle: ['從一個人的創作，', '到一群人的配合。'],
    togetherBody: '作品、素材、版本、討論與任務歸在專案裡。成員依權限協作，編輯有跡可循。',
    togetherItems: [
      ['作品與素材', '整理圖片，重用素材，隨時開啟繼續編輯。'],
      ['討論與任務', '圍繞同一份作品溝通，把待辦留在專案中。'],
      ['版本與權限', '查看修改記錄，為成員分配相應權限。'],
      ['專案文件', '說明、記錄與交付要求，和作品放在一起。'],
    ],
    devicesTitle: '換個螢幕，繼續創作。',
    devicesBody: '桌面展開多區工作台，平板留出畫布，手機集中顯示目前工具與參數。',
    deviceLabels: ['平板工作台', '手機工作台'],
    deliveryLabel: '06 / 交付',
    deliveryTitle: ['對照效果，', '帶走完成的作品。'],
    deliveryBody: '匯出目前畫面，選擇 PNG、JPEG 或 WebP；也可以儲存調色配方，繼續編輯同一份原圖。',
    deliveryItems: ['PNG · JPEG · WebP', '原圖與效果對照', '調色配方'],
    deliveryAction: '開始編輯',
    questionsTitle: '開始之前，你可能想知道',
    questions: [
      [
        '需要先註冊嗎？',
        '可以直接開啟工作台，在本機編輯照片。儲存雲端專案、團隊協作與線上 AI 服務需要登入。',
      ],
      [
        '照片會自動上傳嗎？',
        '在本機開啟與編輯不會自動上傳。使用雲端專案或線上服務時，再依實際操作上傳所需內容。',
      ],
      ['能復原修改嗎？', '編輯過程中可以復原、重做與比較原圖；雲端作品還可查看已儲存的版本。'],
      [
        'AI 會直接覆寫作品嗎？',
        '調整候選先預覽，再由你確認採用。線上生成任務、模型與額度在工作台內查看。',
      ],
    ],
    endTitle: '下一張作品，從這裡開始。',
    footer: '照片編輯與創作工作台',
    backTop: '返回頂部',
    alts: {
      workspace: '精修工作台：目前照片、工具與調整參數',
      local: '局部編輯工作台：選區與調色控制',
      portrait: '人像編輯工作台：實際照片與人像參數',
      layers: '圖層工作台：繪製、圖層與畫布',
      tablet: '平板工作台實際介面',
      phone: '手機工作台實際介面',
      library: '專案作品與素材的實際介面',
      collaboration: '專案討論與任務的實際介面',
      assistant: 'AI 助手的實際輸入介面與目前服務狀態',
      'desktop-flow': '電腦同時顯示照片、調整與 AI 助理',
      delivery: '圖片匯出的實際格式、品質與下載介面',
    },
    libraryTitle: '素材和作品，回到同一個專案。',
    libraryBody: '找到原圖，開啟既有作品，查看儲存的版本。專案裡的檔案與編輯記錄一起保留。',
    screenError: '介面預覽暫未載入',
    retry: '重新載入',
  },
  en: {
    skip: 'Skip to content',
    home: 'Home',
    nav: ['Editing', 'AI assistant', 'Work together'],
    login: 'Sign in',
    start: 'Open the studio',
    resume: 'Continue editing',
    heroLabel: 'PHOTO EDITING · AI CREATION · COLLABORATION',
    heroTitle: ['From the first photo.', 'To the final delivery.'],
    heroBody:
      'Colour, local adjustments, portraits and layers on one canvas. Keep your work, conversations and versions in the same project.',
    scroll: 'Explore the studio',
    screen: 'Actual studio interface',
    craftLabel: '01 / EDITING',
    craftTitle: ['See the whole image.', 'Refine each detail.'],
    craftBody:
      'Set the light and colour, then work inside a local selection. Drag the chosen control or enter an exact value.',
    craftItems: [
      ['Light and colour', 'Exposure, white balance, curves and HSL.'],
      [
        'RAW and HDR originals',
        'Keep the source file and grade curves and local color in a high-precision master.',
      ],
      ['Local adjustments', 'Select the area you want to change.'],
      ['Compare as you go', 'Review the original and your current edit.'],
    ],
    portraitLabel: '02 / PORTRAITS',
    portraitTitle: ['Choose a person.', 'Focus on the detail.'],
    portraitBody:
      'Detect the portrait, then refine skin, facial features and body shape. Keep the original and compare the strength of each edit.',
    portraitItems: ['Skin and facial details', 'Body and pose', 'Adjustable intensity'],
    layersLabel: '03 / DRAWING & COMPOSITION',
    layersTitle: ['Photos, text and drawing.', 'Each on its own layer.'],
    layersBody:
      'Arrange the canvas and adjust size, opacity and blending layer by layer. Return to any part of the composition as your idea changes.',
    layersItems: ['Brushes and shapes', 'Text and image layers', 'Position, opacity and blending'],
    assistantLabel: '04 / AI ASSISTANT',
    assistantTitle: ['Give the assistant an idea.', 'Keep the final decision.'],
    assistantBody:
      'Describe a change, add a reference or choose an area. Review actual candidates and changes before applying, refining or discarding them.',
    assistantSteps: [
      ['Describe', 'Choose a photograph, reference or selection.'],
      ['Preview', 'See the candidate on the canvas and refine your request.'],
      ['Apply', 'Keep the result you like, or cancel the preview.'],
    ],
    assistantNote:
      'Online models, voice and generation depend on service configuration and your account allowance.',
    togetherLabel: '05 / PROJECTS & COLLABORATION',
    togetherTitle: ['Your creative space.', "Your team's, too."],
    togetherBody:
      'Keep work, assets, versions, conversations and tasks together. Give each collaborator the access they need.',
    togetherItems: [
      ['Work and assets', 'Organise images, reuse assets and return to an edit.'],
      ['Conversations and tasks', 'Discuss the same work and keep the next steps with it.'],
      ['Versions and access', 'Review saved changes and manage member permissions.'],
      ['Project documents', 'Keep notes, decisions and delivery requirements with the work.'],
    ],
    devicesTitle: 'Another screen. The same focus.',
    devicesBody:
      'Multiple work areas on desktop, room for the canvas on tablet, and focused tools and controls on mobile.',
    deviceLabels: ['Tablet studio', 'Mobile studio'],
    deliveryLabel: '06 / DELIVERY',
    deliveryTitle: ['Review the result.', 'Take your work with you.'],
    deliveryBody:
      'Export the current image as PNG, JPEG or WebP. Save the colour recipe to continue editing the same original.',
    deliveryItems: ['PNG · JPEG · WebP', 'Before and after', 'Colour recipes'],
    deliveryAction: 'Start editing',
    questionsTitle: 'Before you begin',
    questions: [
      [
        'Do I need an account?',
        'Open the studio and edit locally without signing in. Cloud projects, collaboration and online AI services require an account.',
      ],
      [
        'Are my photographs uploaded automatically?',
        'Opening and editing locally does not upload your photographs. Cloud projects and online services upload the content needed for the action you choose.',
      ],
      [
        'Can I undo changes?',
        'Undo, redo and compare with the original while editing. Cloud work also retains saved versions for review.',
      ],
      [
        'Does AI overwrite my work?',
        'Preview adjustment candidates before applying them. Online generation tasks, models and allowance are shown in the studio.',
      ],
    ],
    endTitle: 'Your next image starts here.',
    footer: 'The photo editing and creative studio',
    backTop: 'Back to top',
    alts: {
      workspace: 'The actual editing studio with a photograph, tools and adjustment controls',
      local: 'The actual local editing studio with a selection and colour controls',
      portrait: 'The actual portrait studio with a photograph and portrait adjustments',
      layers: 'The actual layer workspace with drawing tools and canvas',
      tablet: 'The actual studio on a tablet-sized screen',
      phone: 'The actual studio on a mobile-sized screen',
      library: 'Actual project artwork and asset library',
      collaboration: 'Actual project conversations and tasks',
      assistant: 'Actual assistant input and current service availability',
      'desktop-flow': 'Desktop editor with the photo, adjustments and AI assistant open together',
      delivery: 'Actual image export format, quality and download controls',
    },
    libraryTitle: 'Assets and artwork, together.',
    libraryBody:
      'Find the original, reopen an existing work and review its saved versions. Files and editing records stay with the project.',
    screenError: 'The interface preview could not load',
    retry: 'Reload',
  },
};

export function overviewCopy(locale: Locale): OverviewCopy {
  return copy[locale];
}
