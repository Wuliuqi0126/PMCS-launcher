'use strict';

// 本地中文检索词典：不依赖第三方翻译接口，避免把查询内容发给外部服务。
// 词条按最长匹配优先，先把中文模组名/术语换成英文关键词，再交给
// Modrinth / CurseForge 搜索。标题与简介保持 API 返回的英文原名。
const TERMS = {
  // 常见模组中文名
  '连锁采集': 'vein mining',
  '连锁挖矿': 'vein miner',
  '矿脉挖掘': 'vein mining',
  '连锁破坏': 'vein mining',
  '一键采集': 'vein mining',
  '一键挖矿': 'vein miner',
  '连锁砍树': 'tree vein miner',
  '一键砍树': 'tree capitator',
  '连锁': 'vein',
  '矿脉': 'vein',
  '砍树': 'tree capitator',
  '自动采集': 'auto harvest',
  '自动挖矿': 'auto mining',
  '机械动力': 'create',
  '通用机械': 'mekanism',
  '植物魔法': 'botania',
  '神秘时代': 'thaumcraft',
  '匠魂': 'tinkers construct',
  '热力膨胀': 'thermal expansion',
  '工业时代': 'industrial craft',
  '沉浸工程': 'immersive engineering',
  '应用能源': 'applied energistics',
  '精致存储': 'refined storage',
  '集成动力': 'integrated dynamics',
  '农夫乐事': 'farmers delight',
  '苹果皮': 'apple skin',
  '旅行地图': 'travel map',
  '小地图': 'minimap',
  '创世神': 'worldedit',
  '等价交换': 'projecte',
  '无尽贪婪': 'avaritia',
  '深渊国度': 'abyssalcraft',
  '星辉魔法': 'astral sorcery',
  '血魔法': 'blood magic',
  '神秘农业': 'mystical agriculture',
  '潘马斯': 'pams harvestcraft',
  '星系': 'galacticraft',
  '铁路': 'railcraft',
  '飞船': 'airships',
  '载具': 'vehicles',
  '枪械': 'guns',
  '盾牌': 'shields',
  '附魔': 'enchantment',
  '经验': 'experience',
  '任务': 'quests',
  '成就': 'achievements',
  '优化': 'optimization',
  '性能': 'performance',
  '帧数': 'fps',
  '渲染': 'rendering',
  '阴影': 'shadows',
  '材质': 'resource packs',
  '资源包': 'resource packs',
  '数据包': 'data packs',
  '前置': 'library',
  '汉化': 'translation',
  '中文': 'chinese',
  '魔法': 'magic',
  '科技': 'technology',
  '冒险': 'adventure',
  '装饰': 'decoration',
  '存储': 'storage',
  '能源': 'energy',
  '管道': 'pipes',
  '传送': 'teleport',
  '村民': 'villager',
  '生物': 'mobs',
  '维度': 'dimensions',
  '界面': 'interface',
  '装备': 'equipment',
  '工具': 'tools',
  '整合包': 'modpack',
  '模组': 'mod',
  '生存': 'survival',
  '创造': 'creative',
  '工业': 'industrial',
  '农场': 'farm',
  '地图': 'map',
  '建筑': 'building',
  '地牢': 'dungeon',
  '怪物': 'mob',
  '龙': 'dragon',
  '核': 'nuclear',
  '电力': 'power',
  '太阳能': 'solar',
  '反应堆': 'reactor',
  '火箭': 'rocket',
  '太空': 'space',
  '海洋': 'ocean',
  '钓鱼': 'fishing',
  '烹饪': 'cooking',
  '饮料': 'drinks',
  '咖啡': 'coffee',
  '作物': 'crops',
  '树木': 'trees',
  '矿物': 'ore',
  '背包': 'inventory',
  '箱子': 'chest',
  '物品': 'items',
  '配方': 'recipe',
  '合成': 'crafting',
  '自动化': 'automation',
  '红石': 'redstone',
  '电路': 'circuits',
  '物流': 'logistics',
  '村庄': 'village',
  '皮肤': 'skin',
  '动画': 'animation',
  '物理': 'physics',
  '声音': 'sound',
  '音乐': 'music',
  '键位': 'keybind',
  '控制': 'controls',
  // 常见中文单字 / 别名
  '钠': 'sodium',
  '锂': 'lithium',
  '磷': 'phosphor',
  '铍': 'beryllium',
  '玉': 'jade',
  '光影': 'shaders',
  '家具': 'furniture',
  '建筑': 'building',
  '农业': 'farming',
  '食物': 'food',
  '料理': 'cooking',
  '林业': 'forestry',
  '蜜蜂': 'bees',
  '飞机': 'planes',
  '战斗': 'combat',
  '武器': 'weapons',
  '工具': 'tools',
  '图书馆': 'library',
  '图书馆': 'library',
  '语言': 'language',
  '翻译': 'translation',
  '材质包': 'resource packs',
  '光影包': 'shaders',
  '生存模式': 'survival',
  '创造模式': 'creative',
  '多人': 'multiplayer',
  '服务器': 'server',
};

const STOP_WORDS = ['我的世界', '模组', 'mod', '的', '和', '与', '版', '一个', '一些'];
const keys = Object.keys(TERMS).sort((a, b) => b.length - a.length);
const hasChinese = (text) => /[\u3400-\u9fff]/.test(text);

function translateQuery(input) {
  const original = String(input || '').trim();
  if (!original || !hasChinese(original)) {
    return { original, query: original, translated: false, terms: [] };
  }
  let text = original;
  const terms = [];
  for (const key of keys) {
    if (!text.includes(key)) continue;
    const english = TERMS[key];
    text = text.split(key).join(` ${english} `);
    if (!terms.includes(english)) terms.push(english);
  }
  for (const stop of STOP_WORDS) {
    text = text.split(stop).join(' ');
  }
  const cleaned = text
    .replace(/[，。！？、；：""''（）【】《》]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return { original, query: original, translated: false, terms };
  return { original, query: cleaned, translated: cleaned !== original, terms };
}

module.exports = { translateQuery };
