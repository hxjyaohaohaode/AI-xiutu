/** Complete messages used where a sentence must reorder for another language. */
export const finalEnglish: Readonly<Record<string, string>> = {
  '{name}暂时无法打开': '{name} is temporarily unavailable',
  '{name}选项': '{name} options',
  '选择{name}': 'Choose {name}',
  '{name}说明': 'About {name}',
  '{corner}{axis}': '{corner} {axis}',
  左上角: 'Top left',
  右上角: 'Top right',
  右下角: 'Bottom right',
  左下角: 'Bottom left',
  次: ' times',
  '来源 {axis}': 'Source {axis}',
  '新建{name}选区': 'Create {name} selection',
  '确定移除 {name}？后续将无法访问团队资料。':
    'Remove {name}? They will no longer have access to team resources.',
  '将团队所有权交给 {name}？你将变为管理员；团队作品和素材继续保留。':
    'Transfer team ownership to {name}? You will become an administrator. Team work and assets will remain.',
  'GIF 文件不能超过 {size} MiB。': 'The GIF file cannot exceed {size} MiB.',
  '{name} 已保存到项目素材。': '{name} has been saved to project assets.',
  '上次导入的恢复记录已保留。{reason}': 'The previous import recovery record is retained. {reason}',
  '文档已保存，但列表暂未刷新。{reason}':
    'The document was saved, but the list could not refresh. {reason}',
  '{action} {units} 服务点，已写入权益账本。':
    '{action} {units} service credits. The adjustment is recorded in the entitlement ledger.',
  '参考图尚未完整准备，草案没有切换。{copies}重试会核验并复用已完成的副本，不会丢弃参考图。{reason}':
    'Reference images are not fully ready, so the draft has not switched. {copies}Retrying will verify and reuse completed copies without discarding references. {reason}',
  '本次已确认的 {count} 张副本保留在目标项目。':
    'The {count} confirmed copies from this attempt remain in the target project. ',
  '请输入 {min} 至 {max} 的整数。': 'Enter an integer between {min} and {max}.',
  '请输入 {min} 至 {max} 的数值。': 'Enter a number between {min} and {max}.',
  '原图 {width}×{height}，超过当前 {pixels} 百万像素 / 单边 {dimension}px 预算。可在导入设置中明确调整设备预算；不会自动缩小原图。':
    'The original is {width}×{height}, exceeding the current {pixels} megapixel / {dimension}px-per-side budget. You can change the device budget in import settings. The original will not be automatically reduced.',
  '当前浏览器无法解码这张 {format} 图片。可明确选择上传并规范化为PNG；没有自动上传。':
    'This browser cannot decode this {format} image. You can choose to upload and normalize it to PNG. Nothing is uploaded automatically.',
  '当前浏览器未提供{format}编码，请选择其他格式。':
    'This browser does not provide {format} encoding. Choose another format.',
  '局部选区已达到 {count} 个，请先整理后再添加。':
    'The limit of {count} local selections has been reached. Remove some before adding more.',
  '这个浏览器未提供 PNG 编码，请选择 PNG 或其他可用格式。':
    'This browser does not provide PNG encoding. Choose another supported format.',
  '这个浏览器未提供 JPEG 编码，请选择 PNG 或其他可用格式。':
    'This browser does not provide JPEG encoding. Choose PNG or another supported format.',
  '这个浏览器未提供 WEBP 编码，请选择 PNG 或其他可用格式。':
    'This browser does not provide WEBP encoding. Choose PNG or another supported format.',
  '人物素材需要透明 PNG 格式。': 'Portrait cutouts require a transparent PNG.',
};
