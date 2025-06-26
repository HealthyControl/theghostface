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

// ✨ 工具函数：统一获取消息数组（修复版）
function getMessageArray(source) {
    // 优先检查 SillyTavern 标准结构
    if (Array.isArray(source?.chat)) return source.chat;
    
    // 备用检查
    if (Array.isArray(source?.messages)) return source.messages;
    if (Array.isArray(source)) return source;
    
    console.warn('[ghost] 未识别的上下文结构:', source);
    return [];
}

// ✨ 收集消息（全量或增量）
async function collect_chat_messages(isInitial = false) {
    const context = await getContext(); 
    const messages = getMessageArray(context);

    console.log(`[ghost] 获取到 ${messages.length} 条消息`);
    
    // 调试：查看消息结构
    if (messages.length > 0) {
        console.log('[ghost] 第一条消息结构:', JSON.stringify(messages[0], null, 2));
    }
    
    if (messages.length === 0) {
        console.warn('[ghost] collect_chat_messages: 没有找到任何消息');
        return [];
    }

    if (isInitial) {
        const filtered = messages.filter(msg => {
            // 调试每条消息的属性
            console.log('[ghost] 检查消息:', {
                is_user: msg.is_user,
                is_system: msg.is_system,
                has_ghost_summarized: !!msg.extra?.ghost_summarized,
                keys: Object.keys(msg)
            });
            
            return !msg.extra?.ghost_summarized &&
                   (msg.is_user || msg.is_system);
        });
        console.log(`[ghost] 初始筛选: ${filtered.length} 条消息`);
        return filtered;
    }

    const filtered = messages.slice(-40).filter(msg =>
        !msg.extra?.ghost_summarized &&
        (msg.is_user || msg.is_system)
    );
    console.log(`[ghost] 增量筛选: ${filtered.length} 条消息`);
    return filtered;
}

// ✨ 模型总结生成（修复版）
async function generateSummary(messages) {
    if (!messages || messages.length === 0) {
        console.warn('[ghost] generateSummary: 没有可用消息');
        return '';
    }

    const contextText = messages
        .map(msg => {
            const speaker = msg.is_user ? '{{user}}' : '{{char}}';
            // 处理不同的消息内容格式
            let content = '';
            if (typeof msg.mes === 'string') {
                content = msg.mes;
            } else if (typeof msg.text === 'string') {
                content = msg.text;
            } else if (typeof msg.content === 'string') {
                content = msg.content;
            } else if (msg.mes && typeof msg.mes === 'object') {
                content = JSON.stringify(msg.mes);
            } else if (msg.text && typeof msg.text === 'object') {
                content = JSON.stringify(msg.text);
            } else {
                content = '[无内容]';
            }
            return `${speaker}: ${content}`;
        })
        .join('\n');

    const optimized_prompt = `你是一个专业且充满热心的故事总结助手，请从最近40条对话中提取可复用剧情细节：
1. 筛选标准（必须满足）：
   - 明确喜好/恐惧（比如"喜欢/讨厌/害怕"等关键词）
   - 具体梦境/回忆（比如"梦见/想起"等）
   - 重要人际关系（出现人名或关系称谓）
   - 角色与用户的独特互动
2. 输出要求：
   - 每行一个细节，格式：[类型] 内容
   - 保留原始关键词
   - 只需要记录，不要解释或补充

对话记录：
${contextText}

示例输出：
[喜好] 用户喜欢雨天红茶
[恐惧] 用户害怕檀香气味
[事件] 角色玩游戏很菜被用户嘲笑了`;

    console.log('[ghost] 开始生成总结...');
    console.log('[ghost] 提示词长度:', optimized_prompt.length);
    
    try {
        const context = await getContext();
        const result = await context.generateQuietPrompt(
            optimized_prompt,
            true,      // quiet 模式（不显示在聊天窗口）
            false,     // 不注入世界书
            "你是一个专业的故事总结助手" // 系统提示（可选）
        );
        
        return parseModelOutput(result);
    } catch (error) {
        console.error("生成失败详情:", {
            error: error.stack,
            prompt: optimized_prompt
        });
        throw new Error("ST 生成失败: " + error.message);
    }
}

// ✨ 给处理过的消息打标签（修复版）
function markMessagesSummarized(messages) {
    if (!Array.isArray(messages)) {
        console.warn('[ghost] markMessagesSummarized: 输入不是数组');
        return;
    }
    
    messages.forEach(msg => {
        msg.extra = msg.extra || {};
        msg.extra.ghost_summarized = true;
    });
    
    console.log(`[ghost] 已标记 ${messages.length} 条消息为已总结`);
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

// 偷偷蹲起来尾随（修复版）
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
        const messages = await collect_chat_messages(isInitial);
        if (!messages || messages.length === 0) {
            toastr.warning("没有找到可总结的消息，鬼面悄悄退场了...");
            toastr.remove(notification);
            return;
        }

        // 2. 模型生成总结
        const summaryContent = await generateSummary(messages);
        if (!summaryContent?.trim()) {
            toastr.warning("总结失败或为空，鬼面望天叹气...");
            toastr.remove(notification);
            return;
        }

        // 3. 存入世界书
        await saveToWorldBook(summaryContent);

        // 4. 标记已处理消息
        markMessagesSummarized(messages);

        // 5. 移除提示
        toastr.remove(notification);
        toastr.success("👻 鬼面尾随成功！信息已记录");
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
            console.warn('[ghost] 没有激活的世界书，创建临时条目');
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

        if (Object.keys(categorizedData).length === 0) {
            console.warn('[ghost] 没有找到有效的分类数据');
            return;
        }

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

            console.log(`[ghost] 创建世界书条目: ${category} - ${items.length}条信息`);
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
        console.warn('[ghost] 世界书打开失败');
    } else {
        toastr.error('未知错误，请查看控制台');
        console.error('[ghost] 自动总结失败:', error);
    }
}

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
