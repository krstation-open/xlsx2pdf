/**
 * 扩展注册表：三层扩展点
 *  ① markerTypes    自定义标记类型（覆盖内置规范类型时告警；注册别名同名 key = 接管别名槽，静默无告警）
 *  ② fieldResolvers 自定义字段解析器（按序调用，首个非 undefined 命中）
 *  ③ transformModel 模型后处理钩子（按注册顺序调用）
 *
 * 注册方式两级：
 *  - 全局：use(plugin)，进程内生效
 *  - 调用级：option.plugins，仅本次生成生效（冲突时覆盖全局）
 */

import { xlsxError } from './errors.js';

function createPluginState() {
  return { markerTypes: new Map(), fieldResolvers: [], transformModels: [] };
}

/** 全局注册表（模块级单例） */
const globalState = createPluginState();

/** 全局已注册的插件名（重名注册告警用） */
const globalNames = new Set();

/** 内置标记类型（由 engine.js 注册；插件覆盖规范类型并告警，别名同名 key 接管静默） */
const builtinMarkerTypes = Object.create(null);

/**
 * 注册内置标记类型（仅 engine.js 使用）
 * @param {Object<string, Function>} map
 */
export function registerBuiltinMarkerTypes(map) {
  Object.assign(builtinMarkerTypes, map);
}

/**
 * 校验 markerAliases 映射（configure 与调用级 option 共用）。
 * 契约：null 恢复内置默认；对象整体替换生效映射；
 * key 须非空字符串且不得为内置规范类型名或与目标同名；
 * 目标须为已知规范类型（内置或已注册），不允许 alias→alias 链。
 * @param {*} value - 待校验映射
 * @param {string} where - 报错定位（configure / option）
 * @param {string[]} [extraTypes] - 额外已知类型（调用级插件注册的 markerTypes keys）
 */
export function validateMarkerAliases(value, where, extraTypes = []) {
  if (value === null) return; // 恢复内置默认
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw xlsxError('E_OPTION_INVALID',
      `[xlsx2pdf] ${where}.markerAliases 只接受对象（别名 → 规范类型名）或 null（恢复内置默认），收到：${JSON.stringify(value)}`,
      `${where}.markerAliases accepts an object (alias -> canonical type) or null (restore built-in defaults) only, received: ${JSON.stringify(value)}.`);
  }
  for (const [key, target] of Object.entries(value)) {
    if (!key) {
      throw xlsxError('E_OPTION_INVALID',
        `[xlsx2pdf] ${where}.markerAliases 的别名键须为非空字符串`,
        `${where}.markerAliases alias keys must be non-empty strings.`);
    }
    if (builtinMarkerTypes[key]) {
      throw xlsxError('E_OPTION_INVALID',
        `[xlsx2pdf] ${where}.markerAliases 的别名键 "${key}" 不得为内置规范类型名`,
        `${where}.markerAliases alias key "${key}" must not be a built-in canonical type name.`);
    }
    if (typeof target !== 'string' || !target || key === target) {
      throw xlsxError('E_OPTION_INVALID',
        `[xlsx2pdf] ${where}.markerAliases["${key}"] 须为非空字符串且不与别名同名，收到：${JSON.stringify(target)}`,
        `${where}.markerAliases["${key}"] must be a non-empty string different from the alias itself, received: ${JSON.stringify(target)}.`);
    }
    if (value[target] !== undefined) {
      throw xlsxError('E_OPTION_INVALID',
        `[xlsx2pdf] ${where}.markerAliases 不允许 alias→alias 链（"${key}" → "${target}" 仍是别名）`,
        `${where}.markerAliases does not allow alias-to-alias chains ("${key}" -> "${target}" is still an alias).`);
    }
    if (!builtinMarkerTypes[target] && !globalState.markerTypes.has(target) && !extraTypes.includes(target)) {
      throw xlsxError('E_OPTION_INVALID',
        `[xlsx2pdf] ${where}.markerAliases["${key}"] 的目标 "${target}" 不是已知规范类型（内置或已注册）`,
        `${where}.markerAliases["${key}"] target "${target}" is not a known canonical type (built-in or registered).`);
    }
  }
}

function applyPlugin(state, plugin, { warnName, warnBuiltin } = {}) {
  if (!plugin || typeof plugin !== 'object') {
    throw xlsxError('E_PLUGIN_INVALID',
      '[registry] 插件必须是对象',
      'A plugin must be an object.');
  }
  // 先完整校验再统一提交（原子性）：中途失败不得留下半生效的全局状态
  const markerEntries = [];
  if (plugin.markerTypes) {
    for (const [type, handler] of Object.entries(plugin.markerTypes)) {
      if (typeof handler !== 'function') {
        throw xlsxError('E_PLUGIN_INVALID',
          `[registry] markerTypes.${type} 必须是函数`,
          `markerTypes.${type} must be a function.`);
      }
      markerEntries.push([type, handler]);
    }
  }
  const resolvers = [];
  if (plugin.fieldResolvers) {
    for (const resolver of plugin.fieldResolvers) {
      if (typeof resolver !== 'function') {
        throw xlsxError('E_PLUGIN_INVALID',
          '[registry] fieldResolvers 项必须是函数',
          'Each fieldResolvers entry must be a function.');
      }
      resolvers.push(resolver);
    }
  }
  if (plugin.transformModel && typeof plugin.transformModel !== 'function') {
    throw xlsxError('E_PLUGIN_INVALID',
      '[registry] transformModel 必须是函数',
      'transformModel must be a function.');
  }

  // 提交阶段（以下不再有可能失败的校验）
  if (plugin.name && warnName) {
    if (warnName.has(plugin.name)) {
      console.warn(`[registry] 插件 "${plugin.name}" 重名注册：markerTypes 同名覆盖，fieldResolvers/transformModel 按注册顺序追加`);
    }
    warnName.add(plugin.name);
  }
  for (const [type, handler] of markerEntries) {
    if (warnBuiltin && builtinMarkerTypes[type]) {
      console.warn(`[registry] 标记类型 "${type}" 覆盖了内置类型`);
    }
    state.markerTypes.set(type, handler);
  }
  state.fieldResolvers.push(...resolvers);
  if (plugin.transformModel) {
    state.transformModels.push(plugin.transformModel);
  }
}

/**
 * 注册全局扩展插件（进程内生效）
 *
 * @param {Object} plugin
 * @param {string} [plugin.name] - 插件名（重名注册告警：markerTypes 同名覆盖，解析器/钩子按序追加）
 * @param {Object<string, Function>} [plugin.markerTypes] - 自定义标记类型
 *   handler 签名：async (value, option, ctx) => result；
 *   返回值契约：string → 文本替换；{ images: [{ dataUrl, width?, height?, offsetX?, offsetY?, zIndex?, opacity? }] } → 图片嵌入
 *   （width/height 未设或为 0 时按原图尺寸/宽高比归一化，同内置 image 的 w/h 适配规则）；
 *   { watermarks: [{ text, zIndex?, opacity?, minSize?, lineHeight? }] } → watermark 文本水印浮层；
 *   { text, images, watermarks } → 混合；null/undefined → 按空值处理（清除标记）
 * @param {Function[]} [plugin.fieldResolvers] - 字段解析器，async (field, data, ctx) => value，
 *   返回 undefined 则回退后续链路（其余解析器 → flatData → 标记默认值 → option.defaults）
 * @param {Function} [plugin.transformModel] - 模型后处理钩子 (model, ctx) => model|void
 */
export function use(plugin) {
  applyPlugin(globalState, plugin, { warnName: globalNames, warnBuiltin: true });
}

/**
 * 合并全局插件与调用级插件，产出单次生成的有效扩展上下文。
 *
 * 覆盖语义（调用级 > 全局）：
 *  - markerTypes：同名类型覆盖
 *  - fieldResolvers：调用级先于全局执行（首个非 undefined 命中 → 覆盖语义）
 *  - transformModels：调用级在全局之后执行（后执行的钩子最终生效）
 *
 * @param {Array} [callPlugins] - option.plugins 调用级插件
 * @returns {{ markerTypes: Map, fieldResolvers: Function[], transformModels: Function[] }}
 */
export function resolveEffectivePlugins(callPlugins) {
  const eff = createPluginState();
  for (const [type, handler] of globalState.markerTypes) eff.markerTypes.set(type, handler);
  eff.fieldResolvers.push(...globalState.fieldResolvers);
  eff.transformModels.push(...globalState.transformModels);

  if (Array.isArray(callPlugins)) {
    const callState = createPluginState();
    for (const plugin of callPlugins) applyPlugin(callState, plugin);
    for (const [type, handler] of callState.markerTypes) eff.markerTypes.set(type, handler);
    eff.fieldResolvers = [...callState.fieldResolvers, ...eff.fieldResolvers];
    eff.transformModels.push(...callState.transformModels);
  }
  return eff;
}

/**
 * 查找标记类型 handler：插件（调用级 > 全局）优先，其次内置
 * @param {string} type
 * @param {Object} effective - resolveEffectivePlugins 的输出
 * @returns {Function|null}
 */
export function lookupMarkerType(type, effective) {
  return effective.markerTypes.get(type) || builtinMarkerTypes[type] || null;
}

/**
 * 标记类型名全量列表（内置 + 已注册），供标记解析器识别类型 token
 * @param {Object} effective - resolveEffectivePlugins 的输出
 * @returns {string[]}
 */
export function listMarkerTypes(effective) {
  const names = new Set(Object.keys(builtinMarkerTypes));
  for (const type of effective.markerTypes.keys()) names.add(type);
  return [...names];
}
