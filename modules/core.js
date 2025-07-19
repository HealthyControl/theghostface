// core.js
import {getContext,extension_settings,} from '../../../../extensions.js';
import {chat_metadata, getMaxContextSize, generateRaw,streamingProcessor,main_api,system_message_types,saveSettingsDebounced,getRequestHeaders,saveChatDebounced,chat,this_chid,characters,reloadCurrentChat,} from '../../../../../script.js';
import { createWorldInfoEntry,deleteWIOriginalDataValue,deleteWorldInfoEntry,importWorldInfo,loadWorldInfo,saveWorldInfo,world_info} from '../../../../world-info.js';
import { eventSource, event_types } from '../../../../../script.js';
import { download, debounce, initScrollHeight, resetScrollHeight, parseJsonFile, extractDataFromPng, getFileBuffer, getCharaFilename, getSortableDelay, escapeRegex, PAGINATION_TEMPLATE, navigation_option, waitUntilCondition, isTrueBoolean, setValueByPath, flashHighlight, select2ModifyOptions, getSelect2OptionId, dynamicSelect2DataViaAjax, highlightRegex, select2ChoiceClickSubscribe, isFalseBoolean, getSanitizedFilename, checkOverwriteExistingData, getStringHash, parseStringArray, cancelDebounce, findChar, onlyUnique, equalsIgnoreCaseAndAccents } from '../../../../utils.js';

import * as ui from './ui.js';
import * as utils from './utils.js';
import * as pig from './pig.js';

let systemInitialized = false;
// 消息监听器部分开始👇

// 消息监听器设置
export function setupMessageListener() {
    // 防止重复绑定
    if (window.ghostFaceListenersAttached) {
        logger.warn('🔧 消息监听器已绑定，跳过重复绑定');
        return;
    }
    
    // 检查ST官方事件系统是否可用
    if (typeof eventOn === 'function' && typeof tavern_events === 'object') {
        // 1. 监听聊天切换事件（只绑定一次）
        eventOn(tavern_events.CHAT_CHANGED, handleChatChange); 
        // 2. 防抖处理器 - 避免频繁触发
        let debounceTimer = null;
        const handleNewMessageDebounced = (eventName) => {
            clearMessageCountCache(); // 清除缓存，确保下次获取最新数据
            logger.debug(`📨 消息事件触发: ${eventName}, 开始4秒防抖...`);
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(async () => {
                logger.debug(`防抖结束，开始检查自动触发...`);
                
                // 多重检查防止重复
                if (isAutoSummarizing) {
                    logger.debug('自动总结进行中，跳过本次检查');
                    return;
                }
                
                // 时间间隔检查
                const now = Date.now();
                if (window.lastAutoTriggerCheck && (now - window.lastAutoTriggerCheck) < 5000) {
                    logger.debug('距离上次检查时间过短，跳过');
                    return;
                }
                window.lastAutoTriggerCheck = now;
                
                try {
                    await checkAutoTrigger();
                } catch (error) {
                    logger.error('自动触发检查失败:', error);
                }
            }, 4000);
        };
        
        // 3. 监听所有相关的消息事件
        const messageEventKeys = [
            'MESSAGE_SENT',
            'MESSAGE_RECEIVED',
            'GENERATION_ENDED',
            'STREAM_TOKEN_RECEIVED',
            'MESSAGE_SWIPED',
            'MESSAGE_DELETED'
        ];
        
        let attachedEvents = 0;
        messageEventKeys.forEach(key => {
            if (tavern_events[key]) {
                eventOn(tavern_events[key], () => handleNewMessageDebounced(key));
                attachedEvents++;
                logger.debug(`✅ 已绑定事件: ${key}`);
            } else {
                logger.warn(`⚠️ 事件不存在: ${key}`);
            }
        });
        
        logger.info(`🔧 成功绑定 ${attachedEvents} 个消息事件监听器`);
        
        // 4. 备用轮询（频率较低）
        setInterval(() => {
            logger.debug('⏰ 备用轮询检查...');
            if (!isAutoSummarizing) {
                checkAutoTrigger().catch(error => {
                    logger.error('⏰ 备用轮询检查失败:', error);
                });
            }
        }, 60000);
        
    } else {
        // 降级方案：使用DOM事件监听
        
        const observer = new MutationObserver((mutations) => {
            for (let mutation of mutations) {
                if (mutation.type === 'childList') {
                    for (let node of mutation.addedNodes) {
                        if (node.nodeType === Node.ELEMENT_NODE && 
                            (node.classList?.contains('mes') || 
                             node.querySelector?.('.mes'))) {
                            setTimeout(checkAutoTrigger, 2000);
                            break;
                        }
                    }
                }
            }
        });
        
        const chatContainer = document.querySelector('#chat') || 
                            document.querySelector('.chat') ||
                            document.body;
        
        if (chatContainer) {
            observer.observe(chatContainer, {
                childList: true,
                subtree: true
            });
        }
        
        setInterval(checkAutoTrigger, 15000);
    }
    
    // 🆕 标记监听器已绑定
    window.ghostFaceListenersAttached = true;
    
}

// 自动触发检测函数
export async function checkAutoTrigger() {
    // 基础检查
    if (!autoTriggerEnabled || isAutoSummarizing) {
        return;
    }
    
    // 🆕 全局锁防止并发
    if (window.isCheckingAutoTrigger) {
        logger.debug('🎯 自动触发检查已在进行中，跳过');
        return;
    }
    
    window.isCheckingAutoTrigger = true;
    
    try {
        const context = await getContext();
        const messages = getMessageArray(context);
        const currentCount = await getCachedMessageCount();

        // 首次初始化
        if (lastMessageCount === 0) {
            lastMessageCount = currentCount;
            logger.info(`🎯 初始化消息计数: ${currentCount}`);
            return;
        }
        
        // 无新消息检查
        if (currentCount <= lastMessageCount) {
            logger.debug(`🎯 无新消息 (当前: ${currentCount}, 上次: ${lastMessageCount})`);
            lastMessageCount = currentCount;
            return;
        }

        const newMessageCount = currentCount - lastMessageCount;
        logger.info(`🎯 检测到 ${newMessageCount} 条新消息 (总数: ${currentCount})`);
        
        // 阈值检查
        if (newMessageCount >= userThreshold) {
            logger.info(`🤖 达到自动触发阈值 ${userThreshold}，开始总结...`);
            
            // 🆕 立即设置标志防止重复
            isAutoSummarizing = true;
            
            toastr.info(`👻 鬼面检测到 ${newMessageCount} 条新消息，准备自动总结...`, null, {
                timeOut: 3000,
                closeButton: true,
                progressBar: true
            });
            
            try {
                await stealthSummarize(false, true);
                logger.info('🤖 自动总结完成');
            } catch (error) {
                logger.error('🤖 自动总结失败:', error);
            } finally {
                isAutoSummarizing = false;
            }
        } else {
            logger.debug(`🎯 新消息数 ${newMessageCount} 未达到阈值 ${userThreshold}`);
        }

        lastMessageCount = currentCount;

    } catch (error) {
        logger.error('🤖 自动触发检测失败:', error);
    } finally {
        // 🆕 释放锁
        window.isCheckingAutoTrigger = false;
    }
}

// 消息监听器部分结束👆

// 自动触发相关变量
export let lastMessageCount = 0;
export let autoTriggerEnabled = false;
export const AUTO_TRIGGER_THRESHOLD = 10;
export let isAutoSummarizing = false;


export let userThreshold =4;
export let userInterval = 10;
export let keepMessagesCount = 2;

// 主要总结函数
export async function stealthSummarize(isInitial = false, isAutoTriggered = false, startIndex = null, endIndex = null) {
    const triggerType = isAutoTriggered ? '自动触发' : 
                       (startIndex !== null ? '手动范围' : '手动触发');
    logger.info(`[鬼面] === 开始总结流程 (${triggerType}) ===`);
    
    const notificationText = isAutoTriggered ? 
        "🤖 鬼面&门徒智能防重复尾随中..." : 
        (startIndex !== null ? `👻 鬼面&门徒智能总结第${startIndex+1}-${endIndex+1}楼...` : "👻 鬼面&门徒智能尾随中...");
    
    const notification = toastr.info(notificationText, null, {
        timeOut: 5000,
        closeButton: true,
        progressBar: true,
        hideDuration: 0,
        positionClass: "toast-top-center"
    });

    try {
        const activeBook = await utils.findActiveWorldBook();
        logger.info('[鬼面] 第1步: 开始收集消息...');
        
        const messages = await getGhostContextMessages(isInitial, startIndex, endIndex);
        
        if (!messages || messages.length === 0) {
            logger.warn('[鬼面] ⚠️ 没有找到可总结的消息');
            const warningText = triggerType === '自动触发' ? 
                "自动总结：没有找到可总结的消息" : 
                "没有找到可总结的消息，鬼面愤怒拔线了...";
            toastr.warning(warningText);
            return;
        }

        logger.info(`[鬼面] 第1步完成: 收集到 ${messages.length} 条消息`);

        // 🆕 第1.5步：让门徒配合分析
        if (typeof ThePigCore !== 'undefined' && ThePigCore.integrateWithGhost) {
            logger.info('[鬼面] 第1.5步: 门徒开始配合分析...');
            // 根据总结类型选择门徒模式
            const pigMode = isAutoTriggered ? 'auto' : 
                           (startIndex !== null ? 'ghost' : 'manual');
            
            // 异步调用，不阻塞鬼面
            ThePigCore.integrateWithGhost(messages, pigMode).catch(error => {
                logger.warn('🐷 门徒配合分析失败:', error);
            });
        }

        const summaryContent = await generateSummary(messages);
        
        if (!summaryContent?.trim()) {
            logger.info('[鬼面] ✅ AI智能判断：没有新信息需要记录');
            const infoText = triggerType === '自动触发' ? 
                "🧠 智能检测：没有新信息，跳过总结" : 
                "🧠 智能检测：没有新信息，鬼面很满意现有记录";
            toastr.info(infoText);
            return;
        }

        logger.info(`[鬼面] 第2步完成: 发现新信息，总结长度 ${summaryContent.length} 字符`);

        logger.info('[鬼面] 第3步: 开始保存到世界书...');
        const updateResult = await saveToWorldBook(summaryContent, startIndex, endIndex);
        logger.info('[鬼面] 第3步完成: 已保存到世界书');
        
        // 第4步：隐藏逻辑保持不变
        if (startIndex !== null && endIndex !== null) {
            logger.info('[鬼面] 第4步: 开始隐藏已总结楼层...');
            
            await new Promise(resolve => setTimeout(resolve, 500));
            
            const hideSuccess = await hideMessagesRange(startIndex, endIndex);
            
            if (hideSuccess) {
                logger.info(`[鬼面] 第4步完成: 已隐藏并保存第${startIndex+1}-${endIndex+1}楼`);
            } else {
                logger.warn(`[鬼面] 第4步警告: 隐藏操作失败`);
            }
        } else {
            markMessagesSummarized(messages);
            logger.info('[鬼面] 第4步完成: 已标记消息（未隐藏）');
        }
        
        const successText = triggerType === '自动触发' ? 
            `🧠 鬼面&门徒智能总结完成！${updateResult.created}个新条目，${updateResult.updated}个更新` : 
            (startIndex !== null ? 
                `👻 鬼面&门徒总结完成！第${startIndex+1}-${endIndex+1}楼已隐藏` :
                "👻 鬼面&门徒把新信息都记录好了！");
        toastr.success(successText);
        logger.info(`[鬼面] === 总结成功完成 (${triggerType}) ===`);

    } catch (err) {
        logger.error(`[鬼面] === 总结流程失败 (${triggerType}) ===`);
        logger.error('[鬼面] 错误详情:', err);
        const errorText = triggerType === '自动触发' ? 
            "总结失败: " + err.message : 
            "尾随被看破: " + err.message;
        toastr.error(errorText);
        
    } finally {
        toastr.remove(notification);
        logger.info(`[鬼面] === 防重复总结流程结束 (${triggerType}) ===`);
    }
}

// 工具函数：统一获取消息数组
export function getMessageArray(source) {
    console.log('🔍 [getMessageArray] 输入源:', source);
    console.log('🔍 [getMessageArray] 源类型:', typeof source);
    
    // 方法1：检查标准的聊天数组属性
    if (source?.chat && Array.isArray(source.chat)) {
        console.log('🔍 [getMessageArray] 使用 source.chat，长度:', source.chat.length);
        return source.chat;
    }
    
    if (source?.messages && Array.isArray(source.messages)) {
        console.log('🔍 [getMessageArray] 使用 source.messages，长度:', source.messages.length);
        return source.messages;
    }
    
    // 方法2：如果source本身就是数组
    if (Array.isArray(source)) {
        console.log('🔍 [getMessageArray] 源本身是数组，长度:', source.length);
        return source;
    }
    
    // 方法3：检查其他可能的属性
    if (source?.chatHistory && Array.isArray(source.chatHistory)) {
        console.log('🔍 [getMessageArray] 使用 source.chatHistory，长度:', source.chatHistory.length);
        return source.chatHistory;
    }
    
    if (source?.history && Array.isArray(source.history)) {
        console.log('🔍 [getMessageArray] 使用 source.history，长度:', source.history.length);
        return source.history;
    }
    
    // 🔧 方法4：安全地尝试从全局变量获取
    try {
        if (typeof window !== 'undefined' && window.chat && Array.isArray(window.chat)) {
            console.log('🔍 [getMessageArray] 使用 window.chat，长度:', window.chat.length);
            return window.chat;
        }
        
        // 🆕 也尝试直接的 chat 变量（如果在作用域内）
        if (typeof chat !== 'undefined' && Array.isArray(chat)) {
            console.log('🔍 [getMessageArray] 使用全局 chat 变量，长度:', chat.length);
            return chat;
        }
    } catch (e) {
        console.warn('🔍 [getMessageArray] 访问全局chat变量失败:', e.message);
    }
    
    // 方法5：从DOM获取（最后的备用方案）
    try {
        const messageElements = document.querySelectorAll('.mes');
        if (messageElements.length > 0) {
            console.log('🔍 [getMessageArray] 从DOM获取消息元素，长度:', messageElements.length);
            // 转换为简单的消息对象数组
            return Array.from(messageElements).map((el, index) => ({
                mes: el.querySelector('.mes_text')?.textContent || '',
                name: el.querySelector('.name_text')?.textContent || 'Unknown',
                is_system: el.classList.contains('is_system'),
                index: index
            }));
        }
    } catch (e) {
        console.warn('🔍 [getMessageArray] DOM查询失败:', e.message);
    }
    
    // 如果有封装对象，记录详细信息
    if (source && typeof source === 'object' && typeof source.generateQuietPrompt === 'function') {
        console.warn('🔍 [getMessageArray] getContext 返回封装对象，属性:', Object.keys(source));
        console.warn('🔍 [getMessageArray] 可能的消息相关属性:', 
            Object.keys(source).filter(key => 
                key.toLowerCase().includes('chat') || 
                key.toLowerCase().includes('message') || 
                key.toLowerCase().includes('history')
            )
        );
    }

    console.warn('🔍 [getMessageArray] 无法从任何源获取消息数组');
    return [];
}

// 🔧 简化的消息计数获取函数
export async function getCurrentMessageCount() {
    try {
        console.log('📊 [getCurrentMessageCount] 开始获取消息计数...');
        
        // 🎯 直接使用 getMessageArray，避免重复逻辑
        const context = await getContext();
        const messages = getMessageArray(context);
        
        const count = messages ? messages.length : 0;
        console.log('📊 [getCurrentMessageCount] 最终计数:', count);
        
        return count;
        
    } catch (error) {
        console.error('📊 [getCurrentMessageCount] 获取失败:', error);
        
        // 🆕 错误时的备用方案
        try {
            const fallbackMessages = getMessageArray(null); // 让它走全局变量和DOM的路径
            const fallbackCount = fallbackMessages ? fallbackMessages.length : 0;
            console.warn('📊 [getCurrentMessageCount] 使用备用方案，计数:', fallbackCount);
            return fallbackCount;
        } catch (fallbackError) {
            console.error('📊 [getCurrentMessageCount] 备用方案也失败:', fallbackError);
            return 0;
        }
    }
}

// 🆕 添加一个同步版本的快速计数（不需要await）
export function getMessageCountSync() {
    try {
        // 尝试从全局变量
        if (typeof window !== 'undefined' && window.chat && Array.isArray(window.chat)) {
            return window.chat.length;
        }
        
        if (typeof chat !== 'undefined' && Array.isArray(chat)) {
            return chat.length;
        }
        
        // 尝试从DOM
        const messageElements = document.querySelectorAll('.mes');
        return messageElements.length;
        
    } catch (error) {
        console.warn('📊 [getMessageCountSync] 同步获取失败:', error);
        return 0;
    }
}

// 🆕 添加一个带缓存的版本（避免频繁查询）
let messageCountCache = null;
let lastCacheTime = 0;
const CACHE_DURATION = 5000; // 5秒缓存

export async function getCachedMessageCount() {
    const now = Date.now();
    
    // 如果缓存还有效，直接返回
    if (messageCountCache !== null && (now - lastCacheTime) < CACHE_DURATION) {
        console.log('📊 [getCachedMessageCount] 使用缓存:', messageCountCache);
        return messageCountCache;
    }
    
    // 获取新的计数并缓存
    const count = await getCurrentMessageCount();
    messageCountCache = count;
    lastCacheTime = now;
    
    console.log('📊 [getCachedMessageCount] 更新缓存:', count);
    return count;
}

// 🆕 清除缓存的函数（在消息发生变化时调用）
export function clearMessageCountCache() {
    messageCountCache = null;
    lastCacheTime = 0;
    console.log('📊 [clearMessageCountCache] 缓存已清除');
}

// 初始化函数
export async function initializeGhostFace() {
    if (window.ghostFaceInitialized) {
        return;
    }
    
    console.log('🚀 [鬼面&门徒] 开始初始化...');
    
    try {
        // 等待ST就绪
        console.log('⏳ 等待ST核心系统就绪...');
        const isReady = await waitForSTReady();
        
        if (!isReady) {
            console.log('⚠️ ST系统未就绪，延迟初始化');
            setTimeout(() => {
                window.ghostFaceInitialized = false;
                initializeGhostFace();
            }, 5000);
            return;
        }
        
        // 基础初始化
        loadSavedTheme();
        currentTheme = extension_settings.the_ghost_face?.theme || 'cyberpunk';
        
        await createGhostControlPanel();
        addGhostMenuItem();
        setupMessageListener();
        setupWorldBookListener();
        
        // 设置系统初始化状态为 true
        if (typeof utils !== 'undefined' && utils.setSystemInitialized) {
            utils.setSystemInitialized(true);
        }
        
        // 🆕 智能世界书初始化（新增！）
        console.log('🌍 开始智能世界书初始化...');
        setTimeout(async () => {
            try {
                await smartWorldBookInit();
                console.log('🌍 智能世界书初始化完成');
            } catch (error) {
                console.warn('🌍 智能世界书初始化失败:', error);
            }
        }, 2000);
        
        // 延迟初始化其他组件
        setTimeout(() => {
            insertPigPanel();
            setupPanelEvents();
            loadUserSettings();
            updatePanelWithCurrentData();
            updateMessageCount();
        }, 300);

        window.ghostFaceInitialized = true;
        logger.success('👻 鬼面和门徒已就位，快来蹲起招手发起决斗邀请吧！'); 
        
    } catch (error) {
        console.error('❌ [鬼面] 初始化失败:', error);
        window.ghostFaceInitialized = false;
    }
}

//扩展目录定位
export function get_extension_directory() {
    let index_path = new URL(import.meta.url).pathname;
    // 从modules文件夹返回上级目录
    let extension_path = index_path.substring(0, index_path.lastIndexOf('/'));
    // 如果在modules文件夹，需要返回上级
    if (extension_path.endsWith('/modules')) {
        extension_path = extension_path.substring(0, extension_path.lastIndexOf('/'));
    }
    return extension_path;
}

//保存聊天
export async function saveChat() {
    try {
        
        // 🎯 方法1：使用官方防抖保存（推荐）
        if (typeof saveChatDebounced === 'function') {
            saveChatDebounced();
            
            // 等待防抖完成
            await new Promise(resolve => setTimeout(resolve, 1500));
            return true;
        }
        
        // 🎯 方法2：使用官方条件保存
        if (typeof saveChatConditional === 'function') {
            await saveChatConditional();
            return true;
        }
        
        return false;
        
    } catch (error) {
        logger.error('🪼调用官方保存函数失败:', error);
        return false;
    }
}

// 安全的保存聊天函数
export async function refreshChatDisplay() {
    try {
        logger.debug('🪼刷新聊天显示...');
        
        // 方法1：触发界面更新事件
        if (typeof eventSource !== 'undefined' && eventSource.emit) {
            eventSource.emit('chatChanged');
            logger.debug('🪼触发了chatChanged事件');
        }
        
        // 方法2：调用ST的UI更新函数
        if (typeof window.SillyTavern?.ui?.updateChatScroll === 'function') {
            window.SillyTavern.ui.updateChatScroll();
            logger.debug('🪼调用了ST UI更新');
        }
        
        // 方法3：手动同步DOM状态
        const context = await getContext();
        const messages = getMessageArray(context);
        
        // 更新所有消息元素的显示状态
        for (let i = 0; i < messages.length; i++) {
            const msg = messages[i];
            const messageElement = document.querySelector(`.mes[mesid="${i}"]`);
            
            if (messageElement && msg) {
                const shouldHide = msg.is_system === true;
                
                messageElement.setAttribute('is_system', shouldHide.toString());
                
                if (shouldHide) {
                    messageElement.style.display = 'none';
                    messageElement.setAttribute('data-ghost-hidden', 'true');
                } else {
                    messageElement.style.display = '';
                    messageElement.removeAttribute('data-ghost-hidden');
                }
            }
        }
        
        logger.debug('🪼聊天显示已刷新');
        
    } catch (error) {
        logger.error('🪼刷新聊天显示失败:', error);
    }
}

// 启动时恢复隐藏状态的函数
export async function restoreHiddenStateOnStartup() {
        if (this_chid === undefined || this_chid === null) {
        return; // 如果没有角色，就直接结束，不往下执行
    }
    try {
        const context = await getContext();
        const messages = getMessageArray(context);
        
        if (messages.length === 0) {
            return;
        }
        
        // 获取已总结的最大楼层
        const maxSummarizedFloor = await getMaxSummarizedFloorFromWorldBook();
        
        let restoredHiddenCount = 0;
        let changesMade = false;
        
        for (let i = 0; i <= maxSummarizedFloor && i < messages.length; i++) {
            const msg = messages[i];
            if (!msg) continue;
            
            if (!msg.is_system) {
                // 需要隐藏但当前可见
                if (!msg.extra) msg.extra = {};
                msg.extra.ghost_original_is_system = msg.is_system || false;
                msg.extra.ghost_hidden = true;
                msg.is_system = true;
                restoredHiddenCount++;
                changesMade = true;
            }
        }
        
        if (changesMade) {
            logger.info(`👻 恢复了 ${restoredHiddenCount} 条消息的隐藏状态`);
            
            // 🆕 使用官方保存函数
            const saveSuccess = await saveChat();
            
            if (saveSuccess) {
                logger.info('👻 隐藏状态已保存');
            } else {
                logger.warn('👻 隐藏状态保存可能失败');
            }
            
            // 刷新显示
            await refreshChatDisplay();
            
            toastr.info(`👻 已恢复 ${restoredHiddenCount} 条消息的隐藏状态`);
        }
        
    } catch (error) {
        logger.error('👻 恢复隐藏状态失败:', error);
    }
}

//自动隐藏楼层
export async function hideMessagesRange(startIndex, endIndex) {
    try {
        logger.info(`🪼开始隐藏第 ${startIndex + 1}-${endIndex + 1} 楼...`);
        
        const context = await getContext();
        const messages = getMessageArray(context);
        
        if (!messages || messages.length === 0) {
            logger.warn('🪼没有消息可隐藏');
            return false;
        }
        
        let hiddenCount = 0;
        let changesMade = false;
        
        // 修改消息数据
        for (let i = startIndex; i <= endIndex && i < messages.length; i++) {
            const msg = messages[i];
            if (!msg) continue;
            
            // 保存原始状态
            if (!msg.extra) msg.extra = {};
            if (typeof msg.extra.ghost_original_is_system === 'undefined') {
                msg.extra.ghost_original_is_system = msg.is_system || false;
            }
            
            // 设置为系统消息（隐藏）
            if (!msg.is_system) {
                msg.is_system = true;
                msg.extra.ghost_hidden = true;
                hiddenCount++;
                changesMade = true;
                
            }
        }
        
        if (changesMade) {
            // 🆕 关键：使用官方保存函数
            logger.debug('🪼开始调用官方保存函数...');
            const saveSuccess = await saveChat();
            
            if (saveSuccess) {
                logger.info(`🪼已隐藏并保存 ${hiddenCount} 条消息 (第${startIndex + 1}-${endIndex + 1}楼)`);
                toastr.success(`🪼已隐藏第 ${startIndex + 1}-${endIndex + 1} 楼 (${hiddenCount}条消息)`);
            } else {
                logger.warn(`🪼已隐藏 ${hiddenCount} 条消息，但保存可能失败`);
                toastr.warning(`🪼已隐藏第 ${startIndex + 1}-${endIndex + 1} 楼，但保存状态未知`);
            }
            
            // 刷新界面显示
            await refreshChatDisplay();
            
            return true;
        }
        
        return false;
        
    } catch (error) {
        logger.error('🪼隐藏消息失败:', error);
        toastr.error('隐藏消息失败: ' + error.message);
        return false;
    }
}

//聊天唯一 ID 管理
export async function getCurrentChatIdentifier() {
    try {
        // 方法1：尝试使用SillyTavern API
        if (typeof getContext === 'function') {
            const context = await getContext();
            if (context?.chatName) {
                return cleanChatName(context.chatName);
            }
        }
        
        // 方法2：从URL或DOM获取
        const chatNameElement = document.querySelector('#chat_filename') || 
                               document.querySelector('[data-chat-name]');
        if (chatNameElement) {
            const chatName = chatNameElement.textContent || chatNameElement.dataset.chatName;
            if (chatName) {
                return cleanChatName(chatName);
            }
        }
        
        // 方法3：从localStorage获取
        const savedChatName = localStorage.getItem('selected_chat');
        if (savedChatName) {
            return cleanChatName(savedChatName);
        }
        
        // 默认值
        return `unknown_chat_${Date.now()}`;
        
    } catch (error) {
        logger.error('获取聊天标识符失败:', error);
        return `fallback_chat_${Date.now()}`;
    }
}

// 清理聊天名称
export function cleanChatName(fileName) {
    if (!fileName || typeof fileName !== 'string') return 'unknown_chat_source';
    let cleanedName = fileName;
    if (fileName.includes('/') || fileName.includes('\\')) {
        const parts = fileName.split(/[\/\\]/);
        cleanedName = parts[parts.length - 1];
    }
    return cleanedName.replace(/\.jsonl$/, '').replace(/\.json$/, '');
}

// 记录楼层信息的函数
export async function updateFloorTrackingEntry(worldBookData, maxFloor, currentChatIdentifier) {
    try {
        let trackingEntry = null;
        
        // 查找现有的追踪条目
        Object.values(worldBookData.entries).forEach(entry => {
            if (entry.comment === GHOST_TRACKING_COMMENT) {
                trackingEntry = entry;
            }
        });
        
        const trackingContent = `聊天标识: ${currentChatIdentifier}\n最后总结楼层: ${maxFloor + 1}\n更新时间: ${new Date().toLocaleString()}\n状态: 已完成总结`;
        
        if (trackingEntry) {
            trackingEntry.content = trackingContent;
            logger.info(`👻 更新楼层追踪: 聊天${currentChatIdentifier}已总结到第${maxFloor + 1}楼`);
        } else {
            const newTrackingEntry = createWorldInfoEntry(null, worldBookData);
            Object.assign(newTrackingEntry, {
                comment: GHOST_TRACKING_COMMENT,
                content: trackingContent,
                key: ['楼层追踪', '鬼面状态', currentChatIdentifier],
                constant: true,
                selective: false,
                disable: false,
                order: 99999 // 很高的优先级
            });
            logger.info(`🆕 创建楼层追踪条目: 聊天${currentChatIdentifier}已总结到第${maxFloor + 1}楼`);
        }
        
    } catch (error) {
        logger.error('👻 更新楼层追踪失败:', error);
    }
}

//聊天切换时的总处理
export async function handleChatChange() {
    
    try {
        // 等待ST完全就绪
        const isReady = await waitForSTReady();
        if (!isReady) {
            logger.warn('ST未完全就绪，跳过此次聊天切换处理');
            return;
        }
        
        // 🆕 第1步：自动管理世界书（新增！）
        console.log('🌍 聊天切换时自动管理世界书...');
        await autoManageWorldBook();
        
        // 🆕 第2步：等待世界书切换完成
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // 第3步：更新UI显示
        await ui.updateWorldBookDisplay();

        // 第4步：恢复消息隐藏状态
        await restoreHiddenStateOnStartup();

        // 第5步：加载门徒陷阱数据
        await pig.loadPigFromWorldBook();

        // 第6步：重置消息计数
        const context = await getContext();
        lastMessageCount = getMessageArray(context).length;
        logger.info(`🔧 聊天切换完成，新消息计数: ${lastMessageCount}`);

    } catch (error) {
        logger.error('💥 聊天切换处理流程失败:', error);
    }
}


// 等待ST加载完成
export async function waitForSTReady() {
    console.log('⏳ 等待ST完全加载...');
    
    let attempts = 0;
    const maxAttempts = 30; // 最多等30秒
    
    while (attempts < maxAttempts) {
        try {
            // 检查关键变量是否都可用
            if (typeof this_chid !== 'undefined' && 
                typeof characters !== 'undefined' && 
                typeof getContext === 'function') {
                
                console.log('✅ ST核心变量已就绪');
                
                // 进一步检查是否有角色加载
                if (this_chid !== null && this_chid !== undefined && characters[this_chid]) {
                    console.log(`✅ 角色已加载: ${characters[this_chid].name}`);
                    return true;
                } else {
                    console.log('⏳ 等待角色加载...');
                }
            }
        } catch (error) {
            console.log('⏳ ST还未完全就绪...');
        }
        
        attempts++;
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    console.log('⚠️ 等待ST就绪超时');
    return false;
}

// 自动世界书管理函数
export async function autoManageWorldBook() {
    try {
        console.log('🌍 [自动世界书] 开始自动管理世界书...');
        
        // 第1步：获取角色绑定的世界书
        const boundWorldBook = await utils.findActiveWorldBook();
        
        if (!boundWorldBook) {
            console.log('🌍 [自动世界书] 角色未绑定世界书，跳过自动管理');
            return false;
        }
        
        console.log(`🌍 [自动世界书] 检测到绑定世界书: ${boundWorldBook}`);
        
        // 第2步：检查当前选中的世界书
        const worldSelect = document.querySelector('#world_editor_select');
        let currentSelectedBook = null;
        
        if (worldSelect && worldSelect.value) {
            currentSelectedBook = worldSelect.selectedOptions[0].textContent;
        }
        
        // 第3步：如果已经选中了正确的世界书，就不需要操作
        if (currentSelectedBook === boundWorldBook) {
            console.log(`🌍 [自动世界书] 世界书已正确选中: ${boundWorldBook}`);
            return true;
        }
        
        // 第4步：自动选择正确的世界书
        console.log(`🌍 [自动世界书] 当前选中: ${currentSelectedBook || '无'}, 需要切换到: ${boundWorldBook}`);
        
        const success = await autoSelectWorldBook(boundWorldBook, worldSelect);
        
        if (success) {
            console.log(`🌍 [自动世界书] ✅ 成功自动选择世界书: ${boundWorldBook}`);
            
            // 🎉 触发相关系统更新
            setTimeout(() => {
                // 更新UI显示
                if (typeof ui.updateWorldBookDisplay === 'function') {
                    ui.updateWorldBookDisplay();
                }
                
                // 重新加载门徒数据
                if (typeof pig.loadPigFromWorldBook === 'function') {
                    pig.loadPigFromWorldBook();
                }
                
                // 触发世界书变更事件
                const event = new Event('change', { bubbles: true });
                worldSelect?.dispatchEvent(event);
                
            }, 500);
            
            return true;
        } else {
            console.warn(`🌍 [自动世界书] ❌ 无法自动选择世界书: ${boundWorldBook}`);
            return false;
        }
        
    } catch (error) {
        console.error('🌍 [自动世界书] 自动管理失败:', error);
        return false;
    }
}

// 🔧 自动选择世界书的核心函数
async function autoSelectWorldBook(targetWorldBook, worldSelect) {
    try {
        if (!worldSelect) {
            // 🆕 如果选择器不存在，尝试自动创建/等待
            console.log('🌍 [自动选择] 世界书选择器不存在，尝试导航...');
            
            // 方法1：尝试点击世界书导航
            const worldInfoTab = document.querySelector('#WI_tab') || 
                                document.querySelector('[data-tab="world_info"]') ||
                                document.querySelector('a[href="#world_info"]');
            
            if (worldInfoTab) {
                console.log('🌍 [自动选择] 点击世界书标签页...');
                worldInfoTab.click();
                
                // 等待页面加载
                await new Promise(resolve => setTimeout(resolve, 1000));
                
                // 重新获取选择器
                worldSelect = document.querySelector('#world_editor_select');
            }
            
            if (!worldSelect) {
                console.log('🌍 [自动选择] 无法访问世界书选择器');
                return false;
            }
        }
        
        // 🎯 在选择器中查找目标世界书
        const options = Array.from(worldSelect.options);
        const targetOption = options.find(option => 
            option.textContent === targetWorldBook || 
            option.value === targetWorldBook
        );
        
        if (!targetOption) {
            console.log(`🌍 [自动选择] 在选择器中未找到世界书: ${targetWorldBook}`);
            console.log('🌍 [自动选择] 可用的世界书:', options.map(opt => opt.textContent));
            return false;
        }
        
        // 🎯 自动选择
        console.log(`🌍 [自动选择] 找到目标选项，正在选择...`);
        worldSelect.value = targetOption.value;
        
        // 触发change事件
        const changeEvent = new Event('change', { bubbles: true });
        worldSelect.dispatchEvent(changeEvent);
        
        // 等待选择生效
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // 验证是否选择成功
        const newSelected = worldSelect.selectedOptions[0]?.textContent;
        if (newSelected === targetWorldBook) {
            console.log(`🌍 [自动选择] ✅ 选择成功: ${newSelected}`);
            return true;
        } else {
            console.log(`🌍 [自动选择] ❌ 选择失败，当前选中: ${newSelected}`);
            return false;
        }
        
    } catch (error) {
        console.error('🌍 [自动选择] 选择世界书时出错:', error);
        return false;
    }
}

// 🆕 智能世界书初始化 - 在系统启动时调用
export async function smartWorldBookInit() {
    console.log('🌍 [智能初始化] 开始智能世界书初始化...');
    
    // 等待ST完全加载
    let retryCount = 0;
    const maxRetries = 10;
    
    while (retryCount < maxRetries) {
        // 检查基础条件
        if (typeof this_chid !== 'undefined' && this_chid !== null && 
            typeof characters !== 'undefined' && characters[this_chid]) {
            
            console.log('🌍 [智能初始化] ST已就绪，开始自动管理世界书...');
            
            const success = await autoManageWorldBook();
            
            if (success) {
                console.log('🌍 [智能初始化] ✅ 智能世界书初始化成功！');
                return true;
            } else {
                console.log('🌍 [智能初始化] ⚠️ 世界书管理未完全成功，但继续运行');
                return false;
            }
        }
        
        console.log(`🌍 [智能初始化] 等待ST加载... (${retryCount + 1}/${maxRetries})`);
        retryCount++;
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    console.log('🌍 [智能初始化] ⚠️ ST加载超时，跳过自动世界书管理');
    return false;
}
