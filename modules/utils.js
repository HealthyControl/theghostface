// utils.js
import {getContext,extension_settings,} from '../../../../extensions.js';
import {chat_metadata, getMaxContextSize, generateRaw,streamingProcessor,main_api,system_message_types,saveSettingsDebounced,getRequestHeaders,saveChatDebounced,chat,this_chid,characters,reloadCurrentChat,} from '../../../../../script.js';
import {createWorldInfoEntry,deleteWIOriginalDataValue,deleteWorldInfoEntry,importWorldInfo,loadWorldInfo,saveWorldInfo,world_info} from '../../../../world-info.js';
import {eventSource, event_types } from '../../../../../script.js';
import { download, debounce, initScrollHeight, resetScrollHeight, parseJsonFile, extractDataFromPng, getFileBuffer, getCharaFilename, getSortableDelay, escapeRegex, PAGINATION_TEMPLATE, navigation_option, waitUntilCondition, isTrueBoolean, setValueByPath, flashHighlight, select2ModifyOptions, getSelect2OptionId, dynamicSelect2DataViaAjax, highlightRegex, select2ChoiceClickSubscribe, isFalseBoolean, getSanitizedFilename, checkOverwriteExistingData, getStringHash, parseStringArray, cancelDebounce, findChar, onlyUnique, equalsIgnoreCaseAndAccents } from '../../../../utils.js';


// 🔧 移除循环依赖 - 不导入其他模块
// import * as ui from './ui.js';  // ❌ 移除这个
// import * as core from './core.js';  // ❌ 移除这个

// 🆕 定义常量（避免依赖其他模块）
const MODULE_NAME = 'the_ghost_face';
const PANEL_ID = `${MODULE_NAME}_control_panel`;
const MAX_LOG_ENTRIES = 100;

// 🔧 系统初始化状态（全局管理）
let systemInitialized = false;

// 🆕 设置系统初始化状态的函数
export function setSystemInitialized(status) {
    systemInitialized = status;
    console.log(`🔧 [鬼面] 系统初始化状态: ${status}`);
}

// 🆕 检查系统是否初始化的函数
export function isSystemInitialized() {
    return systemInitialized;
}

// 日志级别
export const LOG_LEVEL = {
    DEBUG: 'debug',
    INFO: 'info',
    WARN: 'warn',
    ERROR: 'error'
};

// HTML转义函数
export function escapeHtml(unsafe) {
    if (typeof unsafe !== 'string') return unsafe;
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// 🔧 改进的日志记录函数
export function logToUI(level, message, details = null) {
    const now = new Date();
    const timeStr = now.toLocaleTimeString();
    
    // 🎯 始终输出到控制台（带格式）
    const consoleMessage = `[鬼面][${timeStr}] ${message}`;
    switch (level) {
        case LOG_LEVEL.DEBUG:
            console.debug(consoleMessage, details);
            break;
        case LOG_LEVEL.INFO:
            console.info(consoleMessage, details);
            break;
        case LOG_LEVEL.WARN:
            console.warn(consoleMessage, details);
            break;
        case LOG_LEVEL.ERROR:
            console.error(consoleMessage, details);
            break;
        case 'SUCCESS':
            console.info(`✅ ${consoleMessage}`, details);
            break;
        default:
            console.log(consoleMessage, details);
    }
    
    // 🎯 检查系统是否初始化
    if (!systemInitialized) {
        console.log(`[鬼面][初始化期间] ${level}: ${message}`, details);
        return;
    }
    
    // 🎯 查找日志容器
    const content = document.getElementById(`${PANEL_ID}_log_content`);
    if (!content) {
        console.log(`[鬼面][容器不存在] ${level}: ${message}`, details);
        return;
    }
    
    // 🧹 限制日志条目数量
    const logs = content.querySelectorAll('.log-entry');
    if (logs.length >= MAX_LOG_ENTRIES) {
        // 删除最旧的10条
        for (let i = 0; i < 10 && logs[i]; i++) {
            const oldLog = logs[i];
            oldLog.style.animation = 'logClearEffect 0.3s ease-out forwards';
            setTimeout(() => {
                if (oldLog.parentNode) {
                    content.removeChild(oldLog);
                }
            }, 300);
        }
    }
    
    // 🎨 日志级别映射
    let levelClass = '';
    let levelText = '';
    let levelColor = '';
    
    switch (level) {
        case LOG_LEVEL.DEBUG:
            levelClass = 'log-debug';
            levelText = 'DEBUG';
            levelColor = 'var(--ghost-accent)';
            break;
        case LOG_LEVEL.INFO:
            levelClass = 'log-info';
            levelText = 'INFO';
            levelColor = '#2196f3';
            break;
        case LOG_LEVEL.WARN:
            levelClass = 'log-warning';
            levelText = 'WARN';
            levelColor = 'var(--ghost-warning)';
            break;
        case LOG_LEVEL.ERROR:
            levelClass = 'log-error';
            levelText = 'ERROR';
            levelColor = 'var(--ghost-error)';
            break;
        case 'SUCCESS':
            levelClass = 'log-success';
            levelText = 'SUCCESS';
            levelColor = 'var(--ghost-success)';
            break;
        default:
            levelClass = 'log-info';
            levelText = 'INFO';
            levelColor = '#2196f3';
    }
    
    // 🎨 创建新的日志条目
    const logEntry = document.createElement('div');
    logEntry.className = `log-entry ${levelClass} new-entry`;
    
    logEntry.innerHTML = `
        <div class="log-entry-header">
            <span class="log-timestamp">[${timeStr}]</span>
            <span class="log-level">${levelText}</span>
        </div>
        <div class="log-message">${escapeHtml(message)}</div>
        ${details ? `<div class="log-details">${escapeHtml(JSON.stringify(details, null, 2))}</div>` : ''}
    `;
    
    // 🎯 添加到内容区域
    content.appendChild(logEntry);
    
    // 🎯 标记有新内容
    content.classList.add('has-new-content');
    setTimeout(() => {
        content.classList.remove('has-new-content');
    }, 2000);
    
    // 🎯 自动滚动到底部
    content.scrollTop = content.scrollHeight;
    
    // 🎯 移除new-entry类（用于入场动画）
    setTimeout(() => {
        logEntry.classList.remove('new-entry');
    }, 400);
}

// 🆕 logger对象（改进版）
export const logger = {
    debug: (msg, details) => logToUI(LOG_LEVEL.DEBUG, msg, details),
    info: (msg, details) => logToUI(LOG_LEVEL.INFO, msg, details),
    warn: (msg, details) => logToUI(LOG_LEVEL.WARN, msg, details),
    error: (msg, details) => logToUI(LOG_LEVEL.ERROR, msg, details),
    success: (msg, details) => logToUI('SUCCESS', msg, details)
};

//查找绑定世界书
export async function findActiveWorldBook() {
    try {
        console.log('🔍 开始查找活跃世界书...');
        
        // 🚨 关键检查：ST是否完全加载
        if (typeof this_chid === 'undefined') {
            console.log('⚠️ this_chid 未定义，ST可能还未完全加载');
            return null;
        }
        
        if (this_chid === null || this_chid === undefined) {
            console.log('⚠️ 当前没有选中的角色');
            return null;
        }
        
        if (typeof characters === 'undefined' || !characters || !characters[this_chid]) {
            console.log('⚠️ 角色数据不可用');
            return null;
        }

        const character = characters[this_chid];
        const name = character?.name;
        console.log(`🔍 当前角色: ${name}`);
        
        /** @type {Set<string>} */
        let worldsToSearch = new Set();

        // 🎯 方法1: 使用官方的正确路径
        const baseWorldName = character?.data?.extensions?.world;
        if (baseWorldName) {
            worldsToSearch.add(baseWorldName);
            console.log(`✅ 从 data.extensions.world 找到: ${baseWorldName}`);
        }

        // 🎯 方法2: 检查传统的world字段（兼容性）
        const legacyWorld = character?.world;
        if (legacyWorld && typeof legacyWorld === 'string') {
            const worldList = legacyWorld.split(',').map(w => w.trim()).filter(Boolean);
            worldList.forEach(w => worldsToSearch.add(w));
            console.log(`✅ 从 world 字段找到: ${worldList.join(', ')}`);
        }

        // 🎯 方法3: 检查额外的角色世界书（参考官方代码）
        if (typeof getCharaFilename === 'function' && typeof world_info !== 'undefined' && world_info.charLore) {
            try {
                const fileName = getCharaFilename(this_chid);
                const extraCharLore = world_info.charLore?.find((e) => e.name === fileName);
                if (extraCharLore && extraCharLore.extraBooks) {
                    extraCharLore.extraBooks.forEach(book => worldsToSearch.add(book));
                    console.log(`✅ 从 charLore 找到额外世界书: ${extraCharLore.extraBooks.join(', ')}`);
                }
            } catch (error) {
                console.log('⚠️ 获取角色文件名失败:', error);
            }
        }

        if (!worldsToSearch.size) {
            console.log('❌ 角色未绑定任何世界书');
            return null;
        }

        // 返回第一个找到的世界书
        const firstWorld = Array.from(worldsToSearch)[0];
        console.log(`✅ 最终选择世界书: ${firstWorld}`);
        console.log(`🔍 所有可用世界书: [${Array.from(worldsToSearch).join(', ')}]`);
        
        return firstWorld;

    } catch (error) {
        console.error('❌ 查找世界书时发生错误:', error);
        return null;
    }
}

