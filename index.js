// TheGhostFace
// 062525
// 机器人

import {
    getContext,
    extension_settings,// 获取完整的聊天上下文(包括角色消息/用户消息）
} from '../../../extensions.js';
import {
    chat_metadata,// 获取当前聊天的元数据（如标题、角色设定等）
    getMaxContextSize,// 获取上下文最大长度限制（避免总结时超出限制）
    generateRaw, // 原始AI生成接口
    streamingProcessor,// 流式处理（适合长文本生成）
    main_api, // 当前连接的API配置（确保使用相同AI参数）
    system_message_types, // 可能需要修改系统消息类型
    saveSettingsDebounced, // 防抖保存设置（避免频繁写入）
    getRequestHeaders, // 包含认证信息
} from '../../../../script.js';
import {
    parseJsonFile,// 解析已有的世界书JSON
    delay, 
    navigation_option,
    copyText,// 想不到有啥用但是先拿上吧
    getStringHash, 
    debounce, 
    waitUntilCondition// 可以用来设置自动总结的时机？
} from '../../../utils.js';
import { 
    createWorldInfoEntry, // 世界书相关
    deleteWIOriginalDataValue, 
    deleteWorldInfoEntry, 
    importWorldInfo, 
    loadWorldInfo, 
    saveWorldInfo, 
    world_info 
} from '../../../world-info.js';
import { getPresetManager } from '../../../preset-manager.js'// 预设管理，可以联动使用
import { formatInstructModeChat } from '../../../instruct-mode.js';// 把聊天信息转换成LLM语言
import { loadMovingUIState, renderStoryString, power_user } from '../../../power-user.js';// 高级用户深度定制化
import { dragElement } from '../../../RossAscends-mods.js';// 拖拽UI
import { debounce_timeout } from '../../../constants.js';// 防抖控制（如用户频繁触发时）
import { MacrosParser } from '../../../macros.js';// 宏指令解析器，条件判断、变量替换、函数调用etc
import { commonEnumProviders } from '../../../slash-commands/SlashCommandCommonEnumsProvider.js';// 注册斜杠命令用
import { executeSlashCommands, registerSlashCommand } from '../../../slash-commands.js';
import { getRegexScripts } from '../../../../scripts/extensions/regex/index.js'// 正则相关
import { runRegexScript } from '../../../../scripts/extensions/regex/engine.js'

export { MODULE_NAME };

// 数据储存定位
const MODULE_NAME = 'the_ghost_face'; // 必须全小写或者下划线
const MODULE_NAME_FANCY = '鬼面'; //支持多语言显示
const PROGRESS_BAR_ID = `${MODULE_NAME}_progress_bar`;

// ✨ 工具函数：统一获取消息数组
function getMessageArray(source) {
    if (Array.isArray(source)) return source;
    if (Array.isArray(source?.messages)) return source.messages;
    console.warn('[ghost] 未识别的上下文结构:', source);
    return [];
}

// ✨ 收集消息（全量或增量）
async function collect_chat_messages(isInitial = false) {
    const context = await getContext(); 
    const messages = getMessageArray(context);

    if (isInitial) {
        return messages.filter(msg =>
            !msg.extra?.ghost_summarized &&
            (msg.is_user || msg.is_system)
        );
    }

    return messages.slice(-40).filter(msg =>
        !msg.extra?.ghost_summarized &&
        (msg.is_user || msg.is_system)
    );
}

// ✨ 模型总结生成
async function generateSummary(context) {
    const messages = getMessageArray(context);

    if (messages.length === 0) {
        console.warn('[ghost] generateSummary: 没有可用消息');
        return '';
    }

    const optimized_prompt = `
请从最近40条对话中提取**可复用剧情细节**：
1. 筛选标准（必须满足）：
   - 明确喜好/恐惧（比如"喜欢/讨厌/害怕"等关键词）
   - 具体梦境/回忆（比如"梦见/想起"等）
   - 重要人际关系（出现人名或关系称谓）
   - {{char}}与{{user}}的独特互动
2. 输出要求：
   - 每行一个细节，格式：[类型] 内容
   - 保留原始关键词（如"黑猫"、"檀香"）
   - 只需要记录，不要解释或补充

对话记录：
"""
{{context}}
"""
示例输出：
[喜好] {{user}}喜欢雨天红茶
[恐惧] {{user}}害怕檀香气味
[事件] {{char}}玩黎明杀机很菜被{{user}}嘲笑了
`.trim();

    const filled_prompt = optimized_prompt.replace('{{context}}',
        messages.map(msg => msg.text).join('\n')
    );

    const result = await generateRaw({
        prompt: filled_prompt,
        temperature: 0.2,
        max_context_length: 2000
    });

    return parseModelOutput(result);
}

// ✨ 给处理过的消息打标签
function markMessagesSummarized(context) {
    const messages = getMessageArray(context);
    messages.forEach(msg => {
        msg.extra = msg.extra || {};
        msg.extra.ghost_summarized = true;
    });
}

// 定义一下模型输出，工具函数
function parseModelOutput(rawOutput) {
    try {
        const lines = rawOutput.split('\n')
            .map(line => line.trim())
            .filter(line => line && line.match(/^\[.+?\]/)); // 只要符合格式的行
            
        return lines.join('\n');
    } catch (error) {
        console.warn('解析模型输出失败，返回原始内容');
        return rawOutput;
    }
}

// 偷偷蹲起来尾随
async function stealthSummarize(isInitial = false) {
    const notification = toastr.info("👻 鬼面尾随中...", null, {
        timeOut: 0,
        closeButton: false,
        progressBar: false,
        hideDuration: 0,
        positionClass: "toast-bottom-left"
    });

    try {
        // 1. 收集信息
        const context = await collect_chat_messages(isInitial);
        if (!context || context.length === 0) {
            toastr.warning("没有找到可总结的消息，鬼面悄悄退场了...");
            toastr.remove(notification);
            return;
        }

        // 2. 模型生成总结
        const summaryContent = await generateSummary(context);
        if (!summaryContent?.trim()) {
            toastr.warning("总结失败或为空，鬼面望天叹气...");
            toastr.remove(notification);
            return;
        }

        // 3. 存入世界书
        await saveToWorldBook(summaryContent);

        // 4. 标记已处理消息
        markMessagesSummarized(context);

        // 5. 移除提示
        toastr.remove(notification);
        console.log('[ghost] 总结完成，已写入世界书');

    } catch (err) {
        toastr.remove(notification);
        toastr.error("尾随被看破: " + err.message);
        console.error('[ghost] stealthSummarize error:', err);
    }
}



//把模型生成的总结信息保存到世界书
async function saveToWorldBook(summaryContent) {
    try {
        const currentWorldInfo = world_info;
        if (!currentWorldInfo || !currentWorldInfo.globalSelect) {
            console.warn('没有激活的世界书，创建临时条目');
        }

        const summaryLines = summaryContent.split('\n').filter(line => line.trim());
        const categorizedData = {};

        summaryLines.forEach(line => {
            const match = line.match(/^\[(.+?)\]\s*(.+)$/);
            if (match) {
                const [, category, content] = match;
                if (!categorizedData[category]) {
                    categorizedData[category] = [];
                }
                categorizedData[category].push(content);
            }
        });

        for (const [category, items] of Object.entries(categorizedData)) {
            const entryName = `关于我们_${category}_${Date.now()}`;
            const entryContent = items.join('\n');

            const newEntry = createWorldInfoEntry(currentWorldInfo, null);
            Object.assign(newEntry, {
                comment: `鬼面自动总结 - ${category}`,
                content: entryContent,
                constant: true,
                selective: false,
                selectiveLogic: 0,
                addMemo: true,
                order: 999,
                position: 0,
                disable: false,
                excludeRecursion: false,
                preventRecursion: false,
                delayUntilRecursion: false,
                probability: 100,
                useProbability: true
            });

            console.log(`创建世界书条目: ${category} - ${items.length}条信息`);
        }

        await saveWorldInfo(currentWorldInfo?.name || 'default', currentWorldInfo, true);

        toastr.success(`👻 鬼面已将 ${Object.keys(categorizedData).length} 类信息存入世界书`);
    } catch (error) {
        handleError(error);
        throw error;
    }
}

//世界书错误提示
function handleError(error) {
    if (error.message.includes('API')) {
        toastr.error(`AI接口异常: ${error.message.slice(0, 50)}...`);
    } else if (error.message.includes('worldBook')) {
        console.warn('世界书打开失败');
    } else {
        toastr.error('未知错误，请查看控制台');
        console.error('自动总结失败:', error);
    }
}

// 🎯 UI反馈系统
class GhostUIFeedback {
    constructor() {
        this.currentNotification = null;
        this.progressSteps = [];
        this.currentStep = 0;
    }

    // 显示进度条和状态
    showProgress(steps) {
        this.progressSteps = steps;
        this.currentStep = 0;
        
        // 创建进度显示区域
        this.createProgressUI();
        this.updateProgress();
    }

    createProgressUI() {
        // 移除旧的进度条
        const oldProgress = document.getElementById('ghost-progress-container');
        if (oldProgress) {
            oldProgress.remove();
        }

        // 创建新的进度容器
        const progressHTML = `
            <div id="ghost-progress-container" style="
                position: fixed;
                top: 20px;
                right: 20px;
                background: rgba(0, 0, 0, 0.9);
                color: white;
                padding: 15px;
                border-radius: 10px;
                z-index: 10000;
                min-width: 300px;
                border: 2px solid #666;
                font-family: monospace;
            ">
                <div style="display: flex; align-items: center; margin-bottom: 10px;">
                    <span style="font-size: 18px; margin-right: 8px;">👻</span>
                    <span style="font-weight: bold;">鬼面工作中...</span>
                </div>
                <div id="ghost-progress-bar" style="
                    background: #333;
                    height: 8px;
                    border-radius: 4px;
                    margin-bottom: 10px;
                    overflow: hidden;
                ">
                    <div id="ghost-progress-fill" style="
                        background: linear-gradient(90deg, #ff6b6b, #4ecdc4);
                        height: 100%;
                        width: 0%;
                        transition: width 0.3s ease;
                        border-radius: 4px;
                    "></div>
                </div>
                <div id="ghost-current-step" style="
                    font-size: 12px;
                    color: #ccc;
                ">准备开始...</div>
                <div id="ghost-step-details" style="
                    font-size: 11px;
                    color: #999;
                    margin-top: 5px;
                    max-height: 60px;
                    overflow-y: auto;
                "></div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', progressHTML);
    }

    updateProgress(stepInfo = null) {
        const progressFill = document.getElementById('ghost-progress-fill');
        const currentStepEl = document.getElementById('ghost-current-step');
        const stepDetailsEl = document.getElementById('ghost-step-details');

        if (!progressFill || !currentStepEl) return;

        // 更新进度条
        const progress = (this.currentStep / this.progressSteps.length) * 100;
        progressFill.style.width = `${progress}%`;

        // 更新当前步骤信息
        if (stepInfo) {
            currentStepEl.textContent = `${this.currentStep}/${this.progressSteps.length} - ${stepInfo.title}`;
            if (stepInfo.details) {
                stepDetailsEl.textContent = stepInfo.details;
            }
        } else if (this.currentStep < this.progressSteps.length) {
            currentStepEl.textContent = `${this.currentStep}/${this.progressSteps.length} - ${this.progressSteps[this.currentStep]}`;
        }
    }

    nextStep(stepInfo = null) {
        this.currentStep++;
        this.updateProgress(stepInfo);
    }

    // 显示成功消息
    showSuccess(message, details = null) {
        this.hideProgress();
        toastr.success(message, null, {
            timeOut: 5000,
            closeButton: true,
            progressBar: true,
            positionClass: "toast-top-right"
        });
        
        if (details) {
            console.log('[ghost] 成功详情:', details);
        }
    }

    // 显示错误消息
    showError(message, error = null) {
        this.hideProgress();
        toastr.error(message, null, {
            timeOut: 8000,
            closeButton: true,
            progressBar: true,
            positionClass: "toast-top-right"
        });
        
        if (error) {
            console.error('[ghost] 错误详情:', error);
            // 在聊天区域也显示错误详情
            this.showChatMessage(`❌ 鬼面遇到问题: ${message}`, 'system');
        }
    }

    // 显示警告消息
    showWarning(message) {
        toastr.warning(message, null, {
            timeOut: 6000,
            closeButton: true,
            progressBar: true,
            positionClass: "toast-top-right"
        });
    }

}

// 创建全局UI反馈实例
const ui = new GhostUIFeedback();


// 添加slash命令
registerSlashCommand(
    'gf_sum',
    async () => {
        await stealthSummarize();
    },
    [],
    '对鬼面发起决斗邀请',
    true,
    true
);
