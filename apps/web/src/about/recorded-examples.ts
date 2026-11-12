/** Public sample captures from the isolated OpenAI smoke run. No requests are made by About. */
export const recordedExamples = {
  "dialogue": {
    "model": "gpt-5.4-nano",
    "prompt": "看这张泳池照片。保留水面的蓝和墙面的暖色，用一句中文给一个曝光与高光建议，不要自动修改。",
    "answer": "建议把**曝光轻微往下（-0.3到-0.6 EV）**，同时把**高光压一点（高光 -10%到-20%）**：这样能保住水面的蓝色通透感与墙面暖色的层次，同时减少顶光处容易溢出的反光。",
    "displayModel": "GPT-5.4 nano",
    "maxOutputTokens": 256,
    "reasoning": "none",
    "mode": "suggestion",
    "input": "288 px public sample",
    "language": "zh-CN"
  },
  "image": {
    "model": "gpt-image-2",
    "modelLabel": "GPT Image 2",
    "prompt": "给一场海岸摄影展生成一张方形封面：蓝调时刻的灯塔，海面深青，远处一点琥珀光。上方保留留白，不加文字。",
    "width": 1024,
    "height": 1024,
    "quality": "low",
    "format": "PNG",
    "outputs": 1
  }
} as const;
