// TheGhostFace
// 062625再修不好我就去死好吧
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

    // 在聊天区域显示消息
    showChatMessage(content, type = 'system') {
        const chatContainer = document.querySelector('#chat');
        if (!chatContainer) return;

        const messageHTML = `
            <div class="mes" data-source="ghost-plugin" style="
                background: ${type === 'system' ? 'rgba(100, 100, 100, 0.1)' : 'rgba(0, 100, 200, 0.1)'};
                border-left: 3px solid ${type === 'system' ? '#666' : '#0066cc'};
                margin: 5px 0;
                padding: 10px;
                border-radius: 5px;
            ">
                <div class="mes_block">
                    <div class="mes_text" style="color: ${type === 'system' ? '#888' : '#333'};">
                        <span style="font-weight: bold; margin-right: 8px;">👻 鬼面:</span>
                        ${content}
                    </div>
                </div>
            </div>
        `;

        chatContainer.insertAdjacentHTML('beforeend', messageHTML);
        chatContainer.scrollTop = chatContainer.scrollHeight;
    }

    hideProgress() {
        const progressContainer = document.getElementById('ghost-progress-container');
        if (progressContainer) {
            progressContainer.remove();
        }
    }
}

// 创建全局UI反馈实例
const ui = new GhostUIFeedback();

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
        
        // 关键修复：包含角色消息，我真的不中了，修不动了
        const isValidMessage = msg.is_user ||           // 用户消息
                              msg.is_system ||         // 系统消息  
                              (!msg.is_user && !msg.is_system && msg.mes); // 角色消息
                              
        return isValidMessage;
    });
    
    console.log(`[ghost] ${isInitial ? '初始' : '增量'}筛选: ${filtered.length} 条消息`);
    return filtered;
}

// 模型总结生成
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
        const optimized_prompt = `你是一个专业且充满热心的故事总结助手，请从最近的对话中提取可复用剧情细节，确保未来角色可以随时给用户甜蜜小惊喜：
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

// 给处理过的消息打标签，目前不知道咋测试这个函数生不生效
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

// 🔥 关键修复：智能合并世界书条目，避免重复创建
async function saveToWorldBook(summaryContent) {
    console.log('[ghost] === 开始保存到世界书 ===');
    console.log('[ghost] 总结内容长度:', summaryContent.length);
    
    try {
        // 1. 获取当前选中的世界书名称
        const worldSelect = document.querySelector('#world_editor_select');
        if (!worldSelect || !worldSelect.value) {
            throw new Error('请先在 World Info 页面选择一个世界书');
        }
        
        const worldBookName = worldSelect.selectedOptions[0].textContent;
        console.log('[ghost] 当前世界书:', worldBookName);
        ui.nextStep({
            title: '加载世界书',
            details: `正在加载世界书: ${worldBookName}`
        });
        
        // 2. 加载世界书数据
        const worldBookData = await loadWorldInfo(worldBookName);
        if (!worldBookData) {
            throw new Error('无法加载世界书数据');
        }
        
        console.log('[ghost] 世界书加载成功，当前条目数:', Object.keys(worldBookData.entries || {}).length);
        
        // 3. 解析总结内容
        console.log('[ghost] 开始解析总结内容...');
        ui.nextStep({
            title: '解析总结内容',
            details: '正在分析新生成的故事信息...'
        });
        
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

        // 4. 🔥 智能合并：检查现有条目，避免重复创建
        console.log('[ghost] 开始智能合并条目...');
        ui.nextStep({
            title: '智能合并条目',
            details: '正在检查现有条目，避免重复创建...'
        });

        const existingEntries = worldBookData.entries || {};
        const GHOST_COMMENT_PREFIX = '我们的故事 - ';
        
        let mergeCount = 0;
        let createCount = 0;
        
        for (const [category, items] of Object.entries(categorizedData)) {
            console.log(`[ghost] 处理类别"${category}"，包含${items.length}个项目`);
            
            const targetComment = GHOST_COMMENT_PREFIX + category;
            
            // 查找现有的同类别条目
            let existingEntry = null;
            for (const [uid, entry] of Object.entries(existingEntries)) {
                if (entry.comment === targetComment) {
                    existingEntry = entry;
                    console.log(`[ghost] 找到现有条目: ${targetComment}, UID: ${uid}`);
                    break;
                }
            }
            
            const newContent = items.join('\n');
            
            if (existingEntry) {
                // 合并到现有条目
                console.log(`[ghost] 合并到现有条目: ${targetComment}`);
                
                // 检查内容重复
                const existingLines = (existingEntry.content || '').split('\n').filter(l => l.trim());
                const newLines = newContent.split('\n').filter(l => l.trim());
                
                // 去重合并
                const allLines = [...existingLines];
                newLines.forEach(newLine => {
                    if (!allLines.find(existing => 
                        existing.trim().toLowerCase() === newLine.trim().toLowerCase())) {
                        allLines.push(newLine);
                    }
                });
                
                existingEntry.content = allLines.join('\n');
                mergeCount++;
                
                console.log(`[ghost] 合并完成，条目总行数: ${allLines.length}`);
                
            } else {
                // 创建新条目
                console.log(`[ghost] 创建新条目: ${targetComment}`);
                
                try {
                    const newEntry = createWorldInfoEntry(null, worldBookData);
                    
                    if (!newEntry) {
                        console.error('[ghost] createWorldInfoEntry 返回 null');
                        continue;
                    }
                    
                    console.log('[ghost] 条目创建成功，UID:', newEntry.uid);
                    
                    // 设置条目属性
                    Object.assign(newEntry, {
                        comment: targetComment,
                        content: newContent,
                        key: [],
                        constant: true, // 常驻条目
                        selective: false, 
                        selectiveLogic: false, 
                        addMemo: false, 
                        order: 100, 
                        position: 0, 
                        disable: false, 
                        excludeRecursion: false,
                        preventRecursion: false,
                        delayUntilRecursion: false,
                        probability: 100, 
                        useProbability: false 
                    });
                    
                    createCount++;
                    console.log(`[ghost] 新条目"${targetComment}"配置完成`);
                    
                } catch (entryError) {
                    console.error(`[ghost] 创建条目"${category}"失败:`, entryError);
                    continue;
                }
            }
        }
        
        console.log(`[ghost] 条目处理完成 - 新建: ${createCount}, 合并: ${mergeCount}`);
        
        if (createCount === 0 && mergeCount === 0) {
            throw new Error('所有条目处理均失败');
        }

        // 5. 保存世界书
        console.log('[ghost] 开始保存世界书...');
        ui.nextStep({
            title: '保存世界书',
            details: '正在将更新写入世界书文件...'
        });
        
        console.log('[ghost] 保存参数:', {
            name: worldBookName,
            entriesCount: Object.keys(worldBookData.entries).length,
            force: true
        });
        
        // ✅ 使用正确的保存方式
        await saveWorldInfo(worldBookName, worldBookData, true);
        console.log('[ghost] 世界书保存成功');

        // 6. 刷新世界书显示（如果当前在世界书页面）
        if (document.querySelector('#world_editor_select')) {
            // 触发世界书重新加载以显示新条目
            const event = new Event('change', { bubbles: true });
            document.querySelector('#world_editor_select').dispatchEvent(event);
        }

        // 7. 成功提示
        const totalProcessed = createCount + mergeCount;
        const successMessage = `👻 鬼面完成！新建 ${createCount} 个条目，合并 ${mergeCount} 个条目`;
        const detailsMessage = `世界书 "${worldBookName}" 已更新，共处理 ${totalProcessed}/${categoryCount} 类信息`;
        
        ui.showSuccess(successMessage, detailsMessage);
        ui.showChatMessage(`${successMessage}\n📚 ${detailsMessage}`, 'system');
        
        console.log(`[ghost] === 世界书保存完成 === 新建: ${createCount}, 合并: ${mergeCount}, 失败: ${categoryCount - totalProcessed}`);

    } catch (error) {
        console.error('[ghost] === 世界书保存失败 ===');
