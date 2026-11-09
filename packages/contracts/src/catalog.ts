import { ModuleRegistry, type Capability, type ModuleManifest } from './registry.js';

type CapabilityOptions = Partial<Omit<Capability, 'id' | 'label'>>;
const cap = (id: string, label: string, options: CapabilityOptions = {}): Capability => ({
  id,
  label,
  implementation: 'implemented',
  execution: 'browser',
  permission: 'local',
  inputs: ['recipe'],
  outputs: ['recipe'],
  requires: [],
  confirmation: 'preview',
  persistence: 'revision',
  limitations: [],
  ...options,
});
const module = (
  id: string,
  label: string,
  dependsOn: string[],
  capabilities: Capability[],
): ModuleManifest => ({
  protocolVersion: 1,
  id,
  label,
  version: '1.0.0',
  dependsOn,
  capabilities,
});
const cloud = {
  execution: 'api',
  permission: 'edit',
  persistence: 'transaction',
  confirmation: 'explicit',
} as const;
const future = { implementation: 'contract-only' } as const;
const portrait: CapabilityOptions = {
  implementation: 'adapter-required',
  requires: ['portrait.analysis'],
  inputs: ['asset'],
  outputs: ['analysis'],
  persistence: 'device',
};

/** This catalog is consumed by GET /v1/modules and can also be used offline.
 * Individual algorithm ports, provider configuration, and user authorization
 * are intentionally separate from the presence of a UI entry. */
export function createBuiltinRegistry(): ModuleRegistry {
  const entries: ModuleManifest[] = [
    module(
      'identity',
      '账户与权限',
      [],
      [
        cap('identity.session', '密码、短信验证与会话', {
          ...cloud,
          permission: 'read',
          inputs: [],
          outputs: [],
          requires: [],
        }),
        cap('identity.sms', '手机号验证', { ...cloud, inputs: [], outputs: [], requires: ['sms'] }),
      ],
    ),
    module(
      'workspace',
      '个人与团队空间',
      ['identity'],
      [
        cap('workspace.membership', '空间成员与角色', {
          ...cloud,
          permission: 'admin',
          inputs: [],
          outputs: [],
        }),
        cap('workspace.project', '项目与作品组织', { ...cloud, inputs: [], outputs: ['artwork'] }),
        cap('workspace.reference', '可撤销的参考授权', {
          ...cloud,
          permission: 'admin',
          inputs: ['asset'],
          outputs: ['asset'],
        }),
        cap('workspace.copy', '跨空间独立副本', {
          ...cloud,
          inputs: ['asset', 'artwork', 'document'],
          outputs: ['asset', 'artwork', 'document'],
          limitations: ['需源项目复制许可和目标空间编辑权；完成副本不随源撤销消失'],
        }),
      ],
    ),
    module(
      'asset',
      '素材与元数据',
      ['workspace'],
      [
        cap('asset.import', '格式校验与规范化导入', {
          ...cloud,
          inputs: [],
          outputs: ['asset'],
          limitations: ['服务端以实际安装的解码器为准；RAW、PSD、HEIC 等未实现'],
        }),
        cap('asset.catalog', '项目、时间、标签与搜索', {
          execution: 'api',
          permission: 'read',
          inputs: ['asset'],
          outputs: ['asset'],
          persistence: 'transaction',
          confirmation: 'none',
        }),
        cap('asset.annotation', '标题、标签、拍摄时间与声明位置', {
          ...cloud,
          inputs: ['asset'],
          outputs: ['asset'],
        }),
        cap('asset.copy', '经过授权的单素材跨项目复制', {
          ...cloud,
          inputs: ['asset'],
          outputs: ['asset'],
          limitations: [
            '来源可读及复制许可、目标编辑权、持久幂等；同源到同项目复用已完成副本，不重复占容量',
          ],
        }),
      ],
    ),
    module(
      'editor',
      '非破坏图像编辑',
      ['asset'],
      [
        cap('editor.recipe', '版本化配方与同源预览导出', {
          limitations: ['v1/v2/v3显式解码；当前工作输出为RGBA8 SDR'],
        }),
        cap('editor.color', '色阶、HSL、分级、曲线与细节', {}),
        cap('editor.geometry', '裁切与精细几何', {
          limitations: ['原图坐标、有限角度与画幅预算；不推断裁切外内容'],
        }),
        cap('editor.regions', '多局部、组合蒙版与成组调整', {}),
        cap('editor.paint', '绘制、透明度与混合', {}),
        cap('editor.warp', '局部推移与保护区域', {
          limitations: ['局部位移场；不保证自动辨认面部或背景'],
        }),
        cap('editor.high-bit-depth', 'HDR、ICC与高位深处理', {
          ...future,
          limitations: ['需要像素缓冲、色彩管理、预览和导出同时升级'],
        }),
      ],
    ),
    module(
      'portrait',
      '人像与美颜',
      ['editor'],
      [
        cap('portrait.analysis', '多人物关键点分析', {
          ...portrait,
          inputs: ['asset'],
          outputs: ['analysis'],
          limitations: ['需要实际模型资产；关键点不等价于皮肤或妆容分割'],
        }),
        cap('portrait.retouch', '按人物区域的手工精修', {
          limitations: ['手工指定区域与通用算法，不冒充专用祛痘或祛皱网络'],
        }),
        cap('portrait.feature-warp', '五官锚点与双向形变', {
          ...portrait,
          inputs: ['asset', 'analysis', 'recipe'],
          outputs: ['recipe'],
          persistence: 'revision',
          limitations: ['分析结果绑定源图；需确认或修正人物锚点'],
        }),
        cap('portrait.skin-segmentation', '皮肤、头发与背景分割', {
          ...future,
          inputs: ['asset'],
          outputs: ['mask', 'analysis'],
        }),
        cap('portrait.blemish-healing', '祛斑祛痘、祛皱与纹理修复', {
          ...future,
          inputs: ['asset', 'mask'],
          outputs: ['asset'],
          limitations: ['需专用修复算法，不能用全局模糊替代'],
        }),
        cap('portrait.body-analysis', '身形、姿态与遮挡分析', {
          ...future,
          inputs: ['asset'],
          outputs: ['analysis'],
        }),
        cap('portrait.makeup-analysis', '唇、眉、卧蚕与妆容解析', {
          ...future,
          inputs: ['asset'],
          outputs: ['analysis', 'mask'],
        }),
      ],
    ),
    module(
      'composition',
      '绘图与合成',
      ['editor'],
      [
        cap('composition.sketch', '草图绘制与AI参考', {
          inputs: [],
          outputs: ['asset'],
          persistence: 'device',
        }),
        cap('composition.blend', '可编辑笔触与混合模式', {}),
        cap('composition.asset-graph', '多素材引用、图层合成与来源快照', {
          inputs: ['asset', 'recipe'],
          outputs: ['recipe'],
          limitations: ['图层引用不可变素材；跨作品自动级联重算尚未实现'],
        }),
      ],
    ),
    module(
      'history',
      '版本与采纳',
      ['workspace', 'editor'],
      [
        cap('history.revision', '不可变版本与冲突保护', {
          ...cloud,
          inputs: ['artwork', 'recipe'],
          outputs: ['revision'],
        }),
        cap('history.restore', '连同源图恢复历史版本', {
          ...cloud,
          inputs: ['revision'],
          outputs: ['revision'],
        }),
        cap('history.result-decision', '拒绝、另存、合成图层、替换与建议采纳', {
          ...cloud,
          inputs: ['job'],
          outputs: ['artwork', 'revision', 'document'],
        }),
      ],
    ),
    module(
      'collaboration',
      '团队共同工作',
      ['workspace', 'history'],
      [
        cap('collaboration.comments', '作品版本锚点与讨论', {
          ...cloud,
          permission: 'comment',
          inputs: ['artwork', 'revision'],
          outputs: [],
        }),
        cap('collaboration.tasks', '项目任务与文档', {
          ...cloud,
          inputs: [],
          outputs: ['document'],
        }),
        cap('collaboration.events', '有序事件与同步提示', {
          execution: 'api',
          permission: 'read',
          inputs: [],
          outputs: [],
          persistence: 'transaction',
          confirmation: 'none',
        }),
        cap('collaboration.crdt', '多人并发参数与图层合并', {
          ...future,
          ...cloud,
          inputs: ['recipe'],
          outputs: ['recipe'],
        }),
      ],
    ),
    module(
      'ai',
      'AI共同创作',
      ['asset', 'history'],
      [
        cap('ai.image', '生图、编辑、多参考与局部蒙版', {
          execution: 'external',
          permission: 'edit',
          inputs: ['asset'],
          outputs: ['job', 'asset'],
          requires: ['generate-image'],
          confirmation: 'explicit',
          persistence: 'candidate',
          limitations: ['以当前模型参数档案与账户验收为准'],
        }),
        cap('ai.plan', '参数建议与可审阅差异', {
          execution: 'external',
          permission: 'edit',
          inputs: ['recipe'],
          outputs: ['job', 'recipe'],
          requires: ['edit-plan'],
          confirmation: 'explicit',
          persistence: 'candidate',
          limitations: ['仅全局白名单数值，不能自动改写人物、蒙版、形变或绘制'],
        }),
        cap('ai.text', '文本生成与文档迭代', {
          execution: 'external',
          permission: 'edit',
          inputs: ['document'],
          outputs: ['job', 'document'],
          requires: ['generate-text'],
          confirmation: 'explicit',
          persistence: 'candidate',
        }),
        cap('ai.voice', '短语音转写与编辑输入', {
          execution: 'external',
          permission: 'edit',
          inputs: [],
          outputs: ['job'],
          requires: ['transcribe'],
          confirmation: 'explicit',
          persistence: 'candidate',
          limitations: ['最长30秒；不是全双工实时语音'],
        }),
        cap('ai.cancel', '取消尚未派发的排队任务', {
          ...cloud,
          inputs: ['job'],
          outputs: ['job'],
          limitations: [
            '需当前项目编辑权及任务本人或空间owner/admin身份；仅安全queued释放预占，running/unknown须保留发送证据并核验',
          ],
        }),
      ],
    ),
    module(
      'operations',
      '运营、额度与审核',
      ['identity', 'workspace', 'ai'],
      [
        cap('operations.policy', '模型、套餐、注册与品牌配置', {
          ...cloud,
          permission: 'operator',
          inputs: [],
          outputs: [],
        }),
        cap('operations.quota', '额度来源、预占与审计', {
          ...cloud,
          permission: 'operator',
          inputs: ['job'],
          outputs: [],
        }),
        cap('operations.storage', '空间保留容量与版本化配置', {
          ...cloud,
          permission: 'operator',
          inputs: [],
          outputs: [],
          limitations: ['按保留素材记录计量；软删除不释放容量，不代表物理文件垃圾回收'],
        }),
        cap('operations.moderation', '生图前文本和结果审核', {
          execution: 'external',
          permission: 'edit',
          inputs: ['asset', 'job'],
          outputs: [],
          requires: ['moderation'],
          persistence: 'transaction',
          confirmation: 'none',
        }),
        cap('operations.payment', '商户自动支付与退款', {
          ...future,
          ...cloud,
          permission: 'operator',
          inputs: [],
          outputs: [],
          limitations: ['当前仅真实人工额度调整，没有支付回调或现金退款'],
        }),
      ],
    ),
  ];
  const registry = new ModuleRegistry();
  entries.forEach((entry) => registry.register(entry));
  return registry.seal();
}
