// worldbook.js
import {getContext,extension_settings,} from '../../../../extensions.js';
import {chat_metadata, getMaxContextSize, generateRaw,streamingProcessor,main_api,system_message_types,saveSettingsDebounced,getRequestHeaders,saveChatDebounced,chat,this_chid,characters,reloadCurrentChat,} from '../../../../../script.js';
import { createWorldInfoEntry,deleteWIOriginalDataValue,deleteWorldInfoEntry,importWorldInfo,loadWorldInfo,saveWorldInfo,world_info} from '../../../../world-info.js';
import { eventSource, event_types } from '../../../../../script.js';
import { download, debounce, initScrollHeight, resetScrollHeight, parseJsonFile, extractDataFromPng, getFileBuffer, getCharaFilename, getSortableDelay, escapeRegex, PAGINATION_TEMPLATE, navigation_option, waitUntilCondition, isTrueBoolean, setValueByPath, flashHighlight, select2ModifyOptions, getSelect2OptionId, dynamicSelect2DataViaAjax, highlightRegex, select2ChoiceClickSubscribe, isFalseBoolean, getSanitizedFilename, checkOverwriteExistingData, getStringHash, parseStringArray, cancelDebounce, findChar, onlyUnique, equalsIgnoreCaseAndAccents } from '../../../../utils.js';


import * as core from './core.js';
import * as utils from './utils.js';


//获取现有世界书内容作为上下文（防止AI重复生成）
export async function getExistingWorldBookContext() {
    try {
        // 🎯 自动获取世界书 - 如果失败就手动获取
        let worldBookName = await utils.findActiveWorldBook();
        
        if (!worldBookName) {
            // 🔄 回退到手动检测方案
            const worldSelect = document.querySelector('#world_editor_select');
            if (worldSelect && worldSelect.value) {
                worldBookName = worldSelect.selectedOptions[0].textContent;
                console.log(`🧠 手动检测到世界书: ${worldBookName}`);
            } else {
                console.log('🧠 未检测到世界书');
                return '档案库为空，这是第一次记录。';
            }
        } else {
            console.log(`🧠 自动检测到绑定世界书: ${worldBookName}`);
        }

        const worldBookData = await loadWorldInfo(worldBookName);
        
        if (!worldBookData || !worldBookData.entries) {
            console.log('🧠 世界书为空');
            return '档案库为空，这是第一次记录。';
        }

        const currentChatIdentifier = await core.getCurrentChatIdentifier();
        let contextParts = [];
        
        
        // 收集所有"我们的故事"类别的现有内容
        Object.values(worldBookData.entries).forEach(entry => {
            if (!entry || !entry.comment || entry.disable) return;
            
            if (entry.comment.startsWith('我们的故事 - ')) {
                const category = entry.comment.replace('我们的故事 - ', '');
                const content = entry.content || '';
                
                // 清理内容，移除楼层标记和时间戳，只保留实际信息
                const cleanContent = content
                    .split('\n')
                    .filter(line => {
                        const trimmed = line.trim();
                        return trimmed && 
                               !trimmed.startsWith('---') && 
                               !trimmed.includes('楼总结') &&
                               !trimmed.includes('自动总结') &&
                               !trimmed.match(/^\d{4}-\d{2}-\d{2}/);
                    })
                    .join('\n')
                    .trim();
                
                if (cleanContent) {
                    contextParts.push(`**${category}类别已记录:**\n${cleanContent}`);
                }
            }
        });

        const finalContext = contextParts.length > 0 
            ? contextParts.join('\n\n') 
            : '档案库为空，这是第一次记录。';
            
        logger.info(`🧠 已获取现有世界书上下文，长度: ${finalContext.length} 字符`);
        logger.info(`🧠 找到 ${contextParts.length} 个现有类别的记录`);
        
        return finalContext;
        
    } catch (error) {
        logger.error('🧠 获取现有世界书内容失败:', error);
        return '档案库读取失败，按新内容处理。';
    }
}

// 预定义的固定类别
export const PREDEFINED_CATEGORIES = {
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

// 创建或更新鬼面总结条目
export async function createOrUpdateGhostSummaryEntry(worldBookData, chatIdentifier, startIndex, endIndex, content) {
    try {
        const entryComment = `${GHOST_SUMMARY_PREFIX}${chatIdentifier}-${startIndex + 1}-${endIndex + 1}`;
        
        let existingEntry = null;
        Object.values(worldBookData.entries).forEach(entry => {
            if (entry.comment === entryComment) {
                existingEntry = entry;
            }
        });
        
        const entryContent = `楼层范围: ${startIndex + 1}-${endIndex + 1}\n聊天: ${chatIdentifier}\n时间: ${new Date().toLocaleString()}\n\n${content}`;
        
        if (existingEntry) {
            existingEntry.content = entryContent;
            logger.info(`👻 更新鬼面总结条目: ${entryComment}`);
        } else {
            const newEntry = createWorldInfoEntry(null, worldBookData);
            Object.assign(newEntry, {
                comment: entryComment,
                content: entryContent,
                key: [`总结${startIndex + 1}${endIndex + 1}`, chatIdentifier, '鬼面'],
                constant: true,
                selective: false,
                disable: false,
                order: 1000 + endIndex, // 按楼层排序
                position: 0
            });
            logger.info(`鬼面在创建总结条目: ${entryComment}`);
        }
        
    } catch (error) {
        logger.error('👻 创建/更新鬼面总结条目失败:', error);
    }
}

// 管理鬼面总结条目激活状态
export async function manageGhostSummaryEntries(worldBookName, currentChatIdentifier) {
    try {
        const worldBookData = await loadWorldInfo(worldBookName);
        if (!worldBookData || !worldBookData.entries) return;
        
        const entriesToUpdate = [];
        
        Object.values(worldBookData.entries).forEach(entry => {
            if (entry.comment && entry.comment.startsWith(GHOST_SUMMARY_PREFIX)) {
                const isForCurrentChat = entry.comment.includes(currentChatIdentifier);
                
                // 当前聊天的条目启用，其他聊天的条目禁用
                if (isForCurrentChat && entry.disable) {
                    entriesToUpdate.push({ ...entry, disable: false });
                    logger.info(`✅ 启用当前聊天的总结条目: ${entry.comment}`);
                } else if (!isForCurrentChat && !entry.disable) {
                    entriesToUpdate.push({ ...entry, disable: true });
                    logger.info(`❌ 禁用其他聊天的总结条目: ${entry.comment}`);
                }
            }
        });
        
        if (entriesToUpdate.length > 0) {
            await saveWorldInfo(worldBookName, worldBookData, true);
            logger.info(`👻 已更新 ${entriesToUpdate.length} 个总结条目的激活状态`);
        }
        
    } catch (error) {
        logger.error('👻 管理总结条目激活状态失败:', error);
    }
}

// 智能更新世界书函数
export async function saveToWorldBook(summaryContent, startIndex = null, endIndex = null) {
    console.log('[鬼面] === 鬼面开始往世界书里写字 ===');

    try {
        // 🎯 自动获取世界书 - 如果失败就手动获取
        let worldBookName = await utils.findActiveWorldBook();
        
        if (!worldBookName) {
            // 🔄 回退到手动检测方案
            const worldSelect = document.querySelector('#world_editor_select');
            if (worldSelect && worldSelect.value) {
                worldBookName = worldSelect.selectedOptions[0].textContent;
                console.log(`[鬼面] 手动检测到世界书: ${worldBookName}`);
            } else {
                throw new Error('请先在 World Info 页面选择一个世界书，或确保角色已绑定世界书');
            }
        } else {
            console.log(`[鬼面] 自动检测到绑定世界书: ${worldBookName}`);
        }

        const currentChatFileIdentifier = await core.getCurrentChatIdentifier();
        console.log('[鬼面] 当前聊天标识:', currentChatFileIdentifier);

        const worldBookData = await loadWorldInfo(worldBookName);
        if (!worldBookData) {
            throw new Error('无法加载世界书数据');
        }

        logger.info('[鬼面] 开始解析总结内容...');
        const summaryLines = summaryContent.split('\n').filter(line => line.trim());

        const categorizedData = {};
        summaryLines.forEach((line) => {
            const match = line.match(/^\[(.+?)\]\s*(.+)$/);
            if (match) {
                const [, category, content] = match;
                if (!categorizedData[category]) {
                    categorizedData[category] = [];
                }
                categorizedData[category].push(content.trim());
            }
        });

        if (Object.keys(categorizedData).length === 0) {
            throw new Error('没有找到有效的分类数据');
        }

        let createdCount = 0;
        let updatedCount = 0;

        // 🔧 改进的现有条目查找逻辑
        const existingEntries = new Map();
        const debugInfo = [];
        
        if (worldBookData.entries) {
            Object.values(worldBookData.entries).forEach((entry, index) => {
                if (!entry || !entry.comment) return;
                
                const comment = String(entry.comment).trim();
                debugInfo.push(`条目${index}: "${comment}"`);
                
                // 🎯 更精确的匹配逻辑
                if (comment.startsWith('我们的故事 - ')) {
                    existingEntries.set(comment, entry);
                    logger.debug(`[鬼面] 找到现有条目: "${comment}"`);
                }
            });
        }
        
        logger.info(`[鬼面] 扫描完成: 找到 ${existingEntries.size} 个现有"我们的故事"条目`);
        logger.debug('[鬼面] 所有条目清单:', debugInfo);

        // 🧠 处理分类数据条目 - 增强版智能去重
        for (const [category, items] of Object.entries(categorizedData)) {
            logger.info(`[鬼面] 🧠 增强智能处理类别"${category}"，包含${items.length}个项目`);

            const targetComment = `我们的故事 - ${category}`;
            logger.info(`[鬼面] 查找目标条目: "${targetComment}"`);

            // 🔧 更严格的查找逻辑
            let existingEntry = existingEntries.get(targetComment);
            
            // 🆕 如果精确匹配失败，尝试模糊匹配
            if (!existingEntry) {
                logger.warn(`[鬼面] 精确匹配失败，尝试模糊匹配...`);
                for (const [comment, entry] of existingEntries) {
                    if (comment.includes(category)) {
                        logger.info(`[鬼面] 模糊匹配成功: "${comment}" 包含 "${category}"`);
                        existingEntry = entry;
                        break;
                    }
                }
            }

            // 🧱 准备标签内容（带楼层信息）
            const floorTag = (typeof startIndex === 'number' && typeof endIndex === 'number')
                ? `--- 第${startIndex + 1}-${endIndex + 1}楼总结 ---`
                : `--- 自动总结 (${new Date().toLocaleString()}) ---`;

            try {
                if (existingEntry) {
                    logger.info(`[鬼面] 🧠 找到现有条目，开始增强智能去重: "${targetComment}"`);
                    
                    // 🧼 增强版智能去重逻辑 - 跨行检测
                    const existingContent = existingEntry.content || '';
                    
                    // 🆕 提取所有实际内容行（排除楼层标记和时间戳）
                    const existingContentLines = existingContent.split('\n')
                        .map(line => line.trim())
                        .filter(line => {
                            return line.length > 0 && 
                                   !line.startsWith('---') && 
                                   !line.includes('楼总结') &&
                                   !line.includes('自动总结') &&
                                   !line.match(/^\d{4}-\d{2}-\d{2}/); // 过滤时间戳
                        });

                    const newLines = items.filter(item => item.trim().length > 0);

                    logger.debug(`[鬼面] 🧠 现有内容行数: ${existingContentLines.length}, 新内容行数: ${newLines.length}`);

                    // 🆕 使用增强的智能相似度检测
                    const uniqueNewLines = newLines.filter(newLine => {
                        const isDuplicate = existingContentLines.some(existingLine => {
                            const similar = isContentSimilar(newLine, existingLine);
                            if (similar) {
                                logger.debug(`[鬼面] 🧠 检测到语义重复:`);
                                logger.debug(`[鬼面] 🧠   新内容: "${newLine}"`);
                                logger.debug(`[鬼面] 🧠   现有内容: "${existingLine}"`);
                            }
                            return similar;
                        });
                        
                        return !isDuplicate;
                    });

                    if (uniqueNewLines.length > 0) {
                        // 🔧 确保comment字段正确设置
                        existingEntry.comment = targetComment;
                        existingEntry.content += `\n${floorTag}\n` + uniqueNewLines.join('\n');
                        updatedCount++;
                        logger.info(`[鬼面] 🧠 增强智能更新条目"${category}"，添加了${uniqueNewLines.length}行新内容 (智能过滤了${newLines.length - uniqueNewLines.length}行语义重复)`);
                        
                        // 🆕 显示过滤的重复内容
                        const filteredLines = newLines.filter(line => !uniqueNewLines.includes(line));
                        if (filteredLines.length > 0) {
                            logger.debug(`[鬼面] 🧠 被智能过滤的重复内容: ${filteredLines.join(', ')}`);
                        }
                    } else {
                        logger.info(`[鬼面] 🧠 条目"${category}"的所有内容都被检测为语义重复，跳过更新`);
                    }

                } else {
                    logger.info(`[鬼面] 🆕 创建全新条目"${category}"`);

                    const newEntry = createWorldInfoEntry(null, worldBookData);
                    if (!newEntry) {
                        logger.error('[鬼面] createWorldInfoEntry 返回 null');
                        continue;
                    }

                    // 🔧 使用预定义配置或默认配置
                    const predefinedConfig = PREDEFINED_CATEGORIES[category] || {
                        comment: targetComment,
                        key: [category],
                        order: 100
                    };

                    const newContentWithTag = `${floorTag}\n${items.join('\n')}`;

                    Object.assign(newEntry, {
                        comment: targetComment, // 🎯 确保使用标准化的comment
                        content: newContentWithTag,
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

                    // 🆕 立即添加到existingEntries Map中，防止下次重复创建
                    existingEntries.set(targetComment, newEntry);
                    createdCount++;
                    logger.info(`[鬼面] ✅ 新条目"${category}"创建成功 (UID: ${newEntry.uid})`);
                }

            } catch (entryError) {
                logger.error(`[鬼面] ❌ 处理条目"${category}"失败:`, entryError);
                continue;
            }
        }

        // 🆕 更新楼层追踪条目
        if (typeof startIndex === 'number' && typeof endIndex === 'number') {
            await updateFloorTrackingEntry(worldBookData, endIndex, currentChatFileIdentifier);
        }

        if (createdCount === 0 && updatedCount === 0) {
            logger.warn('[鬼面] 没有新内容需要保存');
            return { created: 0, updated: 0 };
        }

        logger.info('[鬼面] 开始保存世界书...');
        await saveWorldInfo(worldBookName, worldBookData, true);
        logger.info('[鬼面] ✅ 世界书保存成功');

        // 🆕 管理鬼面总结条目的激活状态
        await manageGhostSummaryEntries(worldBookName, currentChatFileIdentifier);

        // 🆕 强制刷新世界书界面
        setTimeout(() => {
            const event = new Event('change', { bubbles: true });
            document.querySelector('#world_editor_select')?.dispatchEvent(event);
            
            // 🆕 额外的界面刷新
            if (typeof reloadEditor === 'function') {
                reloadEditor();
            }
        }, 500);

        return { created: createdCount, updated: updatedCount };

    } catch (error) {
        logger.error('[鬼面] 世界书保存失败:', error);
        throw error;
    }
}

// 🔧 从世界书获取已总结的最大楼层
export async function getMaxSummarizedFloorFromWorldBook() {
    try {
        // 🎯 自动获取世界书 - 如果失败就手动获取
        let worldBookName = await utils.findActiveWorldBook();
        
        if (!worldBookName) {
            // 🔄 回退到手动检测方案
            const worldSelect = document.querySelector('#world_editor_select');
            if (worldSelect && worldSelect.value) {
                worldBookName = worldSelect.selectedOptions[0].textContent;
                console.log(`🔍 手动检测到世界书: ${worldBookName}`);
            } else {
                console.log('🔍 未检测到世界书');
                return -1;
            }
        } else {
            console.log(`🔍 自动检测到绑定世界书: ${worldBookName}`);
        }
        
        const currentChatIdentifier = await core.getCurrentChatIdentifier();
        const worldBookData = await loadWorldInfo(worldBookName);
                
        if (!worldBookData || !worldBookData.entries) {
            logger.debug('🔍 世界书数据为空');
            return -1;
        }
        
        let maxFloor = -1;
        let foundTrackingEntry = false;
        let foundSummaryEntries = 0;
        
        // 🥇 优先方法1：查找追踪条目
        Object.values(worldBookData.entries).forEach(entry => {
            if (entry.comment === GHOST_TRACKING_COMMENT) {
                foundTrackingEntry = true;
                const content = entry.content || '';
                const match = content.match(/最后总结楼层:\s*(\d+)/);
                if (match) {
                    const floorNum = parseInt(match[1]) - 1; // 转为0-based
                    maxFloor = Math.max(maxFloor, floorNum);
                    logger.debug(`🔍 从追踪条目找到楼层: ${floorNum + 1}`);
                }
            }
        });
        
        // 🥈 备用方法2：从鬼面总结条目解析
        if (maxFloor === -1) {
            Object.values(worldBookData.entries).forEach(entry => {
                if (entry.comment && 
                    entry.comment.startsWith(GHOST_SUMMARY_PREFIX) && 
                    entry.comment.includes(currentChatIdentifier) &&
                    !entry.disable) {
                    
                    foundSummaryEntries++;
                    const match = entry.comment.match(/-(\d+)-(\d+)$/);
                    if (match) {
                        const endFloor = parseInt(match[2]) - 1; // 转为0-based
                        maxFloor = Math.max(maxFloor, endFloor);
                        logger.debug(`🔍 从总结条目找到楼层: ${endFloor + 1} (条目: ${entry.comment})`);
                    }
                }
            });
        }
        
        logger.info(`🔍 分析结果: 追踪条目=${foundTrackingEntry}, 总结条目=${foundSummaryEntries}, 最大楼层=${maxFloor + 1}`);
        return maxFloor;
        
    } catch (error) {
        logger.error('🔍 从世界书获取总结状态失败:', error);
        return -1;
    }
}

export const GHOST_SUMMARY_PREFIX = "鬼面总结-";
export const GHOST_TRACKING_COMMENT = "鬼面楼层追踪记录";

