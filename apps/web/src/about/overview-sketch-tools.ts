import type { Locale } from '../i18n';

const tools = [
  ["pencil","铅笔","沿着轮廓绘制一条连续笔迹。","鉛筆","沿著輪廓畫出連續筆觸。","Pencil","Draw a continuous stroke along the outline."],
  ["eraser","橡皮擦","擦去局部笔迹，保留附近的元素。","橡皮擦","擦去局部筆觸，保留附近的元素。","Eraser","Remove part of a stroke while keeping nearby elements."],
  ["select","元素选择","在画布上选中要移动或变换的元素。","元素選取","在畫布上選取要移動或變形的元素。","Element selection","Select an element to move or transform on the canvas."],
  ["undo","撤销操作","把最近一次改动退回到上一状态。","復原操作","將最近一次變更回復到上一個狀態。","Undo","Return to the previous sketch state."],
  ["rectangle","矩形","在画布上拖出直角矩形。","矩形","在畫布上拖出直角矩形。","Rectangle","Drag out a rectangle on the canvas."],
  ["rounded","圆角矩形","用带圆角的边框组织画面。","圓角矩形","用帶圓角的邊框整理畫面。","Rounded rectangle","Frame part of the composition with rounded corners."],
  ["ellipse","椭圆","拖动设置椭圆的大小与位置。","橢圓","拖曳設定橢圓的大小和位置。","Ellipse","Drag to set an ellipse’s size and position."],
  ["triangle","三角形","添加一个独立的三角形元素。","三角形","新增獨立的三角形元素。","Triangle","Add a triangle as a separate element."],
  ["line","直线","标出方向、基准或对齐线。","直線","標出方向、基準或對齊線。","Line","Mark a direction, baseline or alignment."],
  ["text","文字工具","在画布上添加可编辑的文字。","文字工具","在畫布上新增可編輯的文字。","Text tool","Place editable text on the canvas."],
  ["symbols","图标工具","从草图图标中选择符号。","圖示工具","從草圖圖示中選擇符號。","Symbol tool","Pick a symbol from the sketch toolbar."],
  ["import","导入本地图像","将本地图片加入草图，继续摆放和缩放。","匯入本機圖片","將本機圖片加入草圖，繼續擺放和縮放。","Import an image","Bring a local image into the sketch to place and resize."],
  ["current","添加当前画布","把工作台当前画面加入草图。","加入目前畫布","將工作台目前的畫面加入草圖。","Add the current canvas","Add the current workspace image to the sketch."],
  ["transparent","透明背景","在实底与透明画布之间切换。","透明背景","在實底和透明畫布之間切換。","Transparent background","Switch between a solid and transparent canvas."],
] as const;

const languageIndex = { 'zh-CN': 1, 'zh-TW': 3, en: 5 } as const;

export function overviewSketchTools(locale: Locale) {
  return tools.map((tool) => ({
    id: tool[0],
    title: tool[languageIndex[locale]],
    body: tool[languageIndex[locale] + 1]!,
  }));
}
