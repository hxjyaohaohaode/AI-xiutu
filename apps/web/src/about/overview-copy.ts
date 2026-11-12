import type { Locale } from '../i18n';

export type OverviewCopy = {
  skip: string; home: string; nav: string[]; login: string; start: string; resume: string;
  heroLabel: string; heroTitle: string[]; heroBody: string; scroll: string; screen: string;
  craftLabel: string; craftTitle: string[]; craftBody: string; craftItems: string[][];
  portraitLabel: string; portraitTitle: string[]; portraitBody: string; portraitItems: string[];
  layersLabel: string; layersTitle: string[]; layersBody: string; layersItems: string[];
  assistantLabel: string; assistantTitle: string[]; assistantBody: string;
  assistantSteps: string[][]; assistantNote: string;
  togetherLabel: string; togetherTitle: string[]; togetherBody: string; togetherItems: string[][];
  devicesTitle: string; devicesBody: string; deviceLabels: string[];
  deliveryLabel: string; deliveryTitle: string[]; deliveryBody: string; deliveryItems: string[]; deliveryAction: string;
  questionsTitle: string; questions: string[][]; endTitle: string; footer: string; backTop: string;
  alts: Record<'workspace' | 'local' | 'portrait' | 'layers' | 'tablet' | 'phone', string>;
};

const copy: Record<Locale, OverviewCopy> = {
  "zh-CN": {
    "skip": "跳至内容",
    "home": "首页",
    "nav": [
      "精修",
      "AI 助手",
      "协作与交付"
    ],
    "login": "登录",
    "start": "打开工作台",
    "resume": "继续编辑",
    "heroLabel": "照片编辑 · AI 创作 · 团队协作",
    "heroTitle": [
      "把心中的画面，",
      "做成眼前的作品。"
    ],
    "heroBody": "从第一处光影调整，到最后一份交付，在同一个工作台完成。",
    "scroll": "向下探索",
    "screen": "真实工作台界面",
    "craftLabel": "01 / 精修",
    "craftTitle": [
      "光与色，",
      "掌握在你手里。"
    ],
    "craftBody": "先看画面，再精确到每一个参数。全局调色与局部调整，在同一张照片上自然衔接。",
    "craftItems": [
      [
        "光影与色彩",
        "曝光、白平衡、曲线与 HSL。"
      ],
      [
        "局部调整",
        "画出选区，只改变需要改变的地方。"
      ],
      [
        "随时比较",
        "查看原图与当前效果，保留每一步修改。"
      ]
    ],
    "portraitLabel": "02 / 人像",
    "portraitTitle": [
      "保留神态，",
      "照顾细节。"
    ],
    "portraitBody": "从肤质、面部到身形，选中需要处理的部位，再专注调节。",
    "portraitItems": [
      "美肤与五官",
      "身形与姿态",
      "力度随时可调"
    ],
    "layersLabel": "03 / 绘制与合成",
    "layersTitle": [
      "一张画面，",
      "不止一种表达。"
    ],
    "layersBody": "把照片、文字、图形与手绘放在同一个画布中。每个图层都能独立调整。",
    "layersItems": [
      "画笔与形状",
      "文字与图片图层",
      "位置、透明度与混合"
    ],
    "assistantLabel": "04 / AI 助手",
    "assistantTitle": [
      "把想法说出来，",
      "把决定留给自己。"
    ],
    "assistantBody": "文字或语音提出要求，结合当前照片与参考素材，查看结果后再决定采用。",
    "assistantSteps": [
      [
        "描述想法",
        "选择当前照片、参考图或选区。"
      ],
      [
        "查看候选",
        "在画面中预览，继续补充要求。"
      ],
      [
        "确认应用",
        "满意后采用；也可以取消预览。"
      ]
    ],
    "assistantNote": "可用模型与服务额度以账号内显示为准。",
    "togetherLabel": "05 / 项目与协作",
    "togetherTitle": [
      "从一个人的创作，",
      "到一群人的配合。"
    ],
    "togetherBody": "作品、素材、版本、讨论与任务归在项目里。成员按权限协作，编辑有迹可循。",
    "togetherItems": [
      [
        "作品与素材",
        "整理图片，复用素材，随时打开继续编辑。"
      ],
      [
        "讨论与任务",
        "围绕同一份作品沟通，把待办留在项目中。"
      ],
      [
        "版本与权限",
        "查看修改记录，为成员分配相应权限。"
      ]
    ],
    "devicesTitle": "换个屏幕，继续创作。",
    "devicesBody": "桌面放开画布，手机把当前操作放在手边。",
    "deviceLabels": [
      "平板工作台",
      "手机工作台"
    ],
    "deliveryLabel": "06 / 交付",
    "deliveryTitle": [
      "完成最后一笔，",
      "就可以交付。"
    ],
    "deliveryBody": "对照效果，选择格式与尺寸，导出当前作品。调色配方也能保存，供下一次编辑使用。",
    "deliveryItems": [
      "PNG · JPEG · WebP",
      "原图与效果对照",
      "调色配方"
    ],
    "deliveryAction": "开始编辑",
    "questionsTitle": "开始之前，你可能想知道",
    "questions": [
      [
        "需要先注册吗？",
        "可以直接打开工作台，在本地编辑照片。保存云端项目、团队协作与在线 AI 服务需要登录。"
      ],
      [
        "照片会自动上传吗？",
        "本地打开与编辑不会自动上传。使用云端项目或在线服务时，再按实际操作上传所需内容。"
      ],
      [
        "能撤销修改吗？",
        "编辑过程中可以撤销、重做与比较原图；云端作品还可查看已保存的版本。"
      ],
      [
        "AI 会直接覆盖作品吗？",
        "调节候选先预览，再由你确认采用。在线生成任务、模型与额度在工作台内查看。"
      ]
    ],
    "endTitle": "下一张作品，从这里开始。",
    "footer": "照片编辑与创作工作台",
    "backTop": "返回顶部",
    "alts": {
      "workspace": "映间精修工作台：当前照片、工具与调节参数",
      "local": "映间局部编辑工作台：选区与调色控制",
      "portrait": "映间人像编辑工作台：实际照片与人像参数",
      "layers": "映间图层工作台：绘制、图层与画布",
      "tablet": "映间平板工作台实际界面",
      "phone": "映间手机工作台实际界面"
    }
  },
  "zh-TW": {
    "skip": "跳至內容",
    "home": "首頁",
    "nav": [
      "精修",
      "AI 助手",
      "協作與交付"
    ],
    "login": "登入",
    "start": "開啟工作台",
    "resume": "繼續編輯",
    "heroLabel": "照片編輯 · AI 創作 · 團隊協作",
    "heroTitle": [
      "把心中的畫面，",
      "做成眼前的作品。"
    ],
    "heroBody": "從第一處光影調整，到最後一份交付，在同一個工作台完成。",
    "scroll": "向下探索",
    "screen": "真實工作台介面",
    "craftLabel": "01 / 精修",
    "craftTitle": [
      "光與色，",
      "掌握在你手裡。"
    ],
    "craftBody": "先看畫面，再精確到每一個參數。全域調色與局部調整，在同一張照片上自然銜接。",
    "craftItems": [
      [
        "光影與色彩",
        "曝光、白平衡、曲線與 HSL。"
      ],
      [
        "局部調整",
        "畫出選區，只改變需要改變的地方。"
      ],
      [
        "隨時比較",
        "查看原圖與目前效果，保留每一步修改。"
      ]
    ],
    "portraitLabel": "02 / 人像",
    "portraitTitle": [
      "保留神態，",
      "照顧細節。"
    ],
    "portraitBody": "從膚質、面部到身形，選取需要處理的部位，再專注調整。",
    "portraitItems": [
      "美膚與五官",
      "身形與姿態",
      "力度隨時可調"
    ],
    "layersLabel": "03 / 繪製與合成",
    "layersTitle": [
      "一張畫面，",
      "不只一種表達。"
    ],
    "layersBody": "把照片、文字、圖形與手繪放在同一個畫布中。每個圖層都能獨立調整。",
    "layersItems": [
      "畫筆與形狀",
      "文字與圖片圖層",
      "位置、透明度與混合"
    ],
    "assistantLabel": "04 / AI 助手",
    "assistantTitle": [
      "把想法說出來，",
      "把決定留給自己。"
    ],
    "assistantBody": "文字或語音提出要求，結合目前照片與參考素材，查看結果後再決定採用。",
    "assistantSteps": [
      [
        "描述想法",
        "選擇目前照片、參考圖或選區。"
      ],
      [
        "查看候選",
        "在畫面中預覽，繼續補充要求。"
      ],
      [
        "確認套用",
        "滿意後採用；也可以取消預覽。"
      ]
    ],
    "assistantNote": "可用模型與服務額度以帳號內顯示為準。",
    "togetherLabel": "05 / 專案與協作",
    "togetherTitle": [
      "從一個人的創作，",
      "到一群人的配合。"
    ],
    "togetherBody": "作品、素材、版本、討論與任務歸在專案裡。成員依權限協作，編輯有跡可循。",
    "togetherItems": [
      [
        "作品與素材",
        "整理圖片，重用素材，隨時開啟繼續編輯。"
      ],
      [
        "討論與任務",
        "圍繞同一份作品溝通，把待辦留在專案中。"
      ],
      [
        "版本與權限",
        "查看修改記錄，為成員分配相應權限。"
      ]
    ],
    "devicesTitle": "換個螢幕，繼續創作。",
    "devicesBody": "桌面展開畫布，手機把目前操作放在手邊。",
    "deviceLabels": [
      "平板工作台",
      "手機工作台"
    ],
    "deliveryLabel": "06 / 交付",
    "deliveryTitle": [
      "完成最後一筆，",
      "就可以交付。"
    ],
    "deliveryBody": "對照效果，選擇格式與尺寸，匯出目前作品。調色配方也能儲存，供下次編輯使用。",
    "deliveryItems": [
      "PNG · JPEG · WebP",
      "原圖與效果對照",
      "調色配方"
    ],
    "deliveryAction": "開始編輯",
    "questionsTitle": "開始之前，你可能想知道",
    "questions": [
      [
        "需要先註冊嗎？",
        "可以直接開啟工作台，在本機編輯照片。儲存雲端專案、團隊協作與線上 AI 服務需要登入。"
      ],
      [
        "照片會自動上傳嗎？",
        "在本機開啟與編輯不會自動上傳。使用雲端專案或線上服務時，再依實際操作上傳所需內容。"
      ],
      [
        "能復原修改嗎？",
        "編輯過程中可以復原、重做與比較原圖；雲端作品還可查看已儲存的版本。"
      ],
      [
        "AI 會直接覆寫作品嗎？",
        "調整候選先預覽，再由你確認採用。線上生成任務、模型與額度在工作台內查看。"
      ]
    ],
    "endTitle": "下一張作品，從這裡開始。",
    "footer": "照片編輯與創作工作台",
    "backTop": "返回頂部",
    "alts": {
      "workspace": "映間精修工作台：目前照片、工具與調整參數",
      "local": "映間局部編輯工作台：選區與調色控制",
      "portrait": "映間人像編輯工作台：實際照片與人像參數",
      "layers": "映間圖層工作台：繪製、圖層與畫布",
      "tablet": "映間平板工作台實際介面",
      "phone": "映間手機工作台實際介面"
    }
  },
  "en": {
    "skip": "Skip to content",
    "home": "Home",
    "nav": [
      "Editing",
      "AI assistant",
      "Work together"
    ],
    "login": "Sign in",
    "start": "Open the studio",
    "resume": "Continue editing",
    "heroLabel": "PHOTO EDITING · AI CREATION · COLLABORATION",
    "heroTitle": [
      "Your vision.",
      "Made visible."
    ],
    "heroBody": "From the first light adjustment to the final delivery, one place to make the image your own.",
    "scroll": "Explore the studio",
    "screen": "Actual studio interface",
    "craftLabel": "01 / EDITING",
    "craftTitle": [
      "Light and colour.",
      "In your hands."
    ],
    "craftBody": "Start with the image. Refine every detail. Move from global colour to local adjustments on the same canvas.",
    "craftItems": [
      [
        "Light and colour",
        "Exposure, white balance, curves and HSL."
      ],
      [
        "Local adjustments",
        "Select the area you want to change."
      ],
      [
        "Compare as you go",
        "Review the original and your current edit."
      ]
    ],
    "portraitLabel": "02 / PORTRAITS",
    "portraitTitle": [
      "Keep the character.",
      "Refine the details."
    ],
    "portraitBody": "Choose a skin, facial or body adjustment, then focus on the right amount.",
    "portraitItems": [
      "Skin and facial details",
      "Body and pose",
      "Adjustable intensity"
    ],
    "layersLabel": "03 / DRAWING & COMPOSITION",
    "layersTitle": [
      "One canvas.",
      "More possibilities."
    ],
    "layersBody": "Bring photographs, text, shapes and brushwork together. Adjust each layer independently.",
    "layersItems": [
      "Brushes and shapes",
      "Text and image layers",
      "Position, opacity and blending"
    ],
    "assistantLabel": "04 / AI ASSISTANT",
    "assistantTitle": [
      "Share your idea.",
      "Keep the final say."
    ],
    "assistantBody": "Use text or voice with your photograph and reference materials. Review the result before you apply it.",
    "assistantSteps": [
      [
        "Describe",
        "Choose a photograph, reference or selection."
      ],
      [
        "Preview",
        "See the candidate on the canvas and refine your request."
      ],
      [
        "Apply",
        "Keep the result you like, or cancel the preview."
      ]
    ],
    "assistantNote": "Available models and service allowance are shown in your account.",
    "togetherLabel": "05 / PROJECTS & COLLABORATION",
    "togetherTitle": [
      "Your creative space.",
      "Your team's, too."
    ],
    "togetherBody": "Keep work, assets, versions, conversations and tasks together. Give each collaborator the access they need.",
    "togetherItems": [
      [
        "Work and assets",
        "Organise images, reuse assets and return to an edit."
      ],
      [
        "Conversations and tasks",
        "Discuss the same work and keep the next steps with it."
      ],
      [
        "Versions and access",
        "Review saved changes and manage member permissions."
      ]
    ],
    "devicesTitle": "Another screen. The same focus.",
    "devicesBody": "Room for the canvas on desktop. The current action close at hand on mobile.",
    "deviceLabels": [
      "Tablet studio",
      "Mobile studio"
    ],
    "deliveryLabel": "06 / DELIVERY",
    "deliveryTitle": [
      "The last detail.",
      "Ready to share."
    ],
    "deliveryBody": "Compare the result, choose a format and size, and export your work. Save the colour recipe for the next edit.",
    "deliveryItems": [
      "PNG · JPEG · WebP",
      "Before and after",
      "Colour recipes"
    ],
    "deliveryAction": "Start editing",
    "questionsTitle": "Before you begin",
    "questions": [
      [
        "Do I need an account?",
        "Open the studio and edit locally without signing in. Cloud projects, collaboration and online AI services require an account."
      ],
      [
        "Are my photographs uploaded automatically?",
        "Opening and editing locally does not upload your photographs. Cloud projects and online services upload the content needed for the action you choose."
      ],
      [
        "Can I undo changes?",
        "Undo, redo and compare with the original while editing. Cloud work also retains saved versions for review."
      ],
      [
        "Does AI overwrite my work?",
        "Preview adjustment candidates before applying them. Online generation tasks, models and allowance are shown in the studio."
      ]
    ],
    "endTitle": "Your next image starts here.",
    "footer": "The photo editing and creative studio",
    "backTop": "Back to top",
    "alts": {
      "workspace": "The actual editing studio with a photograph, tools and adjustment controls",
      "local": "The actual local editing studio with a selection and colour controls",
      "portrait": "The actual portrait studio with a photograph and portrait adjustments",
      "layers": "The actual layer workspace with drawing tools and canvas",
      "tablet": "The actual studio on a tablet-sized screen",
      "phone": "The actual studio on a mobile-sized screen"
    }
  }
};

export function overviewCopy(locale: Locale): OverviewCopy { return copy[locale]; }
