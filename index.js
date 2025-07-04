// TheGhostFace - 修复版本 - 解决重复条目和自动触发问题
// 070424hiking前改的好吗？？
// 机器人

import {
    getContext,
    extension_settings,
} from '../../../extensions.js';
import {
    chat_metadata,
    getMaxContextSize,
    generateRaw,
    streamingProcessor,
    main_api,
    system_message_types,
    saveSettingsDebounced,
    getRequestHeaders,
} from '../../../../script.js';
import {
    parseJsonFile,
    delay,
    navigation_option,
    copyText,
    getStringHash,
    debounce,
    waitUntilCondition
} from '../../../utils.js';
import { 
    createWorldInfoEntry,
    deleteWIOriginalDataValue,
    deleteWorldInfoEntry,
    importWorldInfo,
    loadWorldInfo,
    saveWorldInfo,
    world_info 
} from '../../../world-info.js';
import { getPresetManager } from '../../../preset-manager.js';
import { formatInstructModeChat } from '../../../instruct-mode.js';
import { loadMovingUIState, renderStoryString, power_user } from '../../../power-user.js';
import { dragElement } from '../../../RossAscends-mods.js';
import { debounce_timeout } from '../../../constants.js';
import { MacrosParser } from '../../../macros.js';
import { commonEnumProviders } from '../../../slash-commands/SlashCommandCommonEnumsProvider.js';
import { executeSlashCommands, registerSlashCommand } from '../../../slash-commands.js';
import { getRegexScripts } from '../../../../scripts/extensions/regex/index.js';
import { runRegexScript } from '../../../../scripts/extensions/regex/engine.js';

export { MODULE_NAME };

// 数据储存定位
const MODULE_NAME = 'the_ghost_face';
const MODULE_NAME_FANCY = '鬼面';
const PROGRESS_BAR_ID = `${MODULE_NAME}_progress_bar`;

// 🔧 新增：预定义的固定类别
const PREDEFINED_CATEGORIES = {
    '喜好': {
        comment: '我们的故事 - 喜好偏好',
        key: ['喜欢', '偏好', '爱好', '喜好'],
        order: 90
    },
    '恐惧': {
        comment: '我们的故事 - 恐惧害怕',
        key: ['害怕', '恐惧', '讨厌', '不喜欢'],
        order: 91
    },
    '事件': {
        comment: '我们的故事 - 重要事件',
        key: ['发生', '事件', '经历', '回忆'],
        order: 92
    },
    '关系': {
        comment: '我们的故事 - 人际关系',
        key: ['朋友', '家人', '关系', '认识'],
        order: 93
    },
    '梦境': {
        comment: '我们的故事 - 梦境幻想',
        key: ['梦见', '梦境', '幻想', '想象'],
        order: 94
    },
    '互动': {
        comment: '我们的故事 - 独特互动',
        key: ['互动', '交流', '对话', '玩耍'],
        order: 95
    }
};

// 🔧 新增：自动触发相关变量
let lastMessageCount = 0;
let autoTriggerEnabled = true;
const AUTO_TRIGGER_THRESHOLD = 40; // 40条新消息触发
let isAutoSummarizing = false; // 防止重复触发

// 日志记录部分 - 修复版本
const LOG_CONTAINER_ID = `${MODULE_NAME}_log_container`;
const MAX_LOG_ENTRIES = 50;

// 🔧 修复1: 添加初始化标志，防止递归
let logSystemInitialized = false;

// 创建日志容器 - 防止递归调用
function createLogContainer() {
    // 防止重复创建
    if (logSystemInitialized) {
        return;
    }
    
    // 如果已存在则先移除
    const existingContainer = document.getElementById(LOG_CONTAINER_ID);
    if (existingContainer) {
        existingContainer.remove();
    }

    const logHTML = `
    <div id="${LOG_CONTAINER_ID}" style="
        position: fixed;
        bottom: 20px;
        right: 20px;
        width: 400px;
        max-height: 300px;
        background: rgba(0, 0, 0, 0.85);
        color: #eee;
        border: 1px solid #444;
        border-radius: 8px;
        font-family: monospace;
        font-size: 12px;
        overflow: hidden;
        z-index: 9999;
        display: flex;
        flex-direction: column;
    ">
        <div style="
            padding: 8px 12px;
            background: #333;
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 1px solid #555;
        ">
            <strong>👻 受害者的详细进程</strong>
            <div>
                <button id="${LOG_CONTAINER_ID}_toggle" style="
                    background: #555;
                    color: white;
                    border: none;
                    border-radius: 4px;
                    padding: 2px 8px;
                    margin-right: 5px;
                    cursor: pointer;
                ">最小化</button>
                <button id="${LOG_CONTAINER_ID}_clear" style="
                    background: #555;
                    color: white;
                    border: none;
                    border-radius: 4px;
                    padding: 2px 8px;
                    cursor: pointer;
                ">清空</button>
            </div>
        </div>
        <div id="${LOG_CONTAINER_ID}_content" style="
            flex-grow: 1;
            overflow-y: auto;
            padding: 8px;
            line-height: 1.4;
        "></div>
    </div>
    `;

    document.body.insertAdjacentHTML('beforeend', logHTML);

    // 添加交互功能
    const toggleBtn = document.getElementById(`${LOG_CONTAINER_ID}_toggle`);
    const clearBtn = document.getElementById(`${LOG_CONTAINER_ID}_clear`);
    
    if (toggleBtn) toggleBtn.addEventListener('click', toggleLogContainer);
    if (clearBtn) clearBtn.addEventListener('click', clearLogs);
    
    // 🔧 修复2: 标记初始化完成
    logSystemInitialized = true;
}

function toggleLogContainer() {
    const container = document.getElementById(LOG_CONTAINER_ID);
    const content = document.getElementById(`${LOG_CONTAINER_ID}_content`);
    const button = document.getElementById(`${LOG_CONTAINER_ID}_toggle`);

    if (content && button) {
        if (content.style.display === 'none') {
            content.style.display = 'block';
            button.textContent = '最小化';
            if (container) container.style.height = '300px';
        } else {
            content.style.display = 'none';
            button.textContent = '展开';
            if (container) container.style.height = 'auto';
        }
    }
}

function clearLogs() {
    const content = document.getElementById(`${LOG_CONTAINER_ID}_content`);
    if (content) {
        content.innerHTML = '';
    }
}

// 日志级别
const LOG_LEVEL = {
    DEBUG: 'debug',
    INFO: 'info',
    WARN: 'warn',
    ERROR: 'error'
};

// 🔧 修复3: 安全的日志记录函数
function logToUI(level, message, details = null) {
    // 防止在初始化期间的递归调用
    if (!logSystemInitialized) {
        console.log(`[鬼面][初始化期间] ${level}: ${message}`, details);
        return;
    }

    const content = document.getElementById(`${LOG_CONTAINER_ID}_content`);
    if (!content) {
        console.log(`[鬼面][容器不存在] ${level}: ${message}`, details);
        return;
    }

    // 限制日志条目数量
    const logs = content.querySelectorAll('.log-entry');
    if (logs.length >= MAX_LOG_ENTRIES) {
        content.removeChild(logs[0]);
    }

    const now = new Date();
    const timeStr = now.toLocaleTimeString();

    let levelClass = '';
    let levelText = '';
    switch (level) {
        case LOG_LEVEL.DEBUG:
            levelClass = 'log-debug';
            levelText = 'DEBUG';
            console.debug(`[鬼面][${timeStr}] ${message}`, details);
            break;
        case LOG_LEVEL.INFO:
            levelClass = 'log-info';
            levelText = 'INFO';
            console.info(`[鬼面][${timeStr}] ${message}`, details);
            break;
        case LOG_LEVEL.WARN:
            levelClass = 'log-warn';
            levelText = 'WARN';
            console.warn(`[鬼面][${timeStr}] ${message}`, details);
            break;
        case LOG_LEVEL.ERROR:
            levelClass = 'log-error';
            levelText = 'ERROR';
            console.error(`[鬼面][${timeStr}] ${message}`, details);
            break;
        default:
            levelClass = 'log-info';
            levelText = 'INFO';
            console.info(`[鬼面][${timeStr}] ${message}`, details);
    }

    const logEntry = document.createElement('div');
    logEntry.className = `log-entry ${levelClass}`;
    logEntry.style.padding = '4px 0';
    logEntry.style.borderBottom = '1px solid #333';
    logEntry.style.wordBreak = 'break-word';

    logEntry.innerHTML = `
        <div style="display: flex; justify-content: space-between;">
            <span style="color: #aaa;">[${timeStr}]</span>
            <strong style="color: ${getLevelColor(level)}">${levelText}</strong>
        </div>
        <div>${escapeHtml(message)}</div>
        ${details ? `<pre style="color: #999; margin: 4px 0 0 0; font-size: 11px; white-space: pre-wrap;">${escapeHtml(JSON.stringify(details, null, 2))}</pre>` : ''}
    `;

    content.appendChild(logEntry);
    content.scrollTop = content.scrollHeight;
}

function getLevelColor(level) {
    switch (level) {
        case LOG_LEVEL.DEBUG: return '#66b3ff';
        case LOG_LEVEL.INFO: return '#4caf50';
        case LOG_LEVEL.WARN: return '#ff9800';
        case LOG_LEVEL.ERROR: return '#f44336';
        default: return '#ffffff';
    }
}

function escapeHtml(unsafe) {
    if (typeof unsafe !== 'string') return unsafe;
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// 🔧 修复4: 安全的日志快捷方法
const logger = {
    debug: (msg, details) => logToUI(LOG_LEVEL.DEBUG, msg, details),
    info: (msg, details) => logToUI(LOG_LEVEL.INFO, msg, details),
    warn: (msg, details) => logToUI(LOG_LEVEL.WARN, msg, details),
    error: (msg, details) => logToUI(LOG_LEVEL.ERROR, msg, details)
};

function addLogStyles() {
    const style = document.createElement('style');
    style.textContent = `
        .log-entry {
            transition: background-color 0.2s;
        }
        .log-entry:hover {
            background-color: rgba(255, 255, 255, 0.05);
        }
        .log-debug {
            border-left: 3px solid #66b3ff;
            padding-left: 5px;
        }
        .log-info {
            border-left: 3px solid #4caf50;
            padding-left: 5px;
        }
        .log-warn {
            border-left: 3px solid #ff9800;
            padding-left: 5px;
        }
        .log-error {
            border-left: 3px solid #f44336;
            padding-left: 5px;
        }
        #${LOG_CONTAINER_ID}_content::-webkit-scrollbar {
            width: 6px;
        }
        #${LOG_CONTAINER_ID}_content::-webkit-scrollbar-track {
            background: rgba(255, 255, 255, 0.1);
        }
        #${LOG_CONTAINER_ID}_content::-webkit-scrollbar-thumb {
            background: rgba(255, 255, 255, 0.2);
            border-radius: 3px;
        }
    `;
    document.head.appendChild(style);
}

// ✨ 工具函数：统一获取消息数组
function getMessageArray(source) {
    if (Array.isArray(source?.chat)) return source.chat;
    if (Array.isArray(source?.messages)) return source.messages;
    if (Array.isArray(source)) return source;
    
    if (typeof source?.generateQuietPrompt === 'function') {
        logger.warn('[ghostface] getContext 返回封装对象，无法提取消息数组:', source);
        return [];
    }

    logger.warn('[ghostface] 未识别的上下文结构:', source);
    return [];
}

// 🔧 新增：自动触发检测函数
async function checkAutoTrigger() {
    if (!autoTriggerEnabled || isAutoSummarizing) {
        return;
    }

    try {
        const context = await getContext();
        const messages = getMessageArray(context);
        const currentCount = messages.length;

        // 计算新消息数量
        const newMessageCount = currentCount - lastMessageCount;
        
        if (lastMessageCount > 0 && newMessageCount >= AUTO_TRIGGER_THRESHOLD) {
            logger.info(`🤖 检测到 ${newMessageCount} 条新消息，达到自动触发阈值 ${AUTO_TRIGGER_THRESHOLD}`);
            toastr.info(`👻 鬼面检测到 ${newMessageCount} 条新消息，准备自动总结...`, null, {
                timeOut: 3000,
                closeButton: true,
                progressBar: true
            });
            
            // 标记正在处理，防止重复触发
            isAutoSummarizing = true;
            
            // 延迟1秒后执行，让用户看到提示
            setTimeout(async () => {
                try {
                    logger.info('🤖 开始执行自动总结...');
                    await stealthSummarize(false, true); // 第二个参数表示是自动触发
                } catch (error) {
                    logger.error('🤖 自动总结失败:', error);
                } finally {
                    isAutoSummarizing = false;
                }
            }, 1000);
        }

        // 更新消息计数
        lastMessageCount = currentCount;

    } catch (error) {
        logger.error('🤖 自动触发检测失败:', error);
    }
}

// ✨ 收集消息（全量或增量）
async function getGhostContextMessages(isInitial = false) {
    const context = await getContext(); 
    const messages = getMessageArray(context);

    logger.info(`[ghostface] 获取到 ${messages.length} 条消息`);
    
    if (messages.length === 0) {
        logger.warn('[ghostface] 没有找到任何消息');
        return [];
    }

    const filtered = messages.slice(isInitial ? 0 : -40).filter(msg => {
        if (msg.extra?.ghost_summarized) return false;
        
        const isValidMessage = msg.is_user || msg.is_system || (!msg.is_user && !msg.is_system && msg.mes);
        return isValidMessage;
    });
    
    logger.info(`[ghostface] ${isInitial ? '初始' : '增量'}筛选: ${filtered.length} 条消息`);
    return filtered;
}

// 模型总结生成
async function generateSummary(messages) {
    logger.info('[ghostface] === 开始 generateSummary ===');
    
    if (!messages || messages.length === 0) {
        logger.warn('[ghostface] generateSummary: 没有可用消息');
        return '';
    }

    logger.info(`[ghostface] 步骤1: 准备处理 ${messages.length} 条消息`);

    try {
        logger.info('[ghostface] 步骤2: 开始构建上下文文本...');
        const contextText = messages
            .map((msg, index) => {
                const speaker = msg.is_user ? '{{user}}' : 
                               msg.is_system ? 'System' : 
                               (msg.name || '{{char}}');
                
                let content = '';
                if (typeof msg.mes === 'string') {
                    content = msg.mes;
                } else if (typeof msg.text === 'string') {
                    content = msg.text;
                } else if (typeof msg.content === 'string') {
                    content = msg.content;
                } else {
                    content = '[无内容]';
                }
                
                logger.info(`[ghostface] 消息${index + 1}: ${speaker} (${content.length}字)`);
                return `${speaker}: ${content}`;
            })
            .join('\n');

        logger.info(`[ghostface] 步骤3: 上下文构建完成，总长度: ${contextText.length} 字符`);

        const optimized_prompt = `你是一个专业且充满热心的故事总结助手，你很喜欢八卦这对甜蜜的小情侣，请从最近的对话中提取可复用剧情细节，确保未来{{char}}可以使用这些"记忆"随时给{{user}}小惊喜，让{{user}}能感觉到发生过的事情都真的被记住了：

请按照以下6个固定类别进行分类：
1. 喜好 - 明确的喜欢、偏好、爱好（比如"喜欢雨天"、"爱吃草莓"）
2. 恐惧 - 害怕、讨厌、不喜欢的事物（比如"害怕蜘蛛"、"讨厌苦瓜"）
3. 事件 - 发生的重要事情、经历（比如"昨天去了游乐园"、"考试得了满分"）
4. 关系 - 人际关系、朋友家人（比如"有个叫小明的朋友"、"妈妈很严格"）
5. 梦境 - 梦见的内容、幻想、想象（比如"梦见变成了猫"、"幻想当超级英雄"）
6. 互动 - {{char}}与{{user}}的独特互动方式（比如"喜欢摸头"、"会撒娇求抱抱"）

输出要求：
- 每行一个细节，格式：[类别] 具体内容
- 保留原始关键词和情感色彩
- 只记录明确的信息，不要推测或补充

对话记录：
${contextText}

示例输出：
[喜好] {{user}}喜欢雨天喝红茶
[恐惧] {{user}}害怕檀香的气味
[事件] {{char}}玩游戏很菜被{{user}}嘲笑了
[关系] {{user}}有个很要好的朋友叫小李
[梦境] {{user}}梦见自己变成了一只猫
[互动] {{char}}喜欢在{{user}}难过时轻抚头发`;

        logger.info(`[ghostface] 步骤4: 提示词构建完成，长度: ${optimized_prompt.length} 字符`);
        
        if (optimized_prompt.length > 8000) {
            logger.warn(`[ghostface] ⚠️ 提示词过长 (${optimized_prompt.length}字符)，可能导致API调用失败`);
        }

        logger.info('[ghostface] 步骤5: 获取Context对象...');
        const context = await getContext();
        
        if (!context) {
            throw new Error('getContext() 返回 null/undefined');
        }
        
        logger.info('[ghostface] 步骤6: Context对象获取成功，类型:', typeof context);
        
        if (typeof context.generateQuietPrompt !== 'function') {
            throw new Error('context.generateQuietPrompt 不是函数');
        }

        logger.info('[ghostface] 步骤8: 开始调用 generateQuietPrompt...');

        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('AI生成超时 (30秒)')), 30000);
        });

        const generatePromise = context.generateQuietPrompt(
            optimized_prompt,
            true,
            false,
            "你是一个专业的故事总结助手"
        );

        logger.info('[ghostface] 步骤9: 等待AI响应...');
        const result = await Promise.race([generatePromise, timeoutPromise]);
        
        logger.info('[ghostface] 步骤10: AI生成完成！');
        logger.info('[ghostface] 原始结果类型:', typeof result);
        logger.info('[ghostface] 原始结果长度:', result ? result.length : 'null');
        
        if (!result) {
            throw new Error('AI返回空结果');
        }

        logger.info('[ghostface] 步骤11: 开始解析模型输出...');
        const parsedResult = parseModelOutput(result);
        logger.info('[ghostface] 步骤12: 解析完成，最终结果长度:', parsedResult.length);
        logger.info('[ghostface] === generateSummary 成功完成 ===');
        
        return parsedResult;

    } catch (error) {
        logger.error('[ghostface] === generateSummary 发生错误 ===');
        logger.error('[ghostface] 错误类型:', error.constructor.name);
        logger.error('[ghostface] 错误消息:', error.message);
        throw error;
    }
}

function markMessagesSummarized(messages) {
    if (!Array.isArray(messages)) {
        logger.warn('[ghostface] markMessagesSummarized: 输入不是数组');
        return;
    }
    
    messages.forEach(msg => {
        msg.extra = msg.extra || {};
        msg.extra.ghost_summarized = true;
    });
    
    logger.info(`[ghostface] 已标记 ${messages.length} 条消息为已总结`);
}

function parseModelOutput(rawOutput) {
    logger.info('[ghostface] 开始解析模型输出...');
    
    try {
        if (!rawOutput || typeof rawOutput !== 'string') {
            logger.warn('[ghostface] 输出不是字符串，尝试转换...');
            rawOutput = String(rawOutput || '');
        }
        
        const lines = rawOutput.split('\n')
            .map(line => line.trim())
            .filter(line => {
                const isValid = line && line.match(/^\[.+?\]/);
                return isValid;
            });
            
        logger.info(`[ghostface] 解析完成: 找到 ${lines.length} 个有效条目`);
        
        const result = lines.join('\n');
        logger.info(`[ghostface] 最终解析结果长度: ${result.length}`);
        
        return result;
    } catch (error) {
        logger.error('[ghostface] 解析模型输出时出错:', error);
        return rawOutput || '';
    }
}

// 🔧 修复：主要总结函数，添加自动触发标识
async function stealthSummarize(isInitial = false, isAutoTriggered = false) {
    const triggerType = isAutoTriggered ? '自动触发' : '手动触发';
    logger.info(`[ghostface] === 开始 stealthSummarize 流程 (${triggerType}) ===`);
    
    const notificationText = isAutoTriggered ? 
        "🤖 鬼面自动尾随中..." : 
        "👻 鬼面尾随中...";
    
    const notification = toastr.info(notificationText, null, {
        timeOut: 0,
        closeButton: false,
        progressBar: false,
        hideDuration: 0,
        positionClass: "toast-top-center"
    });

    try {
        logger.info('[ghostface] 第1步: 开始收集消息...');
        const messages = await getGhostContextMessages(isInitial);
        
        if (!messages || messages.length === 0) {
            logger.warn('[ghostface] ⚠️ 没有找到可总结的消息');
            const warningText = isAutoTriggered ? 
                "自动总结：没有找到可总结的消息" : 
                "没有找到可总结的消息，鬼面愤怒拔线了...";
            toastr.warning(warningText);
            return;
        }

        logger.info(`[ghostface] 第1步完成: 收集到 ${messages.length} 条消息`);

        logger.info('[ghostface] 第2步: 开始生成总结...');
        const summaryContent = await generateSummary(messages);
        
        if (!summaryContent?.trim()) {
            logger.warn('[ghostface] ⚠️ AI生成的总结为空');
            const warningText = isAutoTriggered ? 
                "自动总结：AI生成的总结为空" : 
                "总结失败或为空，鬼面被板子砸到叹气...";
            toastr.warning(warningText);
            return;
        }

        logger.info(`[ghostface] 第2步完成: 总结长度 ${summaryContent.length} 字符`);

        logger.info('[ghostface] 第3步: 开始保存到世界书...');
        const updateResult = await saveToWorldBook(summaryContent);
        logger.info('[ghostface] 第3步完成: 已保存到世界书');

        logger.info('[ghostface] 第4步: 标记消息为已处理...');
        markMessagesSummarized(messages);
        logger.info('[ghostface] 第4步完成: 已标记消息');

        const successText = isAutoTriggered ? 
            `🤖 鬼面自动总结完成！${updateResult.created}个新条目，${updateResult.updated}个更新` : 
            "👻 鬼面把你俩都吸红了！信息已记录";
        toastr.success(successText);
        logger.info(`[ghostface] === stealthSummarize 流程成功完成 (${triggerType}) ===`);

    } catch (err) {
        logger.error(`[ghostface] === stealthSummarize 流程失败 (${triggerType}) ===`);
        logger.error('[ghostface] 错误详情:', err);
        const errorText = isAutoTriggered ? 
            "自动总结失败: " + err.message : 
            "尾随被看破: " + err.message;
        toastr.error(errorText);
        
    } finally {
        toastr.remove(notification);
        logger.info(`[ghostface] === stealthSummarize 流程结束 (${triggerType}) ===`);
    }
}

// 🔧 重写：智能更新世界书函数
async function saveToWorldBook(summaryContent) {
    logger.info('[ghostface] === 开始智能保存到世界书 ===');
    
    try {
        const worldSelect = document.querySelector('#world_editor_select');
        if (!worldSelect || !worldSelect.value) {
            throw new Error('请先在 World Info 页面选择一个世界书');
        }
        
        const worldBookName = worldSelect.selectedOptions[0].textContent;
        logger.info('[ghostface] 当前世界书:', worldBookName);
        
        const worldBookData = await loadWorldInfo(worldBookName);
        if (!worldBookData) {
            throw new Error('无法加载世界书数据');
        }
        
        logger.info('[ghostface] 世界书加载成功，当前条目数:', Object.keys(worldBookData.entries || {}).length);
        
        logger.info('[ghostface] 开始解析总结内容...');
        const summaryLines = summaryContent.split('\n').filter(line => line.trim());
        logger.info('[ghostface] 解析到', summaryLines.length, '行内容');
        
        const categorizedData = {};
        
        summaryLines.forEach((line, index) => {
            const match = line.match(/^\[(.+?)\]\s*(.+)$/);
            if (match) {
                const [, category, content] = match;
                if (!categorizedData[category]) {
                    categorizedData[category] = [];
                }
                categorizedData[category].push(content);
            }
        });

        const categoryCount = Object.keys(categorizedData).length;
        logger.info(`[ghostface] 分类完成，共${categoryCount}个类别:`, Object.keys(categorizedData));

        if (categoryCount === 0) {
            throw new Error('没有找到有效的分类数据');
        }

        // 🔧 智能更新逻辑：查找或创建条目
        let createdCount = 0;
        let updatedCount = 0;
        
        for (const [category, items] of Object.entries(categorizedData)) {
            logger.info(`[ghostface] 处理类别"${category}"，包含${items.length}个项目`);
            
            try {
                const targetComment = `我们的故事 - ${category}`;
                
                // 查找现有条目
                let existingEntry = null;
                for (const [entryId, entry] of Object.entries(worldBookData.entries || {})) {
                    if (entry.comment === targetComment) {
                        existingEntry = entry;
                        logger.info(`[ghostface] 找到现有条目"${category}"`);
                        break;
                    }
                }
                
                const newContent = items.join('\n');
                
                if (existingEntry) {
                    // 更新现有条目 - 智能合并内容
                    const existingContent = existingEntry.content || '';
                    const existingLines = existingContent.split('\n').filter(line => line.trim());
                    const newLines = items.filter(item => item.trim());
                    
                    // 去重合并
                    const allLines = [...existingLines, ...newLines];
                    const uniqueLines = [...new Set(allLines)];
                    
                    existingEntry.content = uniqueLines.join('\n');
                    updatedCount++;
                    logger.info(`[ghostface] 更新条目"${category}"，从${existingLines.length}行增加到${uniqueLines.length}行`);
                    
                } else {
                    // 创建新条目
                    const newEntry = createWorldInfoEntry(null, worldBookData);
                    
                    if (!newEntry) {
                        logger.error('[ghostface] createWorldInfoEntry 返回 null');
                        continue;
                    }
                    
                    // 使用预定义配置或默认配置
                    const predefinedConfig = PREDEFINED_CATEGORIES[category] || {
                        comment: targetComment,
                        key: [category],
                        order: 100
                    };
                    
                    Object.assign(newEntry, {
                        comment: predefinedConfig.comment,
                        content: newContent,
                        key: predefinedConfig.key,
                        constant: true,
                        selective: false, 
                        selectiveLogic: false, 
                        addMemo: false, 
                        order: predefinedConfig.order, 
                        position: 0, 
                        disable: false, 
                        excludeRecursion: false,
                        preventRecursion: false,
                        delayUntilRecursion: false,
                        probability: 100, 
                        useProbability: false 
                    });
                    
                    createdCount++;
                    logger.info(`[ghostface] 创建新条目"${category}"`);
                }
                
            } catch (entryError) {
                logger.error(`[ghostface] 处理条目"${category}"失败:`, entryError);
                continue;
            }
        }
        
        if (createdCount === 0 && updatedCount === 0) {
            throw new Error('所有条目处理均失败');
        }

        logger.info('[ghostface] 开始保存世界书...');
        await saveWorldInfo(worldBookName, worldBookData, true);
        logger.info('[ghostface] 世界书保存成功');

        // 刷新世界书界面
        if (document.querySelector('#world_editor_select')) {
            const event = new Event('change', { bubbles: true });
            document.querySelector('#world_editor_select').dispatchEvent(event);
        }

        const message = `👻 鬼面已处理 ${createdCount + updatedCount} 个类别 (新建:${createdCount}, 更新:${updatedCount})`;
        logger.info(`[ghostface] === 智能世界书保存完成 === 创建: ${createdCount}, 更新: ${updatedCount}`);
        
        return { created: createdCount, updated: updatedCount };

    } catch (error) {
        logger.error('[ghostface] === 世界书保存失败 ===');
        logger.error('[ghostface] 错误详情:', error);
        
        if (error.message.includes('请先在 World Info 页面选择')) {
            toastr.error('请先在 World Info 页面选择一个世界书');
        } else if (error.message.includes('无法加载世界书')) {
            toastr.error('无法加载世界书数据，请检查世界书是否存在');
        } else {
            toastr.error('世界书保存失败: ' + error.message);
        }
        
        throw error;
    }
}

function getActiveWorldInfo() {
    logger.info('[ghostface] 检查当前世界书状态...');
    
    if (!world_info) {
        logger.error('[ghostface] world_info 未定义或为 null');
        toastr.error(`⚠️ 世界书未加载，请先在 World Info 页面创建或加载一个世界书文件`);
        throw new Error('世界书未加载，请先创建或加载一个世界书文件');
    }
    
    const worldName = world_info.name || 
                     world_info.filename || 
                     world_info.title || 
                     world_info.worldInfoName || 
                     'DefaultWorldInfo';
    
    if (!worldName || worldName === 'DefaultWorldInfo') {
        logger.warn('[ghostface] 世界书名称为空，使用默认名称');
        world_info.name = 'GhostFace_WorldBook_' + Date.now();
        logger.info('[ghostface] 设置临时名称:', world_info.name);
    } else {
        world_info.name = worldName;
    }
    
    if (!Array.isArray(world_info.entries)) {
        logger.warn('[ghostface] world_info.entries 不是数组，正在初始化...');
        world_info.entries = [];
    }
    
    logger.info(`[ghostface] ✅ 世界书准备就绪: "${world_info.name}", 条目数: ${world_info.entries.length}`);
    return world_info;
}

function testWorldInfo() {
    try {
        logger.info('🧪 开始测试世界书...');
        const result = getActiveWorldInfo();
        logger.info('✅ 测试成功！世界书名称:', result.name);
        toastr.success('世界书测试成功: ' + result.name);
        return result;
    } catch (error) {
        logger.error('❌ 测试失败:', error);
        toastr.error('世界书测试失败: ' + error.message);
        return null;
    }
}

// 🔧 新增：消息监听器，用于自动触发
function setupMessageListener() {
    logger.info('🔧 设置消息监听器...');
    
    // 监听新消息事件
    document.addEventListener('messageAdded', () => {
        setTimeout(checkAutoTrigger, 1000); // 延迟1秒检查，确保消息已处理
    });
    
    // 监听聊天更新事件
    document.addEventListener('chatLoaded', () => {
        setTimeout(async () => {
            try {
                const context = await getContext();
                const messages = getMessageArray(context);
                lastMessageCount = messages.length;
                logger.info(`🔧 聊天加载完成，初始消息数: ${lastMessageCount}`);
            } catch (error) {
                logger.error('🔧 初始化消息计数失败:', error);
            }
        }, 1000);
    });
    
    // 备用检查机制：定期检查消息变化
    setInterval(checkAutoTrigger, 5000); // 每5秒检查一次
    
    logger.info('🔧 消息监听器设置完成');
}

// 🎨 创建鬼面UI按钮
function createGhostButton() {
    // 检查按钮是否已存在
    const existingButton = document.getElementById('ghostface-button');
    if (existingButton) {
        existingButton.remove();
    }

    const buttonHTML = `
    <div id="ghostface-button" style="
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 10000;
        cursor: pointer;
        user-select: none;
        transition: all 0.3s ease;
        transform: scale(1);
    ">
        <div id="ghostface-button-main" style="
            width: 60px;
            height: 60px;
            background: linear-gradient(135deg, #1a1a2e, #16213e, #0f3460);
            border: 2px solid #533483;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 
                0 4px 15px rgba(83, 52, 131, 0.4),
                0 0 20px rgba(83, 52, 131, 0.2),
                inset 0 1px 0 rgba(255,255,255,0.1);
            position: relative;
            overflow: hidden;
        ">
            <!-- 鬼面表情 -->
            <span style="
                font-size: 28px;
                color: #e94560;
                text-shadow: 0 0 10px rgba(233, 69, 96, 0.5);
                transition: all 0.2s ease;
            ">👻</span>
            
            <!-- 发光效果 -->
            <div style="
                position: absolute;
                top: -50%;
                left: -50%;
                width: 200%;
                height: 200%;
                background: conic-gradient(transparent, rgba(83, 52, 131, 0.1), transparent);
                animation: ghostRotate 3s linear infinite;
                pointer-events: none;
            "></div>
        </div>
        
        <!-- 自动触发状态指示器 -->
        <div id="ghostface-auto-indicator" style="
            position: absolute;
            top: -5px;
            right: -5px;
            width: 20px;
            height: 20px;
            background: ${autoTriggerEnabled ? '#4caf50' : '#f44336'};
            border: 2px solid white;
            border-radius: 50%;
            font-size: 12px;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-weight: bold;
        ">🤖</div>
        
        <!-- 工具提示 -->
        <div id="ghostface-tooltip" style="
            position: absolute;
            bottom: -55px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(0, 0, 0, 0.9);
            color: white;
            padding: 8px 12px;
            border-radius: 6px;
            font-size: 12px;
            white-space: nowrap;
            opacity: 0;
            transition: opacity 0.3s ease;
            pointer-events: none;
            border: 1px solid #533483;
            min-width: 200px;
            text-align: center;
        ">
            <div>点击：手动总结 👻</div>
            <div>右键：切换自动模式 🤖</div>
            <div style="color: #aaa; font-size: 10px; margin-top: 4px;">
                自动触发: ${autoTriggerEnabled ? '开启' : '关闭'} | 阈值: ${AUTO_TRIGGER_THRESHOLD}条消息
            </div>
            <div style="
                position: absolute;
                top: -6px;
                left: 50%;
                transform: translateX(-50%);
                width: 0;
                height: 0;
                border-left: 6px solid transparent;
                border-right: 6px solid transparent;
                border-bottom: 6px solid rgba(0, 0, 0, 0.9);
            "></div>
        </div>
    </div>
    `;

    document.body.insertAdjacentHTML('beforeend', buttonHTML);

    // 添加按钮交互事件
    const button = document.getElementById('ghostface-button');
    const mainButton = document.getElementById('ghostface-button-main');
    const tooltip = document.getElementById('ghostface-tooltip');
    const autoIndicator = document.getElementById('ghostface-auto-indicator');

    // 🎯 左键点击事件 - 执行总结功能
    button.addEventListener('click', async (e) => {
        e.preventDefault();
        try {
            // 视觉反馈
            mainButton.style.transform = 'scale(0.95)';
            setTimeout(() => {
                mainButton.style.transform = 'scale(1)';
            }, 150);

            // 执行总结
            logger.info('🎭 通过UI按钮触发手动总结...');
            await stealthSummarize();
            
        } catch (error) {
            logger.error('🚨 UI按钮触发失败:', error);
            toastr.error('鬼面按钮出错: ' + error.message);
        }
    });

    // 🎯 右键点击事件 - 切换自动触发
    button.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        autoTriggerEnabled = !autoTriggerEnabled;
        
        // 更新指示器
        autoIndicator.style.background = autoTriggerEnabled ? '#4caf50' : '#f44336';
        
        // 更新提示文字
        tooltip.innerHTML = `
            <div>点击：手动总结 👻</div>
            <div>右键：切换自动模式 🤖</div>
            <div style="color: #aaa; font-size: 10px; margin-top: 4px;">
                自动触发: ${autoTriggerEnabled ? '开启' : '关闭'} | 阈值: ${AUTO_TRIGGER_THRESHOLD}条消息
            </div>
            <div style="
                position: absolute;
                top: -6px;
                left: 50%;
                transform: translateX(-50%);
                width: 0;
                height: 0;
                border-left: 6px solid transparent;
                border-right: 6px solid transparent;
                border-bottom: 6px solid rgba(0, 0, 0, 0.9);
            "></div>
        `;
        
        // 显示状态变化提示
        const statusText = autoTriggerEnabled ? '已开启自动总结' : '已关闭自动总结';
        toastr.info(`🤖 ${statusText}`, null, {
            timeOut: 2000,
            closeButton: true
        });
        
        logger.info(`🤖 自动触发功能已${autoTriggerEnabled ? '开启' : '关闭'}`);
    });

    // 悬停效果
    button.addEventListener('mouseenter', () => {
        mainButton.style.transform = 'scale(1.1)';
        mainButton.style.boxShadow = `
            0 6px 25px rgba(83, 52, 131, 0.6),
            0 0 30px rgba(83, 52, 131, 0.4),
            inset 0 1px 0 rgba(255,255,255,0.2)
        `;
        tooltip.style.opacity = '1';
    });

    button.addEventListener('mouseleave', () => {
        mainButton.style.transform = 'scale(1)';
        mainButton.style.boxShadow = `
            0 4px 15px rgba(83, 52, 131, 0.4),
            0 0 20px rgba(83, 52, 131, 0.2),
            inset 0 1px 0 rgba(255,255,255,0.1)
        `;
        tooltip.style.opacity = '0';
    });

    logger.info('🎨 鬼面UI按钮创建完成！');
}

// 🎨 添加按钮样式动画
function addButtonStyles() {
    const style = document.createElement('style');
    style.textContent = `
        @keyframes ghostRotate {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
        }
        
        @keyframes ghostPulse {
            0%, 100% { 
                transform: scale(1);
                filter: brightness(1);
            }
            50% { 
                transform: scale(1.05);
                filter: brightness(1.2);
            }
        }
        
        #ghostface-button:active #ghostface-button-main {
            animation: ghostPulse 0.3s ease;
        }
        
        /* 响应式设计 */
        @media (max-width: 768px) {
            #ghostface-button {
                top: 10px !important;
                right: 10px !important;
            }
            #ghostface-button-main {
                width: 50px !important;
                height: 50px !important;
            }
            #ghostface-button-main span {
                font-size: 24px !important;
            }
        }
    `;
    document.head.appendChild(style);
}

// 🔧 修复5: 安全的初始化流程
function initializeGhostFace() {
    try {
        // 第1步：创建日志容器（不触发日志）
        createLogContainer();
        
        // 第2步：添加样式
        addLogStyles();
        
        // 🎨 第3步：创建UI按钮
        createGhostButton();
        addButtonStyles();
        
        // 🔧 第4步：设置消息监听器
        setupMessageListener();
        
        // 第5步：等待DOM完全加载后再记录日志
        setTimeout(() => {
            if (logSystemInitialized) {
                logger.info('🎭 鬼面插件初始化完成！');
                logger.info('📝 左键点击：手动总结 | 右键点击：切换自动模式');
                logger.info(`🤖 自动触发: ${autoTriggerEnabled ? '开启' : '关闭'} (${AUTO_TRIGGER_THRESHOLD}条消息阈值)`);
                logger.info('🎨 UI按钮位置：右上角悬浮');
                
                // 初始化消息计数
                setTimeout(async () => {
                    try {
                        const context = await getContext();
                        const messages = getMessageArray(context);
                        lastMessageCount = messages.length;
                        logger.info(`📊 当前消息数: ${lastMessageCount}`);
                    } catch (error) {
                        logger.warn('📊 无法获取初始消息数:', error);
                    }
                }, 2000);
            }
        }, 100);
        
    } catch (error) {
        console.error('[鬼面] 初始化失败:', error);
    }
}

// 添加slash命令
registerSlashCommand(
    'gf_sum',
    async () => {
        await stealthSummarize();
    },
    [],
    '对鬼面发起决斗邀请（手动总结）',
    true,
    true
);

// 添加自动触发开关命令
registerSlashCommand(
    'gf_auto',
    () => {
        autoTriggerEnabled = !autoTriggerEnabled;
        const statusText = autoTriggerEnabled ? '已开启' : '已关闭';
        toastr.info(`🤖 自动总结功能${statusText}`);
        logger.info(`🤖 自动触发功能已${autoTriggerEnabled ? '开启' : '关闭'}`);
        
        // 更新按钮指示器
        const indicator = document.getElementById('ghostface-auto-indicator');
        if (indicator) {
            indicator.style.background = autoTriggerEnabled ? '#4caf50' : '#f44336';
        }
        
        return `自动总结功能${statusText}`;
    },
    [],
    '切换鬼面自动总结功能',
    true,
    true
);

// 🎯 关键修复：延迟初始化，避免递归
setTimeout(initializeGhostFace, 50);
