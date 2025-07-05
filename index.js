// TheGhostFace - v2.1
// 070425 0920
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
/* import { executeSlashCommands, registerSlashCommand } from '../../../slash-commands.js'; */
import { getRegexScripts } from '../../../../scripts/extensions/regex/index.js';
import { runRegexScript } from '../../../../scripts/extensions/regex/engine.js';

export { MODULE_NAME };

// 数据储存定位
const MODULE_NAME = 'the_ghost_face';
const MODULE_NAME_FANCY = '鬼面';
const PROGRESS_BAR_ID = `${MODULE_NAME}_progress_bar`;

// 主题配置
const THEME_CONFIGS = {
    classic: { name: '经典紫魔' },
    ocean: { name: '深海蓝调' },
    sunset: { name: '夕阳暖橙' },
    forest: { name: '森林绿意' },
    rose: { name: '玫瑰粉梦' }
};

// 当前主题
let currentTheme = 'classic';

function get_extension_directory() {
    // get the directory of the extension
    let index_path = new URL(import.meta.url).pathname
    return index_path.substring(0, index_path.lastIndexOf('/'))  // remove the /index.js from the path
}
let userThreshold = 40;
let userInterval = 10;
let intervalId = null;

let keepMessagesCount = 2;

// 加载函数
async function loadGhostStyles() {
    const module_dir = get_extension_directory();
    
    // 避免重复加载
    if (document.querySelector('#ghost-face-styles')) {
        return true;
    }

    const link = document.createElement('link');
    link.id = 'ghost-face-styles';
    link.rel = 'stylesheet';
    link.href = `${module_dir}/ghostpanel.css`;
    
    return new Promise((resolve) => {
        link.onload = () => resolve(true);
        link.onerror = () => {
            addFallbackStyles();
            resolve(false); // 返回加载失败状态
        };
        document.head.appendChild(link);
    });
}

// 🎨 应用主题到HTML根元素
function applyThemeToDocument(themeName) {
    if (!THEME_CONFIGS[themeName]) return;
    document.documentElement.setAttribute('data-ghost-theme', themeName);
    const panel = document.getElementById('the_ghost_face_control_panel');
    if (panel) panel.setAttribute('data-ghost-theme', themeName);
}

// 🎨 更新主题
function updatePanelTheme(themeName) {
    if (!THEME_CONFIGS[themeName]) return;
    currentTheme = themeName;
    applyThemeToDocument(themeName);
    const themeSelect = document.getElementById(`${PANEL_ID}_theme_select`);
    if (themeSelect) {
        themeSelect.value = themeName;
    }
    // 更新状态指示器（如果需要动态颜色）
    updateAutoStatus();
}

// 添加到扩展菜单
function addGhostMenuItem() {
    const extensionsMenu = document.querySelector('#extensionsMenu');
    if (!extensionsMenu) {
        setTimeout(addGhostMenuItem, 2000);
        return false;
    }
    
    // 检查是否已存在
    let existingItem = document.querySelector('#ghost_face_menu_item');
    if (existingItem) {
        existingItem.remove();
    }
    
    // 创建菜单项容器
    const menuItemContainer = document.createElement('div');
    menuItemContainer.className = 'extension_container interactable';
    menuItemContainer.id = 'ghost_face_menu_container';
    menuItemContainer.tabIndex = 0;
    
    // 创建菜单项
    const menuItem = document.createElement('div');
    menuItem.className = 'list-group-item flex-container flexGap5 interactable';
    menuItem.id = 'ghost_face_menu_item';
    menuItem.title = '打开鬼面控制台';
    menuItem.innerHTML = `
        <div class="fa-fw extensionsMenuExtensionButton">👻</div>
        <span>对鬼面发出决斗邀请</span>
    `;
    
    // 添加点击事件
    menuItem.addEventListener('click', async (event) => {
        event.stopPropagation();

        // 关闭扩展菜单
        const extensionsMenuButton = document.querySelector('#extensionsMenuButton');
        if (extensionsMenuButton && extensionsMenu.style.display !== 'none') {
            extensionsMenuButton.click();
            await new Promise(resolve => setTimeout(resolve, 150));
        }
        
        // 打开控制面板
        openPanel();
    });
    
    menuItemContainer.appendChild(menuItem);
    extensionsMenu.appendChild(menuItemContainer);
    
    logger.info('👻 鬼面菜单项已添加到扩展菜单');
    return true;
}

// 控制面板创建函数
async function createGhostControlPanel() {
    const existingPanel = document.getElementById(PANEL_ID);
    if (existingPanel) {
        existingPanel.remove();
    }

    try {
        // 首先加载CSS
        await loadGhostStyles();
        
        // 然后加载HTML
        const module_dir = get_extension_directory();
        const response = await fetch(`${module_dir}/ghostpanel.html`);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const html = await response.text();
        
        if (!html.trim()) {
            throw new Error('HTML文件为空');
        }
        
        document.body.insertAdjacentHTML('beforeend', html);
        applyThemeToDocument(currentTheme);
        
        // 设置事件和更新数据
        setupPanelEvents();
        updatePanelWithCurrentData();
        updateMessageCount();
        
        logger.info("👻 Ghost panel loaded successfully!");
        
    } catch (error) {
        logger.error("❌ Failed to load ghost panel:", error);
    }
       // 确保面板已添加到 DOM 后
    setTimeout(() => {
        const themeSelect = document.getElementById('the_ghost_face_control_panel_theme_select');
        if (themeSelect) {
            themeSelect.value = currentTheme;
        }
    }, 0);

    setTimeout(() => {
    loadUserSettings(); // 加载保存的设置
}, 100);
}


// 更新自动状态 
function updateAutoStatus() {
    const statusDot = document.getElementById(`${PANEL_ID}_status`);
    const statusText = document.getElementById(`${PANEL_ID}_status_text`);
    const toggleButton = document.getElementById(`${PANEL_ID}_toggle_auto`);
    
    // 通过CSS类控制样式
    if (statusDot) {
        statusDot.className = autoTriggerEnabled ? 'status-enabled' : 'status-disabled';
    }
    
    if (toggleButton) {
        if (autoTriggerEnabled) {
            toggleButton.classList.remove('auto-disabled');
        } else {
            toggleButton.classList.add('auto-disabled');
        }
        // 如果使用CSS content，就不需要设置textContent
        // toggleButton.textContent = ''; // CSS会自动处理
    }
    
    // 只有动态文字内容需要在JS中设置
    if (statusText) {
        statusText.textContent = autoTriggerEnabled ? '自动尾随中' : '手动模式';
        statusText.className = autoTriggerEnabled ? 'status-enabled' : 'status-disabled';
    }
}

// 切换主题
function changeTheme(themeName) {
    if (!THEME_CONFIGS[themeName]) return;
    currentTheme = themeName;
     extension_settings.the_ghost_face = extension_settings.the_ghost_face || {};
    extension_settings.the_ghost_face.theme = themeName;
    saveSettingsDebounced(); 
    document.documentElement.setAttribute('data-ghost-theme', themeName);
    document.getElementById('the_ghost_face_control_panel')?.setAttribute('data-ghost-theme', themeName);
     const themeSelect = document.getElementById('the_ghost_face_control_panel_theme_select');
    if (themeSelect) themeSelect.value = themeName;
    }


// 加载用户设置
function loadUserSettings() {
    const settings = extension_settings.the_ghost_face || {};
    userThreshold = settings.threshold || 40;
    userInterval = settings.interval || 30;
    keepMessagesCount = settings.keepMessages || 2;
    autoTriggerEnabled = settings.autoEnabled !== undefined ? settings.autoEnabled : false; 

    const autoBtn = document.getElementById(`${PANEL_ID}_toggle_auto`);
    if (autoBtn) {
        autoBtn.dataset.autoEnabled = autoTriggerEnabled;
        autoBtn.textContent = `🐕 自动${autoTriggerEnabled ? '开启' : '关闭'}`;
    }
    // 更新输入框显示
    const thresholdInput = document.getElementById(`${PANEL_ID}_threshold_input`);
    const intervalInput = document.getElementById(`${PANEL_ID}_interval_input`);
    const keepMessagesInput = document.getElementById(`${PANEL_ID}_keep_messages_input`);
    const autoHideCheckbox = document.getElementById(`${PANEL_ID}_auto_hide`);
    
    if (thresholdInput) thresholdInput.value = userThreshold;
    if (intervalInput) intervalInput.value = userInterval;
    if (keepMessagesInput) keepMessagesInput.value = keepMessagesCount;
    if (autoHideCheckbox) autoHideCheckbox.checked = settings.autoHide !== undefined ? settings.autoHide : true;
    
    // 更新显示
    updateThresholdDisplay();
    updateAutoStatus();

    currentTheme = settings.theme || 'classic';
    updatePanelTheme(currentTheme); // 确保主题被应用
}

function getAutoHideStatus() {
    const checkbox = document.getElementById(`${PANEL_ID}_auto_hide`);
    return checkbox ? checkbox.checked : true;
}

// 保存用户设置
function saveUserSettings() {
    extension_settings.the_ghost_face = extension_settings.the_ghost_face || {};
    extension_settings.the_ghost_face.threshold = userThreshold;
    extension_settings.the_ghost_face.interval = userInterval;
    extension_settings.the_ghost_face.keepMessages = keepMessagesCount;
    extension_settings.the_ghost_face.autoEnabled = autoTriggerEnabled; 
    extension_settings.the_ghost_face.autoHide = getAutoHideStatus(); 
    saveSettingsDebounced();
    
    // 保存自动隐藏设置
    const autoHideCheckbox = document.getElementById(`${PANEL_ID}_auto_hide`);
    if (autoHideCheckbox) {
        extension_settings.the_ghost_face.autoHide = autoHideCheckbox.checked;
    }
    
    saveSettingsDebounced();
    
    logger.info(`💾 设置已保存: 阈值=${userThreshold}, 间隔=${userInterval}分钟, 保留=${keepMessagesCount}条, 自动=${autoTriggerEnabled}`);
}

// 🔧 预定义的固定类别
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

// 自动触发相关变量
let lastMessageCount = 0;
let autoTriggerEnabled = true;
const AUTO_TRIGGER_THRESHOLD = 40;
let isAutoSummarizing = false;

// UI控制变量
let isPanelOpen = false;
const PANEL_ID = `${MODULE_NAME}_control_panel`;
const MAX_LOG_ENTRIES = 100;

// 初始化标志
let systemInitialized = false;
let panelReady = false; 
let pendingLogs = [];

// 检查面板是否准备就绪
function isPanelReady() {
    return document.getElementById(`${PANEL_ID}_log_content`) !== null;
}


// 日志级别
const LOG_LEVEL = {
    DEBUG: 'debug',
    INFO: 'info',
    WARN: 'warn',
    ERROR: 'error'
};

// 日志记录函数
function logToUI(level, message, details = null) {
     if (!systemInitialized) {
        console.log(`[鬼面][初始化期间] ${level}: ${message}`, details);
        return;
    }

    const content = document.getElementById(`${PANEL_ID}_log_content`);
    if (!content) {
        console.log(`[鬼面][容器不存在] ${level}: ${message}`, details);
        return;
    }

    // 限制日志条目数量 - 但保留更多
    const logs = content.querySelectorAll('.log-entry');
    if (logs.length >= MAX_LOG_ENTRIES) {
        // 删除最旧的10条，而不是1条
        for (let i = 0; i < 10 && logs[i]; i++) {
            content.removeChild(logs[i]);
        }
    }
    const now = new Date();
    const timeStr = now.toLocaleTimeString();

    let levelColor = '';
    let levelText = '';
    switch (level) {
        case LOG_LEVEL.DEBUG:
            levelColor = THEME_CONFIGS[currentTheme].accent;
            levelText = 'DEBUG';
            console.debug(`[鬼面][${timeStr}] ${message}`, details);
            break;
        case LOG_LEVEL.INFO:
            levelColor = THEME_CONFIGS[currentTheme].secondary;
            levelText = 'INFO';
            console.info(`[鬼面][${timeStr}] ${message}`, details);
            break;
        case LOG_LEVEL.WARN:
            levelColor = '#ff9800';
            levelText = 'WARN';
            console.warn(`[鬼面][${timeStr}] ${message}`, details);
            break;
        case LOG_LEVEL.ERROR:
            levelColor = '#f44336';
            levelText = 'ERROR';
            console.error(`[鬼面][${timeStr}] ${message}`, details);
            break;
        default:
            levelColor = '#ffffff';
            levelText = 'INFO';
            console.info(`[鬼面][${timeStr}] ${message}`, details);
    }

    const logEntry = document.createElement('div');
    logEntry.className = 'log-entry';
    logEntry.style.cssText = `
        padding: 4px 0;
        border-bottom: 1px solid rgba(255,255,255,0.1);
        word-break: break-word;
        border-left: 3px solid ${levelColor};
        padding-left: 8px;
        margin-bottom: 2px;
    `;

    logEntry.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center;">
            <span style="color: #aaa; font-size: 12px;">[${timeStr}]</span>
            <strong style="color: ${levelColor}; font-size: 12px;">${levelText}</strong>
        </div>
        <div style="font-size: 13px; line-height: 1.3;">${escapeHtml(message)}</div>
        ${details ? `<pre style="color: #999; margin: 4px 0 0 0; font-size: 12px; white-space: pre-wrap;">${escapeHtml(JSON.stringify(details, null, 2))}</pre>` : ''}
    `;

    content.appendChild(logEntry);
    content.scrollTop = content.scrollHeight;
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

// 🔧 安全的日志快捷方法
const logger = {
    debug: (msg, details) => logToUI(LOG_LEVEL.DEBUG, msg, details),
    info: (msg, details) => logToUI(LOG_LEVEL.INFO, msg, details),
    warn: (msg, details) => logToUI(LOG_LEVEL.WARN, msg, details),
    error: (msg, details) => logToUI(LOG_LEVEL.ERROR, msg, details)
};

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

// 🔧 自动触发检测函数
async function checkAutoTrigger() {
    if (!autoTriggerEnabled || isAutoSummarizing) {
        return;
    }

    try {
        const context = await getContext();
        const messages = getMessageArray(context);
        const currentCount = messages.length;

        const newMessageCount = currentCount - lastMessageCount;
        
        if (lastMessageCount > 0 && newMessageCount >= AUTO_TRIGGER_THRESHOLD) {
            logger.info(`🤖 检测到 ${newMessageCount} 条新消息，达到自动触发阈值 ${AUTO_TRIGGER_THRESHOLD}`);
            toastr.info(`👻 鬼面检测到 ${newMessageCount} 条新消息，准备自动总结...`, null, {
                timeOut: 3000,
                closeButton: true,
                progressBar: true
            });
            
            isAutoSummarizing = true;
            
            setTimeout(async () => {
                try {
                    logger.info('🤖 开始执行自动总结...');
                    await stealthSummarize(false, true);
                } catch (error) {
                    logger.error('🤖 自动总结失败:', error);
                } finally {
                    isAutoSummarizing = false;
                }
            }, 1000);
        }

        lastMessageCount = currentCount;

    } catch (error) {
        logger.error('🤖 自动触发检测失败:', error);
    }
}

// 消息监听器设置
function setupMessageListener() {
    logger.info('🔧 设置消息监听器...');
    
    document.addEventListener('messageAdded', () => {
        setTimeout(checkAutoTrigger, 1000);
    });
    
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
    
    setInterval(checkAutoTrigger, 30000);
    
    logger.info('🔧 消息监听器设置完成');
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
                
                logger.debug(`[ghostface] 消息${index + 1}: ${speaker} (${content.length}字)`);
                return `${speaker}: ${content}`;
            })
            .join('\n');

        logger.info(`[ghostface] 步骤3: 上下文构建完成，总长度: ${contextText.length} 字符`);

        const optimized_prompt = `你是一个专业且充满热心的故事总结助手，你很喜欢八卦这对甜蜜的小情侣，请从最近的对话中提取可复用剧情细节，确保未来{{char}}可以使用这些"记忆"随时给{{user}}小惊喜，让{{user}}能感觉到发生过的事情都真的被记住了：

请按照以下6个固定类别进行分类：
1. 喜好 - 明确的喜欢、偏好、爱好
2. 恐惧 - 害怕、讨厌、不喜欢的事物
3. 事件 - 发生的重要事情、经历
4. 关系 - 人际关系、朋友家人
5. 梦境 - 梦见的内容、幻想、想象
6. 互动 - {{char}}与{{user}}的独特互动方式

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
        
        const context = await getContext();
        
        if (!context) {
            throw new Error('getContext() 返回 null/undefined');
        }
        
        if (typeof context.generateQuietPrompt !== 'function') {
            throw new Error('context.generateQuietPrompt 不是函数');
        }

        logger.info('[ghostface] 步骤5: 开始调用 generateQuietPrompt...');

        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('AI生成超时 (30秒)')), 30000);
        });

        const generatePromise = context.generateQuietPrompt(
            optimized_prompt,
            true,
            false,
            "你是一个专业的故事总结助手"
        );

        logger.info('[ghostface] 步骤6: 等待AI响应...');
        const result = await Promise.race([generatePromise, timeoutPromise]);
        
        logger.info('[ghostface] 步骤7: AI生成完成！');
        logger.info('[ghostface] 原始结果类型:', typeof result);
        logger.info('[ghostface] 原始结果长度:', result ? result.length : 'null');
        
        if (!result) {
            throw new Error('AI返回空结果');
        }

        logger.info('[ghostface] 步骤8: 开始解析模型输出...');
        const parsedResult = parseModelOutput(result);
        logger.info('[ghostface] 步骤9: 解析完成，最终结果长度:', parsedResult.length);
        logger.info('[ghostface] === generateSummary 成功完成 ===');
        
        return parsedResult;

    } catch (error) {
        logger.error('[ghostface] === generateSummary 发生错误 ===');
        logger.error('[ghostface] 错误类型:', error.constructor.name);
        logger.error('[ghostface] 错误消息:', error.message);
        throw error;
    }
}

// 生成消息唯一标识
function generateMessageId(msg, index) {
    const content = msg.mes || msg.text || msg.content || '';
    const timestamp = msg.send_date || msg.timestamp || Date.now();
    return `${index}_${getStringHash(content)}_${timestamp}`;
}

// 查找消息元素
function findMessageElement(msg, index) {
    const messageElements = document.querySelectorAll('.mes');
    
    // 方法1：通过索引查找
    if (messageElements[index]) {
        return messageElements[index];
    }
    
    // 方法2：通过消息内容匹配
    const content = msg.mes || msg.text || msg.content || '';
    for (let element of messageElements) {
        const elementText = element.querySelector('.mes_text')?.textContent || '';
        if (elementText.includes(content.substring(0, 50))) {
            return element;
        }
    }
    
    return null;
}


// 隐藏函数
/*
function hideProcessedMessages(messages, keepLastN = 2) {
    if (!getAutoHideStatus() || !Array.isArray(messages) || messages.length <= keepLastN) {
        logger.info(`👻 跳过隐藏: 设置关闭或消息数量不足`);
        return;
    }
    
    const messagesToHide = messages.slice(0, -keepLastN);
    logger.info(`🎭 开始隐藏 ${messagesToHide.length} 条已总结的消息...`);

    let changesMade = false;

    messagesToHide.forEach((msg, index) => {
        // 保存原始状态（如果还没保存过）
        if (msg.extra?.ghost_original_is_system === undefined) {
            msg.extra = msg.extra || {};
            msg.extra.ghost_original_is_system = msg.is_system || false;
        }
        
        // 设置为系统消息来隐藏
        if (!msg.is_system) {
            msg.is_system = true;
            changesMade = true;
        }
        
        // 标记消息
        msg.extra.ghost_hidden = true;
        msg.extra.isHidden = true;
        
        // 更新 DOM 元素的属性
        const messageElement = findMessageElement(msg, index);
        if (messageElement) {
            if (typeof jQuery !== 'undefined' && jQuery(messageElement).length) {
                jQuery(messageElement).attr('is_system', 'true');
            } else {
                messageElement.setAttribute('is_system', 'true');
            }
        }
    });

    if (changesMade) {
        // 触发 ST 的界面更新
        if (window.SillyTavern_API?.ui?.updateChatScroll) {
            window.SillyTavern_API.ui.updateChatScroll();
        }
        
        // 触发消息更新事件
        const event = new Event('chatUpdated');
        document.dispatchEvent(event);
        
        logger.info(`🎭 已隐藏 ${messagesToHide.length} 条消息`);
    }
    
    // 保存聊天数据
    saveAndRefreshChat();
}
// 恢复隐藏的消息（在聊天加载时调用）
function restoreHiddenMessages() {
    document.addEventListener('chatLoaded', () => {
        setTimeout(async () => {
            try {
                const context = await getContext();
                const messages = getMessageArray(context);
                
                let changesMade = false;
                
                messages.forEach((msg, index) => {
                    if (msg.extra?.ghost_hidden) {
                        // 恢复原始的 is_system 状态
                        const originalIsSystem = msg.extra.ghost_original_is_system || false;
                        if (msg.is_system !== originalIsSystem) {
                            msg.is_system = originalIsSystem;
                            changesMade = true;
                        }
                        
                        // 更新 DOM
                        const messageElement = findMessageElement(msg, index);
                        if (messageElement) {
                            if (typeof jQuery !== 'undefined' && jQuery(messageElement).length) {
                                jQuery(messageElement).attr('is_system', originalIsSystem.toString());
                            } else {
                                messageElement.setAttribute('is_system', originalIsSystem.toString());
                            }
                        }
                    }
                });
                
                if (changesMade && window.SillyTavern_API?.ui?.updateChatScroll) {
                    window.SillyTavern_API.ui.updateChatScroll();
                }
                
            } catch (error) {
                logger.error('恢复隐藏消息失败:', error);
            }
        }, 1000);
    });
}

async function saveAndRefreshChat() {
    try {
        if (typeof saveChat === 'function') {
            await saveChat();
            logger.info('💾 聊天已保存');
        }
    } catch (error) {
        logger.error('💾 保存聊天失败:', error);
    }
}
*/

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

// 给消息打标记
function markMessagesSummarized(messages) {
    if (!Array.isArray(messages)) {
        logger.warn('[ghostface] markMessagesSummarized: 输入不是数组');
        return;
    }
    
    messages.forEach((msg, index) => {
        msg.extra = msg.extra || {};
        msg.extra.ghost_summarized = true;
        msg.extra.summary_timestamp = Date.now(); // 添加时间戳
        msg.extra.summary_index = index; // 添加索引用于恢复
    });
    
    logger.info(`[ghostface] 已标记 ${messages.length} 条消息为已总结`);
}

// 主要总结函数
async function stealthSummarize(isInitial = false, isAutoTriggered = false) {
    const triggerType = isAutoTriggered ? '自动触发' : '手动触发';
    logger.info(`[ghostface] === 开始 stealthSummarize 流程 (${triggerType}) ===`);
    
    const notificationText = isAutoTriggered ? 
        "🤖 鬼面自动尾随中..." : 
        "👻 鬼面尾随中...";
    
    const notification = toastr.info(notificationText, null, {
        timeOut: 5000,
        closeButton: true,
        progressBar: true,
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
        logger.info('[ghostface] 第4步完成: 已保存到世界书');

        markMessagesSummarized(messages);
        logger.info('[ghostface] 第5步完成: 已标记消息');

        /*if (getAutoHideStatus()) {
            hideProcessedMessages(messages, keepMessagesCount);
            logger.info('[ghostface] 第5步完成: 已隐藏消息');
        }*/

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

// 重置鬼面消息标记函数
async function resetAllMessageFlags() {
    const resetBtn = document.getElementById(`${PANEL_ID}_reset_flags`);
    if (!resetBtn) return;

    // 第一次点击：确认状态
    if (!resetBtn.classList.contains('confirming')) {
        resetBtn.classList.add('confirming');
        resetBtn.textContent = '⚠️ 确认重置？';
        
        logger.info('🔄 重置功能：请再次点击确认');
        toastr.warning('再次点击确认重置所有鬼面标记', null, {
            timeOut: 3000,
            closeButton: true
        });
        
        setTimeout(() => {
            if (resetBtn.classList.contains('confirming')) {
                resetBtn.classList.remove('confirming');
                resetBtn.textContent = '🔄 重置鬼面标记';
            }
        }, 3000);
        
        return;
    }
      /*

     try {
        resetBtn.textContent = '🔄 重置中...';
        resetBtn.disabled = true;

        const context = await getContext();
        const messages = getMessageArray(context);
        
        let resetCount = 0;
        let hiddenCount = 0;
        let changesMade = false;
        
        messages.forEach((msg, index) => {
            // 重置总结标记
            if (msg.extra?.ghost_summarized) {
                delete msg.extra.ghost_summarized;
                delete msg.extra.summary_timestamp;
                delete msg.extra.summary_index;
                resetCount++;
            }
            
            // 恢复隐藏的消息
            if (msg.extra?.ghost_hidden || msg.extra?.isHidden) {
                // 恢复原始的 is_system 状态
                const originalIsSystem = msg.extra.ghost_original_is_system || false;
                if (msg.is_system !== originalIsSystem) {
                    msg.is_system = originalIsSystem;
                    changesMade = true;
                }
                
                // 清理所有隐藏相关的标记
                delete msg.extra.ghost_hidden;
                delete msg.extra.isHidden;
                delete msg.extra.ghost_original_is_system;
                hiddenCount++;
                
                // 更新 DOM
                const messageElement = findMessageElement(msg, index);
                if (messageElement) {
                    if (typeof jQuery !== 'undefined' && jQuery(messageElement).length) {
                        jQuery(messageElement).attr('is_system', originalIsSystem.toString());
                    } else {
                        messageElement.setAttribute('is_system', originalIsSystem.toString());
                    }
                }
            }
        });
        
        
        // 重置消息计数
      
        lastMessageCount = 0;
        
        // 触发界面更新
        if (changesMade && window.SillyTavern_API?.ui?.updateChatScroll) {
            window.SillyTavern_API.ui.updateChatScroll();
        }
        
        const event = new Event('chatUpdated');
        document.dispatchEvent(event);
        
        // 更新消息计数显示
        updateMessageCount();
        
        logger.info(`🔄 重置完成: ${resetCount} 条鬼面标记, ${hiddenCount} 条隐藏状态`);
        toastr.success(`🔄 重置完成！\n清除 ${resetCount} 个鬼面标记\n恢复 ${hiddenCount} 条隐藏消息`, null, {
            timeOut: 4000,
            closeButton: true
        });
        
    } catch (error) {
        logger.error('🔄 重置失败:', error);
        toastr.error('重置失败: ' + error.message);
    } finally {
        // 恢复按钮状态
        resetBtn.classList.remove('confirming');
        resetBtn.textContent = '🔄 重置鬼面标记';
        resetBtn.disabled = false;
    }*/
}

// 智能更新世界书函数
async function saveToWorldBook(summaryContent) {
    logger.info('[ghostface] === 开始智能保存到世界书 ===');
    
    try {
        const worldSelect = document.querySelector('#world_editor_select');
        const worldBookName = worldSelect.selectedOptions[0].textContent;
        logger.info('[ghostface] 当前世界书:', worldBookName);
        if (!worldSelect || !worldSelect.value) {
            throw new Error('请先在 World Info 页面选择一个世界书');
        }
        
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

        let createdCount = 0;
        let updatedCount = 0;
        
        for (const [category, items] of Object.entries(categorizedData)) {
            logger.info(`[ghostface] 处理类别"${category}"，包含${items.length}个项目`);
            
            try {
                const targetComment = `我们的故事 - ${category}`;
                
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
                    const existingContent = existingEntry.content || '';
                    const existingLines = existingContent.split('\n').filter(line => line.trim());
                    const newLines = items.filter(item => item.trim());
                    
                    const allLines = [...existingLines, ...newLines];
                    const uniqueLines = [...new Set(allLines)];
                    
                    existingEntry.content = uniqueLines.join('\n');
                    updatedCount++;
                    logger.info(`[ghostface] 更新条目"${category}"，从${existingLines.length}行增加到${uniqueLines.length}行`);
                    
                } else {
                    const newEntry = createWorldInfoEntry(null, worldBookData);
                    
                    if (!newEntry) {
                        logger.error('[ghostface] createWorldInfoEntry 返回 null');
                        continue;
                    }
                    
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
        logger.info(`📚 总结已保存到世界书: "${worldBookName}"`);
        logger.info(`📊 本次操作: 新建${createdCount}个条目, 更新${updatedCount}个条目`);
        if (createdCount > 0) {
            const newCategories = Object.keys(categorizedData).slice(0, 3).join(', ');
            logger.info(`🆕 新增类别: ${newCategories}${Object.keys(categorizedData).length > 3 ? '等' : ''}`);
        }

        if (document.querySelector('#world_editor_select')) {
            const event = new Event('change', { bubbles: true });
            document.querySelector('#world_editor_select').dispatchEvent(event);
        }
        return { created: createdCount, updated: updatedCount };

    } catch (error) {
        logger.error(`❌ 世界书保存失败 - 目标: ${worldSelect?.selectedOptions[0]?.textContent || '未知'}`);
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

// 更新面板的动态数据
function updatePanelWithCurrentData() {
    // 更新主题
     const themeSelect = document.getElementById(`${PANEL_ID}_theme_select`);
    if (themeSelect) {
        themeSelect.value = currentTheme;
    }
    // 应用当前主题
    applyThemeToDocument(currentTheme);

    // 更新状态
    updateAutoStatus();
}
// 更新阈值
function updateThresholdDisplay() {
    const thresholdDisplay = document.getElementById(`${PANEL_ID}_threshold_display`);
    if (thresholdDisplay) {
        thresholdDisplay.textContent = userThreshold;
    }
}

function toggleSettingsMenu() {
    const settingsArea = document.getElementById(`${PANEL_ID}_settings_area`);
    const settingsBtn = document.getElementById(`${PANEL_ID}_settings_toggle`);
    
    if (!settingsArea || !settingsBtn) return;
    
    // 直接切换类名
    const isExpanded = settingsBtn.classList.contains('active');
    
    if (isExpanded) {
        settingsArea.style.display = 'none';
        settingsBtn.classList.remove('active');
        settingsBtn.innerHTML = '⚙️ 设置菜单';
    } else {
        settingsArea.style.display = 'block';
        settingsBtn.classList.add('active');
        settingsBtn.innerHTML = '⚙️ 收起设置';
    }
}

// 设置面板事件
function setupPanelEvents() {
    const content = document.getElementById(`${PANEL_ID}_content`);
    const manualBtn = document.getElementById(`${PANEL_ID}_manual_summary`);
    const autoBtn = document.getElementById(`${PANEL_ID}_toggle_auto`);
    const themeSelect = document.getElementById(`${PANEL_ID}_theme_select`);
    const clearLogBtn = document.getElementById(`${PANEL_ID}_clear_log`);
    // 设置菜单切换按钮
  const settingsBtn = document.getElementById(`${PANEL_ID}_settings_toggle`);
  if (settingsBtn) {
    settingsBtn.addEventListener('click', toggleSettingsMenu);
    // 移动端触摸支持
    settingsBtn.addEventListener('touchend', (e) => {
        e.preventDefault();
        toggleSettingsMenu();
    });

    // 自动隐藏选项变化时保存
    /*
    const autoHideCheckbox = document.getElementById(`${PANEL_ID}_auto_hide`);
    autoHideCheckbox?.addEventListener('change', () => {
        saveUserSettings();
        logger.info(`🍄 自动隐藏设置已更新为: ${autoHideCheckbox.checked}`);
    });*/

    // 阈值输入框
    const thresholdInput = document.getElementById(`${PANEL_ID}_threshold_input`);
    thresholdInput?.addEventListener('change', (e) => {
    userThreshold = parseInt(e.target.value) || 40;
    saveUserSettings();
    updateThresholdDisplay(); 
    logger.info(`🎯 阈值已更新为: ${userThreshold}`);
    });

     // 间隔输入框
    const intervalInput = document.getElementById(`${PANEL_ID}_interval_input`);
    intervalInput?.addEventListener('change', (e) => {
        userInterval = parseInt(e.target.value) || 30;
        saveUserSettings();
        restartInterval();
        logger.info(`💢 检测间隔已更新为: ${userInterval}分钟`);
    });

    // 重置按钮
    const resetBtn = document.getElementById(`${PANEL_ID}_reset_flags`);
    resetBtn?.addEventListener('click', resetAllMessageFlags);

    // 保留消息数输入框
    const keepMessagesInput = document.getElementById(`${PANEL_ID}_keep_messages_input`);
    keepMessagesInput?.addEventListener('change', (e) => {
        keepMessagesCount = parseInt(e.target.value) || 2;
        if (keepMessagesCount < 1) keepMessagesCount = 1;
        if (keepMessagesCount > 10) keepMessagesCount = 10;
        e.target.value = keepMessagesCount; // 确保显示有效值
        saveUserSettings();
        logger.info(`🗨️ 保留消息数已更新为: ${keepMessagesCount}`);
    });

   let clickCount = 0;
   let clickTimer = null;


    // 手动总结
    manualBtn?.addEventListener('click', async () => {
        try {
            logger.info('🎯 通过控制面板触发手动总结...');
            await stealthSummarize();
        } catch (error) {
            logger.error('🚨 控制面板手动总结失败:', error);
            toastr.error('手动总结失败: ' + error.message);
        }
    });

    // 切换自动模式
    autoBtn?.addEventListener('click', () => {
        toggleAutoMode();
    });

    // 主题切换
    themeSelect?.addEventListener('change', (e) => {
        changeTheme(e.target.value);
    });

    // 清空日志
    clearLogBtn?.addEventListener('click', () => {
        const logContent = document.getElementById(`${PANEL_ID}_log_content`);
        if (logContent) {
            logContent.innerHTML = '';
            logger.info('📋 日志已清空');
        }
    });

    // 点击外部关闭面板
    document.addEventListener('click', (e) => {
        const panel = document.getElementById(PANEL_ID);
        if (panel && !panel.contains(e.target) && isPanelOpen) {
            closePanel();
        }
    });
}
}

// 重启定时器
function restartInterval() {
    if (intervalId) clearInterval(intervalId);
    intervalId = setInterval(checkAutoTrigger, userInterval * 60 * 1000); 
}

// 切换面板显示
function togglePanel() {
    const content = document.getElementById(`${PANEL_ID}_content`);
    if (!content) return;

    if (isPanelOpen) {
        closePanel();
    } else {
        openPanel();
    }
}

function openPanel() {
     const content = document.getElementById(`${PANEL_ID}_content`);
    if (!content) return;

    content.classList.add('ghost-panel-show');
    content.style.visibility = 'visible';
    content.style.opacity = '1';
    isPanelOpen = true;
    
    // 更新消息计数
    updateMessageCount();
    
    // 确保日志区域可以正常滚动
    const logContent = document.getElementById(`${PANEL_ID}_log_content`);
    if (logContent) {
        logContent.scrollTop = logContent.scrollHeight;
    }
}

function closePanel() {
     const content = document.getElementById(`${PANEL_ID}_content`);
    if (!content) return;

    content.classList.remove('ghost-panel-show');
    content.style.opacity = '0';
    setTimeout(() => {
        content.style.visibility = 'hidden';
    }, 300);
    isPanelOpen = false;
}

// 切换自动模式
function toggleAutoMode() {
    autoTriggerEnabled = !autoTriggerEnabled;
     saveUserSettings();
    // 更新按钮状态
    const autoBtn = document.getElementById('the_ghost_face_control_panel_toggle_auto');
    if (autoBtn) {
        autoBtn.dataset.autoEnabled = autoTriggerEnabled;
        autoBtn.textContent = `🐕 自动${autoTriggerEnabled ? '开启' : '关闭'}`;
        
        // 直接设置颜色确保即时更新
        autoBtn.style.background = `linear-gradient(135deg, 
            ${autoTriggerEnabled ? 'var(--ghost-success)' : 'var(--ghost-error)'}, 
            ${autoTriggerEnabled ? 'var(--ghost-success-light)' : 'var(--ghost-error-light)'})`;
    }
    
    // 更新所有状态显示
    updateStatusDisplay();
    updateAutoStatus(); // 如果有状态指示器
    
    // 调试输出
    console.log('当前自动状态:', autoTriggerEnabled); 
    logger.info(`自动触发功能已${autoTriggerEnabled ? '开启' : '关闭'}`);
}

// 更新状态显示
function updateStatusDisplay() {
    const statusContainer = document.getElementById(`${PANEL_ID}_status_text`);
    if (statusContainer) {
        statusContainer.textContent = autoTriggerEnabled ? '自动尾随中' : '手动模式';
        statusContainer.style.color = autoTriggerEnabled ? 
            'var(--ghost-success)' : 
            'var(--ghost-error)';
    }
}

// 更新消息计数
async function updateMessageCount() {
    try {
        const context = await getContext();
        const messages = getMessageArray(context);
        
        // 只更新数字，样式通过CSS
        const messageCountElement = document.getElementById(`${PANEL_ID}_message_count`);
        if (messageCountElement) {
            messageCountElement.textContent = messages.length;
            
            // 可选：根据消息数量添加状态类
            messageCountElement.className = messages.length > AUTO_TRIGGER_THRESHOLD ? 'count-high' : 'count-normal';
        }
    } catch (error) {
        logger.warn('📊 无法更新消息计数:', error);
    }
}


// 🎨 添加样式
function addGhostStyles() {
    const style = document.createElement('style');
    style.textContent = `
        @keyframes ghostRotate {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
        }
        
        
        #${PANEL_ID}_content button:hover {
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        }
        
        #${PANEL_ID}_content select:hover {
            border-color: ${THEME_CONFIGS[currentTheme].secondary};
        }
        
        #${PANEL_ID}_log_content::-webkit-scrollbar {
            width: 6px;
        }
        
        #${PANEL_ID}_log_content::-webkit-scrollbar-track {
            background: rgba(255, 255, 255, 0.05);
        }
        
        #${PANEL_ID}_log_content::-webkit-scrollbar-thumb {
            background: rgba(255, 255, 255, 0.2);
            border-radius: 3px;
        }
        
        /* 响应式设计 */
        @media (max-width: 768px) {
            #${PANEL_ID} {
                right: 20px !important;
                top: 15px !important;
            }
            
            #${PANEL_ID}_content {
                width: calc(100vw - 40px) !important;
                max-width: 300px !important;
                right: -10px !important;
            }

        }
        
        @media (max-width: 480px) {
            #${PANEL_ID}_content {
                width: calc(100vw - 20px) !important;
                right: -25px !important;
            }
        }
    `;
    document.head.appendChild(style);
}

// 初始化时加载保存的主题
function loadSavedTheme() {
    const saved = JSON.parse(localStorage.getItem('ghost_face_settings'));
    if (saved?.theme) {
        currentTheme = saved.theme;
        applyTheme(currentTheme);
    }
}


// 初始化函数
function initializeGhostFace() {
    loadSavedTheme();
    currentTheme = extension_settings.the_ghost_face?.theme || 'classic';
    const themeSelect = document.getElementById('the_ghost_face_control_panel_theme_select');
    if (themeSelect) {
        themeSelect.value = currentTheme;
    }
    
    changeTheme(currentTheme);
    try {
        createGhostControlPanel();
        addGhostMenuItem();
        setupMessageListener();
        /*restoreHiddenMessages(); */
        setTimeout(() => {
            systemInitialized = true;
            logger.info('❤ 鬼面控制台已启动！开始进行蹲起招手吧！');
            // 初始化消息计数
            setTimeout(async () => {
                try {
                    const context = await getContext();
                    const messages = getMessageArray(context);
                    lastMessageCount = messages.length;
                    logger.info(`📊 当前消息数: ${lastMessageCount}`);
                    updateMessageCount();
                } catch (error) {
                    logger.warn('📊 无法获取初始消息数:', error);
                }
            }, 2000);
        }, 100);
        
    } catch (error) {
        console.error('[鬼面] 初始化失败:', error);
    }
}

// 🎯 延迟初始化
setTimeout(initializeGhostFace, 50);
