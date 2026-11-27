import { useState } from 'react';
import { ImageSquare } from '@phosphor-icons/react';
import { t, useLocale } from '../i18n';
import { MotionDetails } from '../motion/Presence';

const recipes = {
  inspiration: {
    title: '灵感出片',
    prompt:
      '请检查当前图与我提供的参考图，说明可复用的色彩、光线和构图。优先提供可撤销的编辑候选。如需生成，草拟一个独立候选并说明会改变的内容。',
  },
  portrait: {
    title: '人像补光',
    prompt:
      '请在已共享的画面上测量明暗，先给出保留高光的自然补光候选。有人像选区时将局部补光限制在该范围，保持身份、肤色和背景。',
  },
  color: {
    title: '校正色偏',
    prompt:
      '请使用画面的中性色测量校正综合色温和色调。没有可信中性色时保留原色并说明限制，避免把有意的光线变成中性。',
  },
  sky: {
    title: '换天候选',
    prompt:
      '先核对图中是否有可见天空。根据我提供的选区或参考，准备独立的换天候选，保留建筑物、树枝与人物边缘，并匹配地面的光线。',
  },
  reflection: {
    title: '去反光候选',
    prompt:
      '请先区分玻璃倒影、真实光源和高光截断。只针对明确的倒影区域准备修复候选，保持原有纹理；指出哪些细节无法由单张照片可靠恢复。',
  },
  motion: {
    title: '去拖影与细节',
    prompt:
      '请先检查是运动拖影、失焦还是噪声。若有足够的方向、长度和局部选区信息，给出保守的恢复建议；核对边缘振铃，避免凭空补画文字或大幅锐化。',
  },
  expression: {
    title: '表情替换候选',
    prompt:
      '只使用我明确选中的同一人的备选照片作为表情参考。先确认目标位置与参考帧，保留其他人物、光线和构图。资料不足时请提示需补充的参考，再准备可对比的候选。',
  },
  background: {
    title: '背景修复候选',
    prompt:
      '请依据我选中的背景范围准备修复，检查结构延续、边缘接缝与遮挡。前景主体与真实文字保持原样，提供可对比的候选。',
  },
  clarity: {
    title: '照片清晰度',
    prompt:
      '请检查当前照片的有效细节、噪声和过度锐化问题，先给出保持尺寸和真实纹理的处理建议。若请求超分生成，说明不可恢复的细节以及生成可能带来的变化。',
  },
  retouch: {
    title: '自然美颜',
    prompt:
      '请先检查可见的人像与选区。仅给出局部、低强度的肤色或纹理建议，保留肤色差异、脸型、肤质和自然细节。',
  },
} as const;

export function PhotoWorkflows({
  disabled,
  references,
  shared,
  onChoose,
}: {
  disabled: boolean;
  references: number;
  shared: boolean;
  onChoose: (prompt: string) => void;
}) {
  useLocale();
  const [selected, setSelected] = useState<keyof typeof recipes | ''>('');
  const entry = selected ? recipes[selected] : null;
  return (
    <MotionDetails className="ai-photo-workflows">
      <summary>
        <ImageSquare size={15} aria-hidden />
        {t('照片任务')}
      </summary>
      <div>
        <select
          aria-label={t('选择照片任务')}
          value={selected}
          onChange={(event) => setSelected(event.target.value as keyof typeof recipes | '')}
        >
          <option value="">{t('选择照片任务')}</option>
          {(Object.keys(recipes) as (keyof typeof recipes)[]).map((key) => (
            <option key={key} value={key}>
              {t(recipes[key].title)}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="text-button"
          disabled={disabled || !entry}
          onClick={() => {
            if (entry) onChoose(t(entry.prompt));
          }}
        >
          {t('加入指令')}
        </button>
      </div>
      {entry && (
        <p>
          {t(
            selected === 'expression' && references < 1
              ? '表情候选需要另选至少一张参考照片。'
              : shared
                ? '发送前可继续补充区域、强度和参考。'
                : '发送前可在共享范围内附带画面或参考图。',
          )}
        </p>
      )}
    </MotionDetails>
  );
}
