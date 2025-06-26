// ✨ 修复后的消息获取函数
async function getGhostContextMessages(isInitial = false) {
    const context = await getContext(); 
    const messages = getMessageArray(context);

    console.log(`[ghost] 获取到 ${messages.length} 条消息`);
    
    if (messages.length === 0) {
        console.warn('[ghost] 没有找到任何消息');
        return [];
    }

    // 取消息范围：初始化时取全部，否则取最近40条
    const sourceMessages = isInitial ? messages : messages.slice(-40);
    
    const filtered = sourceMessages.filter(msg => {
        // 跳过已总结的消息
        if (msg.extra?.ghost_summarized) return false;
        
        // 判断消息类型
        const isUserMessage = msg.is_user === true;
        const isSystemMessage = msg.is_system === true;
        const isCharacterMessage = !msg.is_user && !msg.is_system && msg.mes && msg.mes.trim();
        
        const isValidMessage = isUserMessage || isSystemMessage || isCharacterMessage;
        
        console.log('[ghost] 检查消息:', {
            name: msg.name || 'Unknown',
            is_user: msg.is_user,
            is_system: msg.is_system,
            has_content: !!msg.mes,
            content_preview: msg.mes ? msg.mes.slice(0, 30) + '...' : '',
            is_valid: isValidMessage,
            already_summarized: !!msg.extra?.ghost_summarized
        });
        
        return isValidMessage;
    });
    
    console.log(`[ghost] ${isInitial ? '初始' : '增量'}筛选: ${filtered.length} 条消息`);
    return filtered;
}

// ✨ 防重复执行的总结函数
let isCurrentlySummarizing = false;

async function stealthSummarize(isInitial = false) {
    // 防止重复执行
    if (isCurrentlySummarizing) {
        console.log('[ghost] 总结正在进行中，跳过重复调用');
        return;
    }
    
    isCurrentlySummarizing = true;
    const notification = toastr.info("👻 鬼面尾随中...", null, {
        timeOut: 0,
        closeButton: false,
        progressBar: false,
        hideDuration: 0,
        positionClass: "toast-bottom-left"
    });

    try {
        console.log('[ghost] 开始执行总结流程...');
        
        // 1. 收集信息
        const messages = await getGhostContextMessages(isInitial);
        if (!messages || messages.length === 0) {
            toastr.warning("没有找到可总结的消息，鬼面悄悄退场了...");
            return;
        }

        console.log(`[ghost] 准备总结 ${messages.length} 条消息`);

        // 2. 模型生成总结
        const summaryContent = await generateSummary(messages);
        if (!summaryContent?.trim()) {
            toastr.warning("总结失败或为空，鬼面望天叹气...");
            return;
        }

        console.log('[ghost] 总结内容生成完成:', summaryContent.slice(0, 100) + '...');

        // 3. 存入世界书
        await saveToWorldBook(summaryContent);

        // 4. 标记已处理消息
        markMessagesSummarized(messages);

        toastr.success("👻 鬼面尾随成功！信息已记录");
        console.log('[ghost] 总结完成，已写入世界书');

    } catch (err) {
        toastr.error("尾随被看破: " + err.message);
        console.error('[ghost] stealthSummarize error:', err);
    } finally {
        // 清理状态
        toastr.remove(notification);
        isCurrentlySummarizing = false;
        console.log('[ghost] 总结流程结束');
    }
}

// ✨ 优化的总结生成函数
async function generateSummary(messages) {
    if (!messages || messages.length === 0) {
        console.warn('[ghost] generateSummary: 没有可用消息');
        return '';
    }

    console.log(`[ghost] 开始为 ${messages.length} 条消息生成总结`);

    const contextText = messages
        .map((msg, index) => {
            // 确定说话者
            let speaker;
            if (msg.is_user) {
                speaker = '{{user}}';
            } else if (msg.is_system) {
                speaker = 'System';
            } else {
                speaker = msg.name || '{{char}}';
            }
            
            // 提取消息内容
            const content = msg.mes || msg.text || msg.content || '[无内容]';
            
            console.log(`[ghost] 消息 ${index + 1}: ${speaker} - ${content.slice(0, 50)}...`);
            
            return `${speaker}: ${content}`;
        })
        .join('\n');

    const optimized_prompt = `你是一个专业且充满热心的故事总结助手，请从对话中提取可复用剧情细节：

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

    console.log('[ghost] 提示词长度:', optimized_prompt.length);
    
    try {
        const context = await getContext();
        console.log('[ghost] 调用 generateQuietPrompt...');
        
        const result = await context.generateQuietPrompt(
            optimized_prompt,
            true,      // quiet 模式
            false,     // 不注入世界书
            "你是一个专业的故事总结助手"
        );
        
        console.log('[ghost] AI 返回结果:', result ? result.slice(0, 200) + '...' : 'null');
        
        return parseModelOutput(result);
    } catch (error) {
        console.error('[ghost] generateSummary 详细错误:', {
            error: error.message,
            stack: error.stack,
            promptLength: optimized_prompt.length
        });
        throw new Error("总结生成失败: " + error.message);
    }
}
