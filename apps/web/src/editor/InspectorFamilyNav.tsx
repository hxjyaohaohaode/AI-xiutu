import { RubberSegment } from '../components/control-motion';
import { t } from '../i18n';
import { toolGroups, type ToolGroup } from './ToolInspector';
import { adjustmentTools, retouchTools } from './tool-families';

export function InspectorFamilyNav({
  group,
  onChange,
}: {
  group: ToolGroup;
  onChange?: (group: ToolGroup) => void;
}) {
  if (!onChange) return null;
  const adjusting = adjustmentTools.includes(group);
  const tools = adjusting ? adjustmentTools : retouchTools;
  if (!tools.includes(group)) return null;
  return (
    <RubberSegment
      className="inspector-family-tabs"
      label={t(adjusting ? '调节类别' : '修饰工具')}
      value={group}
      options={tools.map((id) => {
        const { label, icon } = toolGroups.find((tool) => tool.id === id)!;
        return { value: id, label: t(label), icon };
      })}
      onChange={onChange}
    />
  );
}
