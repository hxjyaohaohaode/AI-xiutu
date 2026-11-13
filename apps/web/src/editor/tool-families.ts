import type { ToolGroup } from './ToolInspector';

export const adjustmentTools: readonly ToolGroup[] = ['light', 'color', 'curves', 'detail'];
export const retouchTools: readonly ToolGroup[] = ['repair', 'paint', 'liquify'];

export function rootTool(tool: ToolGroup): ToolGroup {
  if (adjustmentTools.includes(tool)) return 'light';
  if (retouchTools.includes(tool)) return 'repair';
  return tool;
}

export const toolFamilyLabels = { light: '调节', repair: '修饰' } as const;
