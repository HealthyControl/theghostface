// TheGhostFace
// 062625
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
/**
 * 统一提取消息数组（适配插件返回结构差异）
 * @param {any} source - getContext() 或其他插件返回的上下文对象
 * @returns {Array} 消息数组（可能为空）
 */
function getMessageArray(source) {
    if (Array.isArray(source?.chat)) return source.chat;// 优先检查用户上下文结构
    if (Array.isArray(source?.messages)) return source.messages; // 次级结构：插件内部接口
    if (Array.isArray(source)) return source;// 直接是数组
    // 兼容 generateQuietPrompt 结构（无法处理）
    if (typeof source?.generateQuietPrompt === 'function') {
        console.warn('[ghost] getContext 返回封装对象，无法提取消息数组:', source);
        return [];
    }

    console.warn('[ghost] 未识别的上下文结构:', source);
    return [];
}

// ✨ 工具函数：异步工具,封装 getContext() 的异步调用
// ✨ 收集消息（全量或增量）
async function getGhostContextMessages(isInitial = false) {
    const context = await getContext(); 
    const messages = getMessageArray(context);

    console.log(`[ghost] 获取到 ${messages.length} 条消息`);
    
    if (messages.length === 0) {
        console.warn('[ghost] 没有找到任何消息');
        return [];
    }

    const filtered = messages.slice(isInitial ? 0 : -40).filter(msg => {
        // 跳过已总结的消息
        if (msg.extra?.ghost_summarized) return false;
        
        // ✨ 关键修复：包含角色消息
        const isValidMessage = msg.is_user ||           // 用户消息
                              msg.is_system ||         // 系统消息  
                              (!msg.is_user && !msg.is_system && msg.mes); // 角色消息
                              
        return isValidMessage;
    });
    
    console.log(`[ghost] ${isInitial ? '初始' : '增量'}筛选: ${filtered.length} 条消息`);
    return filtered;
}

// ✨ 模型总结生成（修复版）
async function generateSummary(messages) {
    console.log('[ghost] === 开始 generateSummary ===');
    
    if (!messages || messages.length === 0) {
        console.warn('[ghost] generateSummary: 没有可用消息');
        return '';
    }

    console.log(`[ghost] 步骤1: 准备处理 ${messages.length} 条消息`);

    try {
        // 步骤1: 构建上下文文本
        console.log('[ghost] 步骤2: 开始构建上下文文本...');
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
                
                console.log(`[ghost] 消息${index + 1}: ${speaker} (${content.length}字)`);
                return `${speaker}: ${content}`;
            })
            .join('\n');

        console.log(`[ghost] 步骤3: 上下文构建完成，总长度: ${contextText.length} 字符`);

        // 步骤2: 构建提示词
        const optimized_prompt = `你是一个专业且充满热心的故事总结助手，请从最近的对话中提取可复用剧情细节：
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

        console.log(`[ghost] 步骤4: 提示词构建完成，长度: ${optimized_prompt.length} 字符`);
        
        // 检查提示词长度
        if (optimized_prompt.length > 8000) {
            console.warn(`[ghost] ⚠️ 提示词过长 (${optimized_prompt.length}字符)，可能导致API调用失败`);
        }

        // 步骤3: 获取上下文对象
        console.log('[ghost] 步骤5: 获取Context对象...');
        const context = await getContext();
        
        if (!context) {
            throw new Error('getContext() 返回 null/undefined');
        }
        
        console.log('[ghost] 步骤6: Context对象获取成功，类型:', typeof context);
        console.log('[ghost] 步骤7: Context对象属性:', Object.keys(context));
        
        if (typeof context.generateQuietPrompt !== 'function') {
            throw new Error('context.generateQuietPrompt 不是函数');
        }

        // 步骤4: 调用AI生成
        console.log('[ghost] 步骤8: 开始调用 generateQuietPrompt...');
        console.log('[ghost] 调用参数:', {
            promptLength: optimized_prompt.length,
            quiet: true,
            skipWI: false,
            systemPrompt: "你是一个专业的故事总结助手"
        });

        // 设置超时
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('AI生成超时 (30秒)')), 30000);
        });

        const generatePromise = context.generateQuietPrompt(
            optimized_prompt,
            true,      // quiet 模式
            false,     // 不跳过世界书注入
            "你是一个专业的故事总结助手"
        );

        console.log('[ghost] 步骤9: 等待AI响应...');
        const result = await Promise.race([generatePromise, timeoutPromise]);
        
        console.log('[ghost] 步骤10: AI生成完成！');
        console.log('[ghost] 原始结果类型:', typeof result);
        console.log('[ghost] 原始结果长度:', result ? result.length : 'null');
        console.log('[ghost] 原始结果预览:', result ? result.slice(0, 200) + '...' : 'null');
        
        if (!result) {
            throw new Error('AI返回空结果');
        }

        // 步骤5: 解析结果
        console.log('[ghost] 步骤11: 开始解析模型输出...');
        const parsedResult = parseModelOutput(result);
        console.log('[ghost] 步骤12: 解析完成，最终结果长度:', parsedResult.length);
        console.log('[ghost] === generateSummary 成功完成 ===');
        
        return parsedResult;

    } catch (error) {
        console.error('[ghost] === generateSummary 发生错误 ===');
        console.error('[ghost] 错误类型:', error.constructor.name);
        console.error('[ghost] 错误消息:', error.message);
        console.error('[ghost] 错误堆栈:', error.stack);
        
        // 详细错误分析
        if (error.message.includes('timeout') || error.message.includes('超时')) {
            console.error('[ghost] 🔥 AI生成超时，可能是提示词太长或网络问题');
        } else if (error.message.includes('generateQuietPrompt')) {
            console.error('[ghost] 🔥 generateQuietPrompt 调用失败，检查ST版本兼容性');
        } else if (error.message.includes('Context')) {
            console.error('[ghost] 🔥 上下文获取失败，检查getContext()函数');
        } else {
            console.error('[ghost] 🔥 未知错误，需要进一步调试');
        }
        
        throw error;
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
    console.log('[ghost] 开始解析模型输出...');
    console.log('[ghost] 原始输出类型:', typeof rawOutput);
    console.log('[ghost] 原始输出长度:', rawOutput ? rawOutput.length : 'null');
    
    try {
        if (!rawOutput || typeof rawOutput !== 'string') {
            console.warn('[ghost] 输出不是字符串，尝试转换...');
            rawOutput = String(rawOutput || '');
        }
        
        const lines = rawOutput.split('\n')
            .map(line => line.trim())
            .filter(line => {
                const isValid = line && line.match(/^\[.+?\]/);
                if (line && !isValid) {
                    console.log('[ghost] 跳过无效行:', line.slice(0, 50));
                }
                return isValid;
            });
            
        console.log(`[ghost] 解析完成: 找到 ${lines.length} 个有效条目`);
        lines.forEach((line, i) => {
            console.log(`[ghost] 条目${i + 1}:`, line.slice(0, 80));
        });
        
        const result = lines.join('\n');
        console.log(`[ghost] 最终解析结果长度: ${result.length}`);
        
        return result;
    } catch (error) {
        console.error('[ghost] 解析模型输出时出错:', error);
        console.warn('[ghost] 返回原始内容');
        return rawOutput || '';
    }
}

// 偷偷蹲起来尾随（修复版）
async function stealthSummarize(isInitial = false) {
    console.log('[ghost] === 开始 stealthSummarize 流程 ===');
    console.log('[ghost] 参数: isInitial =', isInitial);
    
    const notification = toastr.info("👻 鬼面尾随中...", null, {
        timeOut: 0,
        closeButton: false,
        progressBar: false,
        hideDuration: 0,
        positionClass: "toast-bottom-left"
    });

    try {
        // 第1步: 收集消息
        console.log('[ghost] 第1步: 开始收集消息...');
        const messages = await getGhostContextMessages(isInitial);
        
        if (!messages || messages.length === 0) {
            console.warn('[ghost] ⚠️ 没有找到可总结的消息');
            toastr.warning("没有找到可总结的消息，鬼面悄悄退场了...");
            return;
        }

        console.log(`[ghost] 第1步完成: 收集到 ${messages.length} 条消息`);

        // 第2步: 生成总结
        console.log('[ghost] 第2步: 开始生成总结...');
        const summaryContent = await generateSummary(messages);
        
        if (!summaryContent?.trim()) {
            console.warn('[ghost] ⚠️ AI生成的总结为空');
            toastr.warning("总结失败或为空，鬼面望天叹气...");
            return;
        }

        console.log(`[ghost] 第2步完成: 总结长度 ${summaryContent.length} 字符`);
        console.log('[ghost] 总结内容预览:', summaryContent.slice(0, 100) + '...');

        // 第3步: 保存到世界书
        console.log('[ghost] 第3步: 开始保存到世界书...');
        await saveToWorldBook(summaryContent);
        console.log('[ghost] 第3步完成: 已保存到世界书');

        // 第4步: 标记消息
        console.log('[ghost] 第4步: 标记消息为已处理...');
        markMessagesSummarized(messages);
        console.log('[ghost] 第4步完成: 已标记消息');

        // 成功完成
        toastr.success("👻 鬼面尾随成功！信息已记录");
        console.log('[ghost] === stealthSummarize 流程成功完成 ===');

    } catch (err) {
        console.error('[ghost] === stealthSummarize 流程失败 ===');
        console.error('[ghost] 错误详情:', {
            name: err.name,
            message: err.message,
            stack: err.stack
        });
        
        toastr.error("尾随被看破: " + err.message);
        
        // 根据错误类型给出具体提示
        if (err.message.includes('超时')) {
            console.error('[ghost] 💡 建议: 减少消息数量或优化提示词长度');
        } else if (err.message.includes('generateQuietPrompt')) {
            console.error('[ghost] 💡 建议: 检查SillyTavern版本是否支持该API');
        } else if (err.message.includes('世界书')) {
            console.error('[ghost] 💡 建议: 检查世界书是否正确加载');
        }
        
    } finally {
        toastr.remove(notification);
        console.log('[ghost] === stealthSummarize 流程结束 ===');
    }
}

//把模型生成的总结信息保存到世界书
/*这段好像不太对
// 替代world_info的函数
function getActiveWorldInfo() {
    const globalSelect = world_info?.globalSelect?.[0]; 
    const trueWorldInfo = WORLD_INFOS?.[globalSelect];
    
    if (!trueWorldInfo || !trueWorldInfo.name) {
        toastr.error(`⚠️ 找不到绑定的世界书数据 (${globalSelect})，请检查 World Info 设置`);
        throw new Error('未能加载当前绑定的 world_info 文件对象');
    }
    
    return trueWorldInfo;
}
    */


// 直接使用全局 world_info
function getActiveWorldInfo() {
    console.log('[ghost] 检查当前世界书状态...');
    console.log('[ghost] world_info 对象:', world_info);
    console.log('[ghost] world_info 类型:', typeof world_info);
    
    // 直接检查全局 world_info 对象
    if (!world_info) {
        console.error('[ghost] world_info 未定义或为 null');
        toastr.error(`⚠️ 世界书未加载，请先在 World Info 页面创建或加载一个世界书文件`);
        throw new Error('世界书未加载，请先创建或加载一个世界书文件');
    }
    
    if (!world_info.name) {
        console.error('[ghost] world_info.name 未定义');
        toastr.error(`⚠️ 世界书名称无效，请检查世界书是否正确加载`);
        throw new Error('世界书名称无效，可能未正确加载');
    }
    
    // 确保 entries 数组存在
    if (!Array.isArray(world_info.entries)) {
        console.warn('[ghost] world_info.entries 不是数组，正在初始化...');
        world_info.entries = [];
    }
    
    console.log(`[ghost] 当前世界书: "${world_info.name}", 条目数: ${world_info.entries.length}`);
    return world_info;
}

// ✅ 进一步简化的 saveToWorldBook 函数
async function saveToWorldBook(summaryContent) {
    console.log('[ghost] === 开始保存到世界书 ===');
    console.log('[ghost] 总结内容长度:', summaryContent.length);
    
    try {
        // 1. 检查并获取世界书
        const activeWorldInfo = getActiveWorldInfo(); // 这里会抛出错误如果世界书无效
        
        // 2. 解析总结内容
        console.log('[ghost] 开始解析总结内容...');
        const summaryLines = summaryContent.split('\n').filter(line => line.trim());
        console.log('[ghost] 解析到', summaryLines.length, '行内容');
        
        const categorizedData = {};
        
        summaryLines.forEach((line, index) => {
            console.log(`[ghost] 处理第${index + 1}行:`, line);
            const match = line.match(/^\[(.+?)\]\s*(.+)$/);
            if (match) {
                const [, category, content] = match;
                if (!categorizedData[category]) {
                    categorizedData[category] = [];
                }
                categorizedData[category].push(content);
                console.log(`[ghost] 分类成功: ${category} -> ${content.slice(0, 30)}...`);
            } else {
                console.warn(`[ghost] 无法解析行:`, line);
            }
        });

        const categoryCount = Object.keys(categorizedData).length;
        console.log(`[ghost] 分类完成，共${categoryCount}个类别:`, Object.keys(categorizedData));

        if (categoryCount === 0) {
            throw new Error('没有找到有效的分类数据');
        }

        // 3. 创建世界书条目
        let successCount = 0;
        for (const [category, items] of Object.entries(categorizedData)) {
            console.log(`[ghost] 创建类别"${category}"的条目，包含${items.length}个项目`);
            
            try {
                // 直接使用 activeWorldInfo（就是 world_info）
                const newEntry = createWorldInfoEntry(activeWorldInfo, null);
                
                if (!newEntry) {
                    console.error('[ghost] createWorldInfoEntry 返回 null');
                    continue;
                }
                
                console.log('[ghost] 条目创建成功，UID:', newEntry.uid);
                
                // 设置条目属性
                const entryContent = items.join('\n');
                const entryName = `鬼面记录_${category}_${Date.now()}`;
                
                console.log('[ghost] 设置条目属性...');
                Object.assign(newEntry, {
                    comment: `鬼面自动总结 - ${category}`,
                    content: entryContent,
                    key: [category, '鬼面', '总结'],
                    keysecondary: [],
                    constant: false,
                    selective: true,
                    selectiveLogic: 0,
                    addMemo: true,
                    order: 100,
                    position: 0,
                    disable: false,
                    excludeRecursion: false,
                    preventRecursion: false,
                    delayUntilRecursion: false,
                    probability: 100,
                    useProbability: false
                });
                
                console.log(`[ghost] 条目"${entryName}"配置完成`);
                successCount++;
                
            } catch (entryError) {
                console.error(`[ghost] 创建条目"${category}"失败:`, entryError);
                continue;
            }
        }
        
        if (successCount === 0) {
            throw new Error('所有条目创建均失败');
        }

        // 4. 保存世界书
        console.log('[ghost] 开始保存世界书...');
        console.log('[ghost] 保存参数:', {
            name: activeWorldInfo.name,
            entriesCount: activeWorldInfo.entries.length,
            force: true
        });
        
        await saveWorldInfo(activeWorldInfo.name, activeWorldInfo, true);
        console.log('[ghost] 世界书保存成功');

        // 5. 成功提示
        const message = `👻 鬼面已将 ${successCount}/${categoryCount} 类信息存入世界书`;
        toastr.success(message);
        console.log(`[ghost] === 世界书保存完成 === 成功: ${successCount}, 失败: ${categoryCount - successCount}`);

    } catch (error) {
        console.error('[ghost] === 世界书保存失败 ===');
        console.error('[ghost] 错误详情:', error);
        
        // 详细错误分析
        if (error.message.includes('世界书未加载')) {
            console.error('[ghost] 💡 需要先创建世界书');
            toastr.error('请先在 World Info 页面创建一个世界书文件');
        } else if (error.message.includes('UID')) {
            console.error('[ghost] 💡 UID分配失败');
            toastr.error('世界书条目创建失败，请检查世界书状态');
        } else {
            console.error('[ghost] 💡 未知世界书错误');
            toastr.error('世界书保存失败: ' + error.message);
        }
        
        throw error;
    }
}

// ✨ 世界书状态检查函数（调试用）
function checkWorldBookStatus() {
    console.log('=== 世界书状态检查 ===');
    console.log('world_info:', world_info);
    console.log('world_info 类型:', typeof world_info);
    
    if (world_info) {
        console.log('名称:', world_info.name);
        console.log('条目数量:', world_info.entries?.length || 0);
        console.log('全局选择:', world_info.globalSelect);
        if (world_info.entries && world_info.entries.length > 0) {
            console.log('第一个条目:', world_info.entries[0]);
        }
    } else {
        console.warn('⚠️ 世界书未加载');
    }
    
    // 检查世界书相关函数
    console.log('createWorldInfoEntry 函数:', typeof createWorldInfoEntry);
    console.log('saveWorldInfo 函数:', typeof saveWorldInfo);
    console.log('loadWorldInfo 函数:', typeof loadWorldInfo);
}

// 错误捕获机制
// 在浏览器控制台运行这个，捕获下一个错误
window.addEventListener('error', function(e) {
    console.log('🔥 捕获到错误:', e.error);
    console.log('🔥 错误堆栈:', e.error.stack);
    console.log('🔥 错误位置:', e.filename, e.lineno, e.colno);
});

// 也可以捕获 Promise 错误
window.addEventListener('unhandledrejection', function(e) {
    console.log('🔥 捕获到 Promise 错误:', e.reason);
});

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
