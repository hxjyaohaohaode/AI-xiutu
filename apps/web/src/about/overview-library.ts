import type { Locale } from '../i18n';

const wallPhotos = [
  ["porcelain","窗边白瓷","窗邊白瓷","White porcelain"],
  ["wet-alley","雨后巷道","雨後巷道","Rain in the alley"],
  ["linen","亚麻纹理","亞麻紋理","Linen texture"],
  ["record-shop","唱片店橱窗","唱片行櫥窗","Record shop window"],
  ["travertine","洞石台阶","洞石階梯","Travertine steps"],
  ["night-ferry","黎明渡船","黎明渡船","Dawn ferry"],
  ["citrus","血橙静物","血橙靜物","Blood orange still life"],
  ["window-portrait","工业窗边人像","工業窗邊人像","Window portrait"],
  ["contact-sheet","底片灯台","底片燈台","Film light table"],
  ["glass-refraction","玻璃折光","玻璃折光","Glass refraction"],
  ["winter-track","雪地脚印","雪地腳印","Tracks in snow"],
  ["tailor","裁缝的工作台","裁縫的工作台","Tailor’s worktable"],
  ["conservatory","温室角落","溫室角落","Conservatory corner"],
  ["studio-headshot","侧光人像","側光人像","Side-lit portrait"],
  ["frosted-window","雾面玻璃","霧面玻璃","Frosted glass"],
  ["salt-flat","盐滩晨光","鹽灘晨光","Dawn salt flat"],
  ["workshop","金工抽屉","金工抽屜","Workshop drawers"],
  ["coral-facade","珊瑚色窗墙","珊瑚色窗牆","Coral facade"],
  ["paper-study","叠纸色彩","疊紙色彩","Layered paper"],
  ["black-sand","黑沙与海沫","黑沙與海沫","Black sand and foam"],
  ["yellow-seat","窗侧扶手椅","窗側扶手椅","Armchair by the window"],
  ["orchid","暗底白兰","暗底白蘭","White orchids"],
  ["blue-dusk","蓝调站台","藍調月台","Blue-hour platform"],
  ["dried-herbs","干燥迷迭香","乾燥迷迭香","Dried rosemary"],
  ["cyclist-studio","骑行者肖像","騎行者肖像","Cyclist portrait"],
  ["rain-macro","车门雨滴","車門雨滴","Rain on the car door"],
  ["indigo-bowl","靛蓝陶碗","靛藍陶碗","Indigo ceramic bowl"],
  ["museum-night","夜间展厅","夜間展廳","Museum at night"],
  ["copper-kettle","铜壶与滤网","銅壺與濾網","Copper kettle"],
  ["orange-market","闭市后的长廊","閉市後的長廊","Market after closing"],
] as const;
const folderPhotos = [
  ["headland-grass","海岸草坡","海岸草坡","Coastal grass"],
  ["lemon-crate","蓝木箱与柠檬","藍木箱與檸檬","Lemons in a blue crate"],
  ["book-press","装帧工作台","裝幀工作台","Bookbinder’s press"],
] as const;

const photoRoot = '/about/review/library/';
const languageIndex = { 'zh-CN': 1, 'zh-TW': 2, en: 3 } as const;

export function overviewLibrary(locale: Locale) {
  const localize = (item: typeof wallPhotos[number] | typeof folderPhotos[number]) => ({
    image: photoRoot + item[0] + '.webp',
    title: item[languageIndex[locale]],
  });
  return { wall: wallPhotos.map(localize), folder: folderPhotos.map(localize) };
}

export const overviewDeliveryPhotos = [
  ['print-studio', 'cotton-portrait', 'pool-after-rain', 'silver-leaf', 'blue-window'],
  ['tiled-courtyard', 'hill-house', 'sage-pottery', 'pale-cliff', 'dusk-taxi'],
].map((lane) => lane.map((name) => photoRoot + name + '.webp'));
