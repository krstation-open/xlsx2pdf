/**
 * 扩展注册表：三层扩展点
 *  ① markerTypes    自定义标记类型（与内置同名时覆盖内置并告警）
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

/** 全局已注册的插件名（重名覆盖告警用） */
const globalNames = new Set();

/** 内置标记类型（由 engine.js 注册；插件同名覆盖并告警） */
const builtinMarkerTypes = Object.create(null);

/**
 * 注册内置标记类型（仅 engine.js 使用）
 * @param {Object<string, Function>} map
 */
export function registerBuiltinMarkerTypes(map) {
  Object.assign(builtinMarkerTypes, map);
}

function applyPlugin(state, plugin, { warnName, warnBuiltin } = {}) {
  if (!plugin || typeof plugin !== 'object') {
    throw xlsxError('E_PLUGIN_INVALID',
      '[registry] 插件必须是对象',
      'A plugin must be an object.');
  }
  if (plugin.name && warnName) {
    if (warnName.has(plugin.name)) {
      console.warn(`[registry] 插件 "${plugin.name}" 重名注册，新注册将覆盖旧注册`);
    }
    warnName.add(plugin.name);
  }
  if (plugin.markerTypes) {
    for (const [type, handler] of Object.entries(plugin.markerTypes)) {
      if (typeof handler !== 'function') {
        throw xlsxError('E_PLUGIN_INVALID',
          `[registry] markerTypes.${type} 必须是函数`,
          `markerTypes.${type} must be a function.`);
      }
      if (warnBuiltin && builtinMarkerTypes[type]) {
        console.warn(`[registry] 标记类型 "${type}" 覆盖了内置类型`);
      }
      state.markerTypes.set(type, handler);
    }
  }
  if (plugin.fieldResolvers) {
    for (const resolver of plugin.fieldResolvers) {
      if (typeof resolver !== 'function') {
        throw xlsxError('E_PLUGIN_INVALID',
          '[registry] fieldResolvers 项必须是函数',
          'Each fieldResolvers entry must be a function.');
      }
      state.fieldResolvers.push(resolver);
    }
  }
  if (plugin.transformModel) {
    if (typeof plugin.transformModel !== 'function') {
      throw xlsxError('E_PLUGIN_INVALID',
        '[registry] transformModel 必须是函数',
        'transformModel must be a function.');
    }
    state.transformModels.push(plugin.transformModel);
  }
}

/**
 * 注册全局扩展插件（进程内生效）
 *
 * @param {Object} plugin
 * @param {string} [plugin.name] - 插件名（重名覆盖并告警）
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
