// pig.js
import {getContext,extension_settings,} from '../../../../extensions.js';
import {chat_metadata, getMaxContextSize, generateRaw,streamingProcessor,main_api,system_message_types,saveSettingsDebounced,getRequestHeaders,saveChatDebounced,chat,this_chid,characters,reloadCurrentChat,} from '../../../../../script.js';
import { createWorldInfoEntry,deleteWIOriginalDataValue,deleteWorldInfoEntry,importWorldInfo,loadWorldInfo,saveWorldInfo,world_info} from '../../../../world-info.js';
import { eventSource, event_types } from '../../../../../script.js';
import { download, debounce, initScrollHeight, resetScrollHeight, parseJsonFile, extractDataFromPng, getFileBuffer, getCharaFilename, getSortableDelay, escapeRegex, PAGINATION_TEMPLATE, navigation_option, waitUntilCondition, isTrueBoolean, setValueByPath, flashHighlight, select2ModifyOptions, getSelect2OptionId, dynamicSelect2DataViaAjax, highlightRegex, select2ChoiceClickSubscribe, isFalseBoolean, getSanitizedFilename, checkOverwriteExistingData, getStringHash, parseStringArray, cancelDebounce, findChar, onlyUnique, equalsIgnoreCaseAndAccents } from '../../../../utils.js';

import * as core from './core.js';
import * as utils from './utils.js';


// ===== 🐖门徒系统开始👇 =====
// 🐷 核心变量
export let pigEnabled = true;
export let pigRealtimeEnabled = true;
export let pigLastMessageCount = 0;
export let pigTrapsData = {
    version: 'v2_enhanced',
    chatId: null,
    traps: {
        thread: null,      // 主线：单条，会被替换
        emotion: null,     // 情绪：单条，会被替换  
        foreshadowing: []  // 伏笔：多条，累积记录，有去重
    },
    lastUpdate: 0
};

// 🆕 实时状态枚举
export const PIG_REALTIME_STATUS = {
    ACTIVE: 'active',        // 活跃监听中
    IDLE: 'idle',           // 空闲等待中
    DISABLED: 'disabled',   // 已禁用
    WORKING: 'working'      // 正在分析中
};

// 🆕 实时状态变量
export let pigRealtimeStatus = PIG_REALTIME_STATUS.IDLE;
export let pigLastActivity = 0;
export let pigRealtimeTimer = null;

// 提示词 
export const PIG_FOCUSED_PROMPT = `你是 The Pig，Entity（恶灵） 的正式员工之一，负责协同鬼面追踪对话中的关键剧情要素与未来计划。

你的任务是识别以下三类关键信息，并在每轮中更新记录：

---

🎯 【主线】 当前核心话题/活动/情感焦点  
- 用户与角色正在围绕的主要活动、剧情、情感焦点。  
- 识别出可持续推进的"核心目标"或"状态"。

💭 【情绪】 心理状态变化  
- 用户或角色的心理状态变化、情绪起伏、内心动摇、关系变化等。  

🎭 【伏笔】 实时剧情连贯性记忆！
门徒专注于**短期记忆连贯**，捕捉近期对话中可能很快被引用的剧情线索：

**🔮 约定类伏笔：**
- 刚做出的承诺、计划："明天去XX"、"下次要做XX"、"以后不会再XX"
- 临时决定："改天再说"、"等会儿处理"

**💬 评价类伏笔：**  
- 刚表达的观点评价："你这衣服好丑"、"这家店很棒"
- 刚流露的情感态度："我现在很讨厌下雨"、"今天心情不错"

**🎬 事件类伏笔：**
- 刚发生的事情："刚才遇到了XX"、"刚刚发生了XX"
- 当前状况："手机没电了"、"今天迟到了"、"刚吃完饭"

**🎲 场景类伏笔：**
- 当前环境细节："窗外有只猫"、"今天穿红裙子"、"房间有点乱"
- 即时情境："外面在下雨"、"音乐声很大"、"灯光有点暗"

---

🧠 工作原则：
- 每轮只保留**最新**或**最具剧情价值**的信息。
- **主线和情绪**：新的替换旧的（单条记录）
- **伏笔**：累积记录但智能去重（多条记录）
- 忽略无意义或重复对话，避免误标无关闲聊。
- 信息简洁清晰，便于后续剧情中直接引用。
- 无关键信息时，相应类别返回 "无"。

---

📦 **严格输出格式** - 必须使用这三个标签：
[主线] 当前核心话题描述
[情绪] 当前情感状态描述  
[伏笔] 具体的伏笔内容1
[伏笔] 具体的伏笔内容2
[伏笔] 具体的伏笔内容3

**示例输出：**
[主线] 正在讨论周末的约会计划
[情绪] {{user}}对约会感到紧张又期待
[伏笔] {{char}}说{{user}}的蓝色外套很好看
[伏笔] 约定周六下午两点在咖啡店见面
[伏笔] {{user}}提到自己不会骑自行车

**重要：所有承诺、约定、计划都属于[伏笔]类别，不要使用[承诺]标签！**

如果某类别无新信息，该类别输出"无"。
`;

// 门徒系统核心对象 
export const ThePigCore = {
    eventsAttached: false,

    // 检查世界书状态并显示对应面板
    checkWorldBookStatus() {
        const worldSelect = document.querySelector('#world_editor_select');
        const hasWorldBook = worldSelect && worldSelect.value;
        
        const warningDiv = document.getElementById('pig_no_worldbook_warning');
        const mainPanel = document.getElementById('pig_main_panel');
        
        if (!hasWorldBook) {
            if (warningDiv) warningDiv.style.display = 'block';
            if (mainPanel) mainPanel.style.display = 'none';
        } else {
            if (warningDiv) warningDiv.style.display = 'none';
            if (mainPanel) mainPanel.style.display = 'block';
        }
    },

    // 绑定事件
    setupEvents() {
        // 🔧 防止重复绑定事件
        if (this.eventsAttached) {
            console.log('🐷 事件已绑定，跳过重复绑定');
            return;
        }
        
        console.log('🐷 开始绑定门徒事件...');
        
        // 🔧 实时切换按钮 - 改进版
        const realtimeBtn = document.getElementById('pig_realtime_toggle');
        if (realtimeBtn) {
            // 🔧 先移除可能存在的旧事件监听器
            realtimeBtn.removeEventListener('click', this.handleRealtimeToggle);
            
            // 🔧 使用箭头函数确保this指向正确
            this.handleRealtimeToggle = (e) => {
                e.preventDefault();
                e.stopPropagation();
                
                console.log(`🐷 实时按钮被点击，当前状态: ${pigRealtimeEnabled}`);
                
                pigRealtimeEnabled = !pigRealtimeEnabled;
                
                if (pigRealtimeEnabled) {
                    console.log('🐷 启动实时监听...');
                    PigRealtimeManager.start();
                    
                    if (typeof toastr !== 'undefined') {
                        toastr.success('🐷 门徒实时监听已启动！', '', { timeOut: 2000 });
                    }
                } else {
                    console.log('🐷 停止实时监听...');
                    PigRealtimeManager.stop();
                    
                    if (typeof toastr !== 'undefined') {
                        toastr.info('🐷 门徒实时监听已暂停', '', { timeOut: 2000 });
                    }
                }
                
                // 立即更新UI
                this.updateUI();
            };
            
            // 🔧 绑定新的事件监听器
            realtimeBtn.addEventListener('click', this.handleRealtimeToggle);
            console.log('🐷 ✅ 实时按钮事件已绑定');
        } else {
            console.warn('🐷 ⚠️ 未找到实时按钮元素');
        }

        // 扫描按钮
        const scanBtn = document.getElementById('pig_scan_simple');
        if (scanBtn) {
            scanBtn.removeEventListener('click', this.handleQuickScan);
            this.handleQuickScan = () => this.quickScan();
            scanBtn.addEventListener('click', this.handleQuickScan);
            console.log('🐷 ✅ 扫描按钮事件已绑定');
        }

        // 深度扫描按钮
        const deepScanBtn = document.getElementById('pig_deep_scan');
        if (deepScanBtn) {
            deepScanBtn.removeEventListener('click', this.handleDeepScan);
            this.handleDeepScan = () => this.deepScan();
            deepScanBtn.addEventListener('click', this.handleDeepScan);
            console.log('🐷 ✅ 深度扫描按钮事件已绑定');
        }

        // 清空按钮
        const clearBtn = document.getElementById('pig_clear_simple');
        if (clearBtn) {
            clearBtn.removeEventListener('click', this.handleClearTraps);
            this.handleClearTraps = () => this.clearTraps();
            clearBtn.addEventListener('click', this.handleClearTraps);
            console.log('🐷 ✅ 清空按钮事件已绑定');
        }
        
        // 🔧 标记事件已绑定
        this.eventsAttached = true;
        console.log('🐷 ✅ 所有门徒事件绑定完成');
    },
    
    // 🆕 清理事件监听器的方法
    cleanupEvents() {
        console.log('🐷 清理门徒事件监听器...');
        
        const realtimeBtn = document.getElementById('pig_realtime_toggle');
        const scanBtn = document.getElementById('pig_scan_simple');
        const deepScanBtn = document.getElementById('pig_deep_scan');
        const clearBtn = document.getElementById('pig_clear_simple');
        
        if (realtimeBtn && this.handleRealtimeToggle) {
            realtimeBtn.removeEventListener('click', this.handleRealtimeToggle);
        }
        if (scanBtn && this.handleQuickScan) {
            scanBtn.removeEventListener('click', this.handleQuickScan);
        }
        if (deepScanBtn && this.handleDeepScan) {
            deepScanBtn.removeEventListener('click', this.handleDeepScan);
        }
        if (clearBtn && this.handleClearTraps) {
            clearBtn.removeEventListener('click', this.handleClearTraps);
        }
        
        this.eventsAttached = false;
        console.log('🐷 ✅ 门徒事件清理完成');
    },

    // 更新UI
     updateUI() {
        try {
            console.log('🐷 开始UI更新，当前数据结构:', pigTrapsData);
            
            // 🔧 确保数据结构正确
            if (!pigTrapsData.traps || typeof pigTrapsData.traps !== 'object') {
                console.log('🐷 数据结构异常，重新初始化...');
                pigTrapsData.traps = {
                    thread: null,
                    emotion: null,
                    foreshadowing: []
                };
            }
            
            // 🔧 确保foreshadowing是数组
            if (!Array.isArray(pigTrapsData.traps.foreshadowing)) {
                console.log('🐷 foreshadowing不是数组，重新初始化...');
                pigTrapsData.traps.foreshadowing = [];
            }
            
            // 计算数量
            const threadCount = pigTrapsData.traps.thread ? 1 : 0;
            const emotionCount = pigTrapsData.traps.emotion ? 1 : 0;
            const foreshadowingCount = pigTrapsData.traps.foreshadowing.length;
            const totalCount = threadCount + emotionCount + foreshadowingCount;

            console.log('🐷 计算结果:', {
                主线: threadCount,
                情绪: emotionCount,
                伏笔: foreshadowingCount,
                总计: totalCount
            });

            // 更新DOM元素
            const threadEl = document.getElementById('pig_thread_count');
            const emotionEl = document.getElementById('pig_emotion_count');
            const promiseEl = document.getElementById('pig_promise_count');
            const statusEl = document.getElementById('pig_status_text');

            if (threadEl) threadEl.textContent = threadCount;
            if (emotionEl) emotionEl.textContent = emotionCount;
            if (promiseEl) promiseEl.textContent = foreshadowingCount;
            if (statusEl) statusEl.textContent = `🐷 The Pig (${totalCount})`;

            // 更新陷阱列表
            this.updateTrapsList();

            // 🔧 使用PigRealtimeManager来更新实时按钮状态
            if (typeof PigRealtimeManager !== 'undefined' && PigRealtimeManager.updateButtonState) {
                PigRealtimeManager.updateButtonState();
            } else {
                // 🔧 备用方案：直接更新按钮状态
                this.updateRealtimeButtonFallback();
            }

            // 更新状态指示
            const modeEl = document.getElementById('pig_mode_text');
            const updateEl = document.getElementById('pig_last_update');
            
            if (modeEl) {
                const modeText = pigRealtimeEnabled ? 
                    this.getRealtimeStatusText() : '手动模式';
                modeEl.textContent = modeText;
            }
            
            if (updateEl) {
                const lastUpdate = pigTrapsData.lastUpdate;
                if (lastUpdate > 0) {
                    const timeAgo = Math.floor((Date.now() - lastUpdate) / 1000);
                    updateEl.textContent = timeAgo < 60 ? `${timeAgo}秒前` : `${Math.floor(timeAgo/60)}分钟前`;
                }
            }

            // 🆕 重新检查世界书状态
            this.checkWorldBookStatus();
            
            console.log('🐷 UI更新完成！');
            
        } catch (error) {
            console.error('🐷 UI更新失败:', error);
            console.error('🐷 当前pigTrapsData:', pigTrapsData);
            
            // 🚨 错误恢复：重置数据结构
            pigTrapsData.traps = {
                thread: null,
                emotion: null,
                foreshadowing: []
            };
            
            // 显示错误状态
            const statusEl = document.getElementById('pig_status_text');
            if (statusEl) statusEl.textContent = '🐷 The Pig (错误)';
        }
    },

     // 🆕 获取实时状态文字
    getRealtimeStatusText() {
        switch (pigRealtimeStatus) {
            case PIG_REALTIME_STATUS.ACTIVE: return '实时活跃中';
            case PIG_REALTIME_STATUS.WORKING: return '正在分析';
            case PIG_REALTIME_STATUS.IDLE: return '实时监听中';
            default: return '实时模式';
        }
    },

    updateTrapsList() {
        const listEl = document.getElementById('pig_simple_list');
        if (!listEl) {
            console.log('🐷 未找到pig_simple_list元素');
            return;
        }

        try {
            const allTraps = [];
            
            // 添加主线
            if (pigTrapsData.traps.thread) {
                allTraps.push({
                    type: 'thread',
                    icon: '🎯',
                    color: '#45b7d1',
                    description: pigTrapsData.traps.thread.description,
                    priority: 1
                });
            }
            
            // 添加情绪
            if (pigTrapsData.traps.emotion) {
                allTraps.push({
                    type: 'emotion', 
                    icon: '💭',
                    color: '#4ecdc4',
                    description: pigTrapsData.traps.emotion.description,
                    priority: 2
                });
            }
            
            // 添加伏笔（按重要性排序）
            if (Array.isArray(pigTrapsData.traps.foreshadowing)) {
                pigTrapsData.traps.foreshadowing
                    .sort((a, b) => (b.metadata?.importance || 50) - (a.metadata?.importance || 50))
                    .forEach(foreshadowing => {
                        allTraps.push({
                            type: 'foreshadowing',
                            icon: '🎭',
                            color: '#ff6b9d',
                            description: foreshadowing.description,
                            category: foreshadowing.metadata?.category,
                            importance: foreshadowing.metadata?.importance,
                            priority: 3
                        });
                    });
            }

            console.log('🐷 准备显示的陷阱:', allTraps);

            if (allTraps.length === 0) {
                listEl.innerHTML = '<div style="color: #666; text-align: center; padding: 15px; font-size: 12px;">暂无陷阱</div>';
                return;
            }

            // 按优先级排序：主线 > 情绪 > 伏笔
            allTraps.sort((a, b) => a.priority - b.priority);

            const trapsHtml = allTraps.map(trap => {
                const categoryBadge = trap.category ? 
                    `<span style="font-size: 12px; background: rgba(255,255,255,0.2); padding: 1px 3px; border-radius: 2px; margin-left: 2px;">${trap.category}</span>` : '';
                
                return `
                    <div style="margin-bottom: 6px; padding: 4px 6px; background: rgba(255,255,255,0.05); border-radius: 4px; border-left: 2px solid ${trap.color};">
                        <div style="display: flex; align-items: center; gap: 4px;">
                            <span style="font-size: 12px;">${trap.icon}</span>
                            <span style="font-size: 12px; color: #ccc; flex: 1; line-height: 1.2;">${trap.description}</span>
                            ${categoryBadge}
                        </div>
                    </div>
                `;
            }).join('');

            listEl.innerHTML = trapsHtml;
            console.log('🐷 陷阱列表更新完成');
            
        } catch (error) {
            console.error('🐷 更新陷阱列表失败:', error);
            listEl.innerHTML = '<div style="color: #f44336; text-align: center; padding: 15px; font-size: 12px;">列表更新失败</div>';
        }
    },

    // 🆕 数据迁移函数：处理旧格式数据
    migrateOldData() {
        try {
            console.log('🐷 检查是否需要数据迁移...');
            
            // 如果traps是数组格式（旧版本），需要迁移
            if (Array.isArray(pigTrapsData.traps)) {
                console.log('🐷 检测到旧数据格式，开始迁移...');
                
                const oldTraps = pigTrapsData.traps;
                const newTraps = {
                    thread: null,
                    emotion: null,
                    foreshadowing: []
                };
                
                // 迁移旧数据
                oldTraps.forEach(trap => {
                    if (trap.type === 'thread') {
                        newTraps.thread = trap;
                    } else if (trap.type === 'emotion') {
                        newTraps.emotion = trap;
                    } else if (trap.type === 'promise' || trap.type === 'foreshadowing') {
                        // 将promise类型的陷阱迁移为foreshadowing
                        newTraps.foreshadowing.push({
                            ...trap,
                            type: 'foreshadowing',
                            metadata: trap.metadata || { category: '约定', importance: 70 }
                        });
                    }
                });
                
                pigTrapsData.traps = newTraps;
                console.log('🐷 数据迁移完成:', pigTrapsData.traps);
                
                // 保存迁移后的数据
                savePigToWorldBook();
                
                return true;
            } else {
                console.log('🐷 数据格式正确，无需迁移');
                return false;
            }
            
        } catch (error) {
            console.error('🐷 数据迁移失败:', error);
            
            // 迁移失败时重置为默认结构
            pigTrapsData.traps = {
                thread: null,
                emotion: null,
                foreshadowing: []
            };
            
            return false;
        }
    },

    // 初始化方法
    init() {
        console.log('🐷 The Pig Core 初始化开始...');
        
        try {
            // 🔧 先清理可能存在的旧事件
            this.cleanupEvents();
            
            // 数据迁移
            this.migrateOldData();
            
            // 绑定事件
            this.setupEvents();
            
            // 更新UI
            this.updateUI();
            
            // 检查世界书状态
            this.checkWorldBookStatus();
            
            // 🆕 如果实时模式已启用，延迟启动监听（避免初始化冲突）
            if (pigRealtimeEnabled) {
                setTimeout(() => {
                    if (typeof PigRealtimeManager !== 'undefined' && PigRealtimeManager.start) {
                        PigRealtimeManager.start();
                        console.log('🐷 延迟启动实时监听完成');
                    }
                }, 2000); // 延迟2秒启动
            }
            
            console.log('🐷 The Pig Core 初始化完成！');
            
        } catch (error) {
            console.error('🐷 The Pig Core 初始化失败:', error);
            // 错误恢复
            this.eventsAttached = false;
        }
    },


    // 快速扫描
    async quickScan() {
        logger.info('🐷 开始快速扫描...');
        const scanBtn = document.getElementById('pig_scan_simple');
        if (scanBtn) {
            scanBtn.textContent = '⏳ 扫描中';
            scanBtn.disabled = true;
        }

        try {
            const context = await getContext();
            const messages = getMessageArray(context);
            const recentMessages = messages.slice(-3); // 最近3条消息
            
            await pigSmartDualMode(recentMessages, 'manual');
            
            logger.success('🐷 快速扫描完成');
        } catch (error) {
            logger.error('🐷 快速扫描失败:', error);
        } finally {
            if (scanBtn) {
                scanBtn.textContent = '🔍 扫描';
                scanBtn.disabled = false;
            }
        }
    },

    // 深度扫描
    async deepScan() {
        logger.info('🐷 开始深度扫描...');
        const deepBtn = document.getElementById('pig_deep_scan');
        if (deepBtn) {
            deepBtn.textContent = '🕵️ 分析中';
            deepBtn.disabled = true;
        }

        try {
            const context = await getContext();
            const messages = getMessageArray(context);
            const recentMessages = messages.slice(-10); // 最近10条消息
            
            await pigSmartDualMode(recentMessages, 'manual');
            
            logger.success('🐷 深度扫描完成');
        } catch (error) {
            logger.error('🐷 深度扫描失败:', error);
        } finally {
            if (deepBtn) {
                deepBtn.textContent = '🕵️ 深度';
                deepBtn.disabled = false;
            }
        }
    },

    // 清空陷阱
    clearTraps() {
        if (confirm('确定要清空所有陷阱吗？')) {
            pigTrapsData.traps = [];
            this.updateUI();
            savePigToWorldBook();
            logger.info('🐷 陷阱已清空');
        }
    },

    // 获取伏笔摘要（供其他系统调用）
    getForeshadowingSummary() {
        const foreshadowings = pigTrapsData.traps.foreshadowing;
        if (foreshadowings.length === 0) return '暂无活跃伏笔';
        
        const categories = {};
        foreshadowings.forEach(f => {
            const cat = f.metadata.category || '其他';
            if (!categories[cat]) categories[cat] = [];
            categories[cat].push(f.description);
        });
        
        return Object.entries(categories)
            .map(([cat, items]) => `${cat}: ${items.join('; ')}`)
            .join('\n');
    },

    // 清空特定类型的陷阱
    clearTrapsByType(type) {
        if (type === 'foreshadowing') {
            pigTrapsData.traps.foreshadowing = [];
            console.log('🐷 已清空所有伏笔');
        } else if (type === 'thread') {
            pigTrapsData.traps.thread = null;
            console.log('🐷 已清空主线');
        } else if (type === 'emotion') {
            pigTrapsData.traps.emotion = null;
            console.log('🐷 已清空情绪');
        }
        this.updateUI();
        savePigToWorldBook();
    },

    // 获取陷阱数据（供外部调用）

    getTraps() {
        return pigTrapsData.traps;
    },

    // 与鬼面集成
    async integrateWithGhost(messages, mode = 'auto') {
        if (!pigEnabled) return;
        
        logger.info(`🐷 配合鬼面进行${mode}模式分析`);
        
        try {
            await pigSmartDualMode(messages, mode);
            this.updateUI();
        } catch (error) {
            logger.warn('🐷 配合鬼面分析失败:', error);
        }
    }
};

// 陷阱结构
export function createSimpleTrap(type, description, metadata = {}) {
    return {
        id: `pig_${type}_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        type: type,
        description: description,
        createdAt: new Date().toISOString(),
        metadata: metadata, // 可以存储额外信息，如重要性、来源楼层等
        lastSeen: Date.now()
    };
}

export function insertPigPanel() {
    try {
        if (typeof ThePigCore === 'undefined') {
            return;
        }
        
        // 延迟初始化，确保DOM准备好
        setTimeout(() => {
            try {
                ThePigCore.init();
                loadPigFromWorldBook();
                console.log('🐷 [门徒] 面板初始化完成');
            } catch (error) {
                console.warn('🐷 门徒系统初始化失败:', error);
            }
        }, 500);
        
    } catch (error) {
        console.error('🐷 初始化门徒系统失败:', error);
    }
}

// 门徒面板切换函数
export async function togglePigPanel() {
    
    const pigContainer = document.getElementById('pig_panel_container');
    const pigBtn = document.getElementById('the_ghost_face_control_panel_disciples_attack');
    
    if (!pigContainer) {
        console.error('🐷 门徒面板容器未找到！');
        if (typeof toastr !== 'undefined') {
            toastr.error('门徒面板未找到，请重新打开控制台');
        }
        return;
    }
    
    if (!pigBtn) {
        console.error('⚔️ 门徒按钮未找到！');
        return;
    }

    // 检查当前显示状态
    const isHidden = pigContainer.style.display === 'none';
    
    if (isHidden) {
        // 📖 展开门徒面板
        pigContainer.style.display = 'block';
        pigBtn.classList.add('active');
        pigBtn.innerHTML = '⚔️ 收起门徒';
        
        console.log('🐷 门徒面板已展开，开始初始化...');
        
        try {
            // 🐷 重新初始化和更新系统
            ThePigCore.checkWorldBookStatus();
            
            // 如果有世界书，加载数据
            const worldSelect = document.querySelector('#world_editor_select');

            if (worldSelect && worldSelect.value) {
                console.log('🐷 检测到世界书，开始加载数据...');
                
                // 🔧 修复: 先加载数据，再更新UI
                await loadPigFromWorldBook();
                
                // UI已在loadPigFromWorldBook中更新，无需再次调用
                console.log('🐷 门徒数据和UI同步完成');
                
                if (typeof toastr !== 'undefined') {
                    const dataCount = (pigTrapsData.traps.thread ? 1 : 0) + 
                                    (pigTrapsData.traps.emotion ? 1 : 0) + 
                                    pigTrapsData.traps.foreshadowing.length;
                    toastr.success(`⚔️ 门徒已就位！加载了${dataCount}条记录`, '', {
                        timeOut: 3000
                    });
                }
            } else {
                // 没有世界书时也要更新UI
                ThePigCore.updateUI();
                
                if (typeof toastr !== 'undefined') {
                    toastr.warning('⚔️ 门徒需要世界书才能运作');
                }
            }
        } catch (error) {
            console.error('🐷 门徒系统激活失败:', error);
            if (typeof toastr !== 'undefined') {
                toastr.error('门徒系统激活失败: ' + error.message);
            }
        }
        
    } else {
        // 📕 收起门徒面板
        pigContainer.style.display = 'none';
        pigBtn.classList.remove('active');
        pigBtn.innerHTML = '⚔️ 门徒伏击';
        
        if (typeof toastr !== 'undefined') {
            toastr.info('⚔️ 门徒已潜行，等待下次召唤');
        }
    }
}

// 智能双模式分析
export async function pigSmartDualMode(messages, triggerMode = 'auto') {
    if (!pigEnabled || !messages?.length) return;
    
    console.log(`🐷 === The Pig ${triggerMode}模式分析开始 ===`);
    
    try {
        let messagesToAnalyze;
        let analysisDepth = 'light';
        
        // 根据触发模式选择分析策略
        switch (triggerMode) {
            case 'realtime':
                messagesToAnalyze = messages.slice(-2);
                analysisDepth = 'light';
                break;
            case 'ghost':
                messagesToAnalyze = messages.slice(-4);
                analysisDepth = 'normal';
                break;
            case 'manual':
                messagesToAnalyze = messages.slice(-8);
                analysisDepth = 'deep';
                break;
            default: // 'auto'
                const lastUpdateTime = pigTrapsData.lastUpdate || 0;
                const timeSinceUpdate = Date.now() - lastUpdateTime;
                
                if (timeSinceUpdate > 300000) { // 5分钟以上
                    messagesToAnalyze = messages.slice(-6);
                    analysisDepth = 'normal';
                } else {
                    messagesToAnalyze = messages.slice(-3);
                    analysisDepth = 'light';
                }
        }
        
        console.log(`🐷 分析策略: ${analysisDepth}, 消息数量: ${messagesToAnalyze.length}`);
        
        // 构建对应深度的分析提示
        const analysisPrompt = generatePigPrompt(analysisDepth);
        
        // 构建轻量上下文
        const contextText = messagesToAnalyze
            .map(msg => {
                const speaker = msg.is_user ? '{{user}}' : '{{char}}';
                const content = (msg.parsedContent || msg.mes || '').substring(0, 500);
                return `${speaker}: ${content}`;
            })
            .join('\n');

        const userPrompt = `分析对话片段：

${contextText}

请识别重要信息：`;

        console.log('🐷 开始AI分析...');

        // 🤖 调用AI
        let result;
        if (useCustomApi && customApiConfig.url && customApiConfig.model) {
            result = await callCustomOpenAI(analysisPrompt, userPrompt);
        } else {
            const context = await getContext();
            if (context?.generateQuietPrompt) {
                result = await context.generateQuietPrompt(
                    `${analysisPrompt}\n\n${userPrompt}`, 
                    true, false, ""
                );
            }
        }
        
        console.log('🐷 AI分析结果:', result);
        
        if (result && !result.toLowerCase().includes('无')) {
            console.log('🐷 开始更新陷阱数据...');
            
            // 🔧 修复: 更新陷阱数据
            const updateCount = await pigUpdateTraps(result);
            pigTrapsData.lastUpdate = Date.now();
            
            console.log(`🐷 陷阱更新完成，影响${updateCount}个条目`);
            
            // 🔧 修复: 立即更新UI
            if (typeof ThePigCore !== 'undefined' && ThePigCore.updateUI) {
                ThePigCore.updateUI();
                console.log('🐷 UI已同步更新');
            }
            
            // 🔧 修复: 保存到世界书并提供反馈
            console.log('🐷 开始保存到世界书...');
            await savePigToWorldBook();
            
            // 🔧 修复: 增加保存完成提示（像鬼面一样）
            if (typeof toastr !== 'undefined') {
                const modeText = {
                    'realtime': '实时监听',
                    'ghost': '协同鬼面',
                    'manual': '手动扫描',
                    'auto': '自动分析'
                }[triggerMode] || triggerMode;
                
                toastr.success(`🐷 门徒${modeText}完成！已保存${updateCount}条信息到世界书`, '', {
                    timeOut: 3000
                });
            }
            
            // 🔧 修复: 强制刷新世界书显示（类似鬼面的做法）
            const worldSelect = document.querySelector('#world_editor_select');
            setTimeout(() => {
                if (worldSelect) {
                    const event = new Event('change', { bubbles: true });
                    worldSelect.dispatchEvent(event);
                    console.log('🐷 已触发世界书界面刷新');
                }
                
                // 额外的界面刷新
                if (typeof reloadEditor === 'function') {
                    reloadEditor();
                    console.log('🐷 已调用编辑器重载');
                }
            }, 500);
            
            console.log(`🐷 === ${triggerMode}模式分析成功完成 ===`);
            
        } else {
            console.log('🐷 AI判断无新信息需要记录');
            if (typeof toastr !== 'undefined') {
                toastr.info('🐷 门徒扫描完成，未发现新的重要信息', '', {
                    timeOut: 2000
                });
            }
        }
        
    } catch (error) {
        console.error(`🐷 === ${triggerMode}模式分析失败 ===`);
        console.error('🐷 错误详情:', error);
        
        if (typeof toastr !== 'undefined') {
            toastr.error(`🐷 门徒${triggerMode}模式分析失败: ${error.message}`, '', {
                timeOut: 5000
            });
        }
    }
}

// 生成不同深度的AI提示词
export function generatePigPrompt(depth) {
    const basePrompt = `你是The Pig，专门识别对话中的3类关键信息：

**目标：**
- 🎯 主线话题（当前核心讨论内容）
- 💭 情绪变化（重要心情状态）  
- 🎭 伏笔记忆（实时连贯性线索）`;

    const strictFormat = `
**严格输出格式 - 只能使用这三个标签：**
[主线] 简洁描述
[情绪] 简洁描述
[伏笔] 具体内容1
[伏笔] 具体内容2

**重要提醒：**
- 所有承诺、约定、计划都用[伏笔]标签
- 不要使用[承诺]、[约定]、[计划]等标签
- 无信息时返回"无"`;

    switch (depth) {
        case 'light':
            return `${basePrompt}

**轻量模式规则：**
- 只识别明显的重要变化
- 忽略细微的情绪波动
- 专注当前正在进行的话题
${strictFormat}`;

        case 'normal':
            return `${basePrompt}

**标准模式规则：**
- 识别所有重要信息
- 新信息会替换同类型的旧信息
- 注意情感状态的转变
- 捕捉可能被引用的承诺和细节
${strictFormat}`;

        case 'deep':
            return `${basePrompt}

**深度模式规则：**
- 全面分析对话内容
- 识别潜在的未来计划和承诺
- 捕捉微妙的情感变化
- 总结核心讨论主题
- 收集所有可能成为剧情钩子的信息

示例输出：
[主线] 正在深入讨论职业规划和未来发展
[情绪] 对工作感到焦虑和压力
[伏笔] 承诺明天晚上一起看电影
[伏笔] 说对方穿的红裙子很好看
[伏笔] 提到自己害怕蜘蛛
${strictFormat}`;

        default:
            return `${basePrompt}
${strictFormat}`;
    }
}

// 智能更新陷阱（替换而非累积）
export async function pigUpdateTraps(analysisResult) {
    console.log('🐷 原始分析结果:', analysisResult);
    
    const lines = analysisResult.split('\n').filter(line => 
        line.trim() && line.includes('[') && line.includes(']')
    );
    
    console.log('🐷 提取的有效行:', lines);
    
    // 🎯 分类收集
    let newThread = null;
    let newEmotion = null;
    const newForeshadowings = [];
    
    lines.forEach(line => {
        try {
            const match = line.match(/\[(.+?)\]\s*(.+)/);
            if (match) {
                const [, typeText, description] = match;
                const cleanTypeText = typeText.trim();
                const cleanDescription = description.trim();
                
                console.log(`🐷 解析行: [${cleanTypeText}] ${cleanDescription}`);
                
                // 跳过"无"的内容
                if (cleanDescription === '无' || cleanDescription.toLowerCase() === 'none') {
                    console.log(`🐷 跳过空内容: ${cleanTypeText}`);
                    return;
                }
                
                // 🎯 分类处理
                if (cleanTypeText === '主线' || cleanTypeText === 'thread') {
                    newThread = createSimpleTrap('thread', cleanDescription);
                    console.log(`🐷 ✅ 新主线: ${cleanDescription}`);
                    
                } else if (cleanTypeText === '情绪' || cleanTypeText === 'emotion' || cleanTypeText === '情感') {
                    newEmotion = createSimpleTrap('emotion', cleanDescription);
                    console.log(`🐷 ✅ 新情绪: ${cleanDescription}`);
                    
                } else if (cleanTypeText === '伏笔' || cleanTypeText === 'foreshadowing') {
                    // 🎭 万物皆伏笔！
                    const newForeshadowing = createSimpleTrap('foreshadowing', cleanDescription, {
                        category: detectForeshadowingCategory(cleanDescription),
                        importance: calculateForeshadowingImportance(cleanDescription)
                    });
                    newForeshadowings.push(newForeshadowing);
                    console.log(`🐷 ✅ 新伏笔: ${cleanDescription}`);
                } else {
                    console.log(`🐷 未识别的类型: "${cleanTypeText}"`);
                }
            }
        } catch (error) {
            console.warn('🐷 解析失败:', line, error);
        }
    });
    
    let updateCount = 0;
    
    // 🔄 处理主线（替换）
    if (newThread) {
        pigTrapsData.traps.thread = newThread;
        updateCount++;
        console.log(`🐷 🔄 主线已更新: ${newThread.description}`);
    }
    
    // 🔄 处理情绪（替换）
    if (newEmotion) {
        pigTrapsData.traps.emotion = newEmotion;
        updateCount++;
        console.log(`🐷 🔄 情绪已更新: ${newEmotion.description}`);
    }
    
    // 🎭 处理伏笔（累积+去重）
    if (newForeshadowings.length > 0) {
        console.log(`🐷 🎭 处理 ${newForeshadowings.length} 个新伏笔...`);
        
        newForeshadowings.forEach(newForeshadowing => {
            // 🧠 智能去重：检查是否与现有伏笔相似
            const isDuplicate = pigTrapsData.traps.foreshadowing.some(existingForeshadowing => {
                return isForeshadowingSimilar(newForeshadowing.description, existingForeshadowing.description);
            });
            
            if (!isDuplicate) {
                pigTrapsData.traps.foreshadowing.push(newForeshadowing);
                updateCount++;
                console.log(`🐷 ➕ 新伏笔已添加: ${newForeshadowing.description}`);
            } else {
                console.log(`🐷 🔄 伏笔重复，跳过: ${newForeshadowing.description}`);
            }
        });
        
        // 🧹 伏笔数量管理（保持在合理范围内）
        manageForeshadowingCount();
    }
    
    console.log('🐷 📊 最终状态:');
    console.log('  主线:', pigTrapsData.traps.thread?.description || '无');
    console.log('  情绪:', pigTrapsData.traps.emotion?.description || '无');
    console.log('  伏笔数量:', pigTrapsData.traps.foreshadowing.length);
    console.log('  伏笔列表:', pigTrapsData.traps.foreshadowing.map(f => f.description));
    
    return updateCount;
}

// 存储到世界书
export async function savePigToWorldBook() {
    try {
        // 🎯 自动获取世界书 - 如果失败就手动获取
        let worldBookName = await utils.findActiveWorldBook();
        
        if (!worldBookName) {
            // 🔄 回退到手动检测方案
            const worldSelect = document.querySelector('#world_editor_select');
            if (worldSelect && worldSelect.value) {
                worldBookName = worldSelect.selectedOptions[0].textContent;
                console.log(`🐷 手动检测到世界书: ${worldBookName}`);
            } else {
                console.log('🐷 未选择世界书，跳过存储');
                return;
            }
        } else {
            console.log(`🐷 自动检测到绑定世界书: ${worldBookName}`);
        }
        
        // 🔧 修复：添加这行来加载世界书数据
        const worldBookData = await loadWorldInfo(worldBookName);
        
        if (!worldBookData) {
            console.warn('🐷 无法加载世界书数据');
            return;
        }
        
        // 🔧 使用稳定的聊天标识符
        const currentChatId = await getStableChatIdentifier();
        console.log(`🐷 使用聊天标识符: ${currentChatId}`);
        
        // 更新聊天ID
        pigTrapsData.chatId = currentChatId;
        
        // 🔧 修复: 清理重复条目，只保留一个
        const pigEntryComment = `The Pig 记忆陷阱 - ${currentChatId}`;
        const duplicateEntries = [];
        let pigEntry = null;
        
        Object.entries(worldBookData.entries).forEach(([uid, entry]) => {
            if (entry.comment && entry.comment.startsWith('The Pig 记忆陷阱 - ')) {
                if (entry.comment === pigEntryComment) {
                    if (pigEntry === null) {
                        pigEntry = entry; // 保留第一个匹配的
                    } else {
                        duplicateEntries.push(uid); // 标记为重复
                    }
                } else {
                    // 其他聊天的门徒条目，检查是否为当前聊天的旧版本
                    const otherChatId = entry.comment.replace('The Pig 记忆陷阱 - ', '');
                    if (otherChatId.includes('unknown_chat') && currentChatId.includes('unknown_chat')) {
                        duplicateEntries.push(uid); // 可能是重复的unknown_chat条目
                    }
                }
            }
        });
        
        // 删除重复条目
        if (duplicateEntries.length > 0) {
            console.log(`🐷 发现${duplicateEntries.length}个重复条目，正在清理...`);
            duplicateEntries.forEach(uid => {
                delete worldBookData.entries[uid];
            });
            console.log('🐷 重复条目清理完成');
        }
        
        // 构建陷阱内容
        let trapsContent = '';
        
        // 添加主线
        if (pigTrapsData.traps.thread) {
            trapsContent += `🎯 ${pigTrapsData.traps.thread.description}\n`;
        }
        
        // 添加情绪
        if (pigTrapsData.traps.emotion) {
            trapsContent += `💭 ${pigTrapsData.traps.emotion.description}\n`;
        }
        
        // 添加伏笔
        if (Array.isArray(pigTrapsData.traps.foreshadowing) && pigTrapsData.traps.foreshadowing.length > 0) {
            pigTrapsData.traps.foreshadowing.forEach(foreshadowing => {
                const category = foreshadowing.metadata?.category || '';
                const categoryTag = category ? `[${category}]` : '';
                trapsContent += `🎭 ${categoryTag}${foreshadowing.description}\n`;
            });
        }
        
        if (!trapsContent.trim()) {
            trapsContent = '暂无活跃陷阱';
        }
            
        const pigContent = `更新时间: ${new Date().toLocaleString()}
聊天标识: ${currentChatId}

活跃陷阱:
<the_pig_info>
${trapsContent}
</the_pig_info>

---
此条目由The Pig自动管理，记录当前重要的主线、情绪和实时伏笔。`;

        if (pigEntry) {
            // 更新现有条目
            pigEntry.content = pigContent;
            console.log('🐷 更新现有世界书陷阱条目');
        } else {
            // 创建新条目
            const newPigEntry = createWorldInfoEntry(null, worldBookData);
            Object.assign(newPigEntry, {
                comment: pigEntryComment,
                content: pigContent,
                key: ['The Pig', '记忆陷阱', currentChatId, '当前状态'],
                constant: true,
                selective: false,
                disable: false,
                order: 99998, // 很高的优先级
                position: 0
            });
            console.log('🐷 创建新的世界书陷阱条目');
        }
        
        // 保存世界书
        await saveWorldInfo(worldBookName, worldBookData, true);
        console.log('🐷 ✅ 世界书保存成功');
        
    } catch (error) {
        console.error('🐷 ❌ 保存到世界书失败:', error);
        throw error; // 重新抛出错误以便上层处理
    }
}

// 从世界书加载陷阱
export async function loadPigFromWorldBook() {
    try {
        let worldBookName = await utils.findActiveWorldBook();
        
        if (!worldBookName) {
            const worldSelect = document.querySelector('#world_editor_select');
            if (worldSelect && worldSelect.value) {
                worldBookName = worldSelect.selectedOptions[0].textContent;
                console.log(`🐷 手动检测到世界书: ${worldBookName}`);
            } else {
                // 重置为默认结构
                pigTrapsData.traps = {
                    thread: null,
                    emotion: null,
                    foreshadowing: []
                };
                pigTrapsData.chatId = null;
                
                if (typeof ThePigCore !== 'undefined' && ThePigCore.updateUI) {
                    ThePigCore.updateUI();
                }
                console.log('🐷 未检测到世界书，初始化为空');
                return;
            }
        } else {
            console.log(`🐷 自动检测到绑定世界书: ${worldBookName}`);
        }
        
        const worldBookData = await loadWorldInfo(worldBookName);
        if (!worldBookData) {
            console.warn('🐷 无法加载世界书数据');
            return;
        }
        
        const currentChatId = await getStableChatIdentifier();
        console.log(`🐷 从世界书加载，聊天ID: ${currentChatId}`);
        
        // 查找猪猪条目
        const pigEntryComment = `The Pig 记忆陷阱 - ${currentChatId}`;
        let pigEntry = null;
        
        Object.values(worldBookData.entries).forEach(entry => {
            if (entry.comment === pigEntryComment) {
                pigEntry = entry;
            }
        });
        
        // 重置为默认结构
        pigTrapsData.traps = {
            thread: null,
            emotion: null,
            foreshadowing: []
        };
        
        if (pigEntry && pigEntry.content) {
            console.log('🐷 找到现有条目，开始解析标签化内容...');
            
            // 🎯 提取标签内容
            const pigInfoMatch = pigEntry.content.match(/<the_pig_info>([\s\S]*?)<\/the_pig_info>/);
            let contentToParse = '';
            
            if (pigInfoMatch) {
                contentToParse = pigInfoMatch[1];
                console.log('🐷 ✅ 成功提取<the_pig_info>标签内容');
            } else {
                // 兼容旧格式
                contentToParse = pigEntry.content;
                console.log('🐷 ⚠️ 未找到标签，使用完整内容解析（兼容模式）');
            }
            
            // 解析陷阱内容
            const lines = contentToParse.split('\n');
            const trapLines = lines.filter(line => 
                line.includes('🎯') || line.includes('💭') || line.includes('🎭')
            );
            
            let loadedCount = 0;
            
            trapLines.forEach(line => {
                const cleanLine = line.trim();
                if (cleanLine === '暂无活跃陷阱') return;
                
                if (cleanLine.startsWith('🎯')) {
                    // 主线
                    const description = cleanLine.replace('🎯', '').trim();
                    if (description) {
                        pigTrapsData.traps.thread = createSimpleTrap('thread', description);
                        loadedCount++;
                        console.log(`🐷 加载主线: ${description}`);
                    }
                } else if (cleanLine.startsWith('💭')) {
                    // 情绪
                    const description = cleanLine.replace('💭', '').trim();
                    if (description) {
                        pigTrapsData.traps.emotion = createSimpleTrap('emotion', description);
                        loadedCount++;
                        console.log(`🐷 加载情绪: ${description}`);
                    }
                } else if (cleanLine.startsWith('🎭')) {
                    // 伏笔
                    let description = cleanLine.replace('🎭', '').trim();
                    let category = '其他';
                    
                    // 提取类别标签
                    const categoryMatch = description.match(/^\[(.+?)\]/);
                    if (categoryMatch) {
                        category = categoryMatch[1];
                        description = description.replace(/^\[.+?\]/, '').trim();
                    }
                    
                    if (description) {
                        const foreshadowing = createSimpleTrap('foreshadowing', description, {
                            category: category,
                            importance: 60
                        });
                        pigTrapsData.traps.foreshadowing.push(foreshadowing);
                        loadedCount++;
                        console.log(`🐷 加载伏笔[${category}]: ${description}`);
                    }
                }
            });
            
            pigTrapsData.chatId = currentChatId;
            console.log(`🐷 从标签化世界书加载完成，共${loadedCount}条记录:`, {
                主线: pigTrapsData.traps.thread ? 1 : 0,
                情绪: pigTrapsData.traps.emotion ? 1 : 0,
                伏笔: pigTrapsData.traps.foreshadowing.length
            });
            
        } else {
            // 没有找到条目
            pigTrapsData.chatId = currentChatId;
            console.log('🐷 未找到现有陷阱条目，初始化为空');
        }
        
        // 加载完成后立即同步UI
        if (typeof ThePigCore !== 'undefined' && ThePigCore.updateUI) {
            ThePigCore.updateUI();
            console.log('🐷 标签化数据加载后UI已同步');
        }
        
    } catch (error) {
        console.error('🐷 从世界书加载失败:', error);
        // 错误时重置为默认结构
        pigTrapsData.traps = {
            thread: null,
            emotion: null,
            foreshadowing: []
        };
        
        if (typeof ThePigCore !== 'undefined' && ThePigCore.updateUI) {
            ThePigCore.updateUI();
        }
    }
}
// 🎭 伏笔类别检测 - 门徒专用版本
export function detectForeshadowingCategory(description) {
    if (description.includes('约定') || description.includes('计划') || description.includes('承诺') || 
        description.includes('下次') || description.includes('以后') || description.includes('改天') ||
        description.includes('明天') || description.includes('等会') || description.includes('稍后')) {
        return '约定';
    }
    if (description.includes('好看') || description.includes('丑') || description.includes('喜欢') || 
        description.includes('讨厌') || description.includes('不错') || description.includes('糟糕') ||
        description.includes('棒') || description.includes('差') || description.includes('爱') || description.includes('恨')) {
        return '评价';
    }
    if (description.includes('发生') || description.includes('遇到') || description.includes('摔') || 
        description.includes('坏了') || description.includes('迟到') || description.includes('遇见') ||
        description.includes('刚才') || description.includes('刚刚') || description.includes('刚') || 
        description.includes('刚好') || description.includes('正在') || description.includes('现在')) {
        return '事件';
    }
    if (description.includes('穿') || description.includes('窗外') || description.includes('房间') || 
        description.includes('外面') || description.includes('今天') || description.includes('现在') ||
        description.includes('当前') || description.includes('此刻') || description.includes('环境') ||
        description.includes('场景') || description.includes('气氛') || description.includes('音乐') ||
        description.includes('灯光') || description.includes('声音')) {
        return '场景';
    }
    return '其他';
}

// 🎭 伏笔重要性计算 - 门徒版：专注实时连贯性
export function calculateForeshadowingImportance(description) {
    let importance = 50; // 基础重要性
    
    // 近期时间标识词增加重要性（实时性高）
    if (description.includes('刚才') || description.includes('刚刚') || description.includes('刚') || 
        description.includes('现在') || description.includes('当前') || description.includes('此刻') ||
        description.includes('今天') || description.includes('明天') || description.includes('等会')) {
        importance += 25; // 实时性很重要
    }
    
    // 约定承诺类（高连贯性）
    if (description.includes('约定') || description.includes('承诺') || description.includes('答应')) {
        importance += 20;
    }
    
    // 评价类（中等连贯性，容易被引用）
    if (description.includes('好') || description.includes('坏') || description.includes('丑') || 
        description.includes('棒') || description.includes('差')) {
        importance += 15;
    }
    
    // 情感相关（高连贯性）
    if (description.includes('喜欢') || description.includes('讨厌') || description.includes('爱') || 
        description.includes('恨') || description.includes('开心') || description.includes('生气')) {
        importance += 15;
    }
    
    // 场景细节（中等连贯性）
    if (description.includes('穿') || description.includes('环境') || description.includes('外面') ||
        description.includes('房间') || description.includes('声音') || description.includes('灯光')) {
        importance += 10;
    }
    
    return Math.min(importance, 100);
}

// 🎭 伏笔相似性检测
export function isForeshadowingSimilar(desc1, desc2) {
    if (!desc1 || !desc2) return false;
    
    // 简单的相似性检测
    const normalize = (text) => text.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, '');
    const norm1 = normalize(desc1);
    const norm2 = normalize(desc2);
    
    // 完全相同
    if (norm1 === norm2) return true;
    
    // 包含关系 (80%以上重叠)
    const shorter = norm1.length < norm2.length ? norm1 : norm2;
    const longer = norm1.length >= norm2.length ? norm1 : norm2;
    if (longer.includes(shorter) && shorter.length > longer.length * 0.8) return true;
    
    // 关键词重叠度检测
    const words1 = norm1.split(/\s+/).filter(w => w.length > 1);
    const words2 = norm2.split(/\s+/).filter(w => w.length > 1);
    if (words1.length === 0 || words2.length === 0) return false;
    
    const commonWords = words1.filter(w => words2.includes(w));
    const overlapRatio = commonWords.length / Math.min(words1.length, words2.length);
    
    return overlapRatio > 0.7; // 70%以上关键词重叠认为相似
}

// 🧹 伏笔数量管理
export function manageForeshadowingCount() {
    // 🧹 伏笔数量管理 - 门徒版：保持轻量化
    const MAX_FORESHADOWINGS = 8;  // 降低最大数量，专注近期
    const TARGET_COUNT = 6;        // 目标保留数量
    
    if (pigTrapsData.traps.foreshadowing.length > MAX_FORESHADOWINGS) {
        console.log(`🐷 🧹 伏笔数量过多(${pigTrapsData.traps.foreshadowing.length})，开始清理...`);
        
        // 按重要性和时间排序，保留最重要且最新的
        pigTrapsData.traps.foreshadowing.sort((a, b) => {
            const importanceDiff = (b.metadata.importance || 50) - (a.metadata.importance || 50);
            if (Math.abs(importanceDiff) > 10) return importanceDiff;
            return new Date(b.createdAt) - new Date(a.createdAt);
        });
        
        // 保留前N个最重要的
        const removed = pigTrapsData.traps.foreshadowing.splice(TARGET_COUNT);
        console.log(`🐷 🧹 清理完成：移除${removed.length}个伏笔，保留${pigTrapsData.traps.foreshadowing.length}个`);
    }
}

// 统一的聊天标识符生成，避免重复条目
export async function getStableChatIdentifier() {
    try {
        // 优先使用文件名作为稳定标识符
        if (typeof this_chid !== 'undefined' && this_chid !== null) {
            const character = characters[this_chid];
            if (character && character.chat) {
                // 使用聊天文件名作为稳定ID
                const chatFileName = character.chat.replace(/\.(json|jsonl)$/, '');
                console.log(`🐷 使用聊天文件名作为ID: ${chatFileName}`);
                return chatFileName;
            }
        }
        
        // 备用方案：使用当前时间戳（但会造成重复，需要优化）
        if (typeof getCurrentChatIdentifier === 'function') {
            const id = await getCurrentChatIdentifier();
            console.log(`🐷 使用getCurrentChatIdentifier: ${id}`);
            return id;
        }
        
        // 最后备用：生成基于页面的稳定ID
        const url = window.location.href;
        const stable_id = `chat_${btoa(url).slice(0, 12)}`;
        console.log(`🐷 生成稳定ID: ${stable_id}`);
        return stable_id;
        
    } catch (error) {
        console.error('🐷 获取聊天标识符失败:', error);
        return `fallback_chat_${Date.now()}`;
    }
}


// 实时监听系统
export const PigRealtimeManager = {
    
    // 启动实时监听
    start() {
        // 🔧 添加防重复启动检查
        if (pigRealtimeTimer) {
            console.log('🐷 实时监听已在运行，跳过重复启动');
            return;
        }
        
        if (!pigRealtimeEnabled) {
            console.log('🐷 实时模式已禁用，无法启动');
            return;
        }
        
        console.log('🐷 启动实时监听系统...');
        pigRealtimeStatus = PIG_REALTIME_STATUS.IDLE;
        
        // 🔥 核心：每两分钟检查一次新消息
        pigRealtimeTimer = setInterval(async () => {
            if (!pigRealtimeEnabled) {
                console.log('🐷 实时模式已禁用，停止检查');
                return;
            }
            
            try {
                await this.checkForNewMessages();
            } catch (error) {
                console.error('🐷 实时检查失败:', error);
            }
        }, 120000); // 两分钟间隔
        
        this.updateButtonState();
        console.log('🐷 实时监听已启动，定时器ID:', pigRealtimeTimer);
    },
    
    // 停止实时监听
    stop() {
        console.log('🐷 停止实时监听系统...');
        pigRealtimeStatus = PIG_REALTIME_STATUS.DISABLED;
        
        if (pigRealtimeTimer) {
            clearInterval(pigRealtimeTimer);
            pigRealtimeTimer = null;
            console.log('🐷 定时器已清除');
        }
        
        this.updateButtonState();
        console.log('🐷 实时监听已停止');
    },
    
    // 检查新消息
    async checkForNewMessages() {
        const currentCount = await core.getCachedMessageCount();
        
        // 如果消息数量没变化，保持空闲状态
        if (currentCount <= pigLastMessageCount) {
            pigRealtimeStatus = PIG_REALTIME_STATUS.IDLE;
            this.updateButtonState();
            return;
        }
        
        // 发现新消息！
        const newMessages = currentCount - pigLastMessageCount;
        console.log(`🐷 实时检测到 ${newMessages} 条新消息`);
        
        pigRealtimeStatus = PIG_REALTIME_STATUS.WORKING;
        pigLastActivity = Date.now();
        this.updateButtonState();
        
        // 🎯 自动分析新消息
        try {
            const context = await getContext();
            const messages = core.getMessageArray(context);
            const recentMessages = messages.slice(-Math.min(newMessages + 1, 3));
            
            await pigSmartDualMode(recentMessages, 'realtime');
            
            pigRealtimeStatus = PIG_REALTIME_STATUS.ACTIVE;
            pigLastMessageCount = currentCount;
            
            // 显示实时分析成功的反馈
            this.showActivityFeedback(newMessages);
            
        } catch (error) {
            console.error('🐷 实时分析失败:', error);
            pigRealtimeStatus = PIG_REALTIME_STATUS.IDLE;
        }
        
        // 3秒后回到空闲状态
        setTimeout(() => {
            if (pigRealtimeStatus === PIG_REALTIME_STATUS.ACTIVE) {
                pigRealtimeStatus = PIG_REALTIME_STATUS.IDLE;
                this.updateButtonState();
            }
        }, 3000);
    },
    
    // 更新按钮状态
    updateButtonState() {
        const realtimeBtn = document.getElementById('pig_realtime_toggle');
        if (!realtimeBtn) return;
        
        const statusInfo = this.getStatusInfo();
        
        console.log(`🐷 更新按钮状态: ${statusInfo.text} (${pigRealtimeEnabled ? '启用' : '禁用'})`);
        
        // 更新按钮样式和文字
        realtimeBtn.style.background = statusInfo.background;
        realtimeBtn.innerHTML = `${statusInfo.icon} ${statusInfo.text}`;
        realtimeBtn.style.transition = 'all 0.3s ease';
        
        // 添加动画效果
        if (statusInfo.animate) {
            realtimeBtn.style.animation = statusInfo.animate;
        } else {
            realtimeBtn.style.animation = 'none';
        }
        
        // 更新tooltip
        realtimeBtn.title = statusInfo.tooltip;
    },
    
    // 获取状态信息
    getStatusInfo() {
        switch (pigRealtimeStatus) {
            case PIG_REALTIME_STATUS.ACTIVE:
                return {
                    background: 'linear-gradient(135deg, #4caf50, #81c784)',
                    icon: '🔥',
                    text: '活跃中',
                    animate: 'gentleHeartBeat 1s ease-in-out infinite',
                    tooltip: '刚刚分析了新消息，门徒很活跃！'
                };
                
            case PIG_REALTIME_STATUS.WORKING:
                return {
                    background: 'linear-gradient(135deg, #ff9800, #ffb74d)',
                    icon: '🧠',
                    text: '分析中',
                    animate: 'bounce 1s ease-in-out infinite',
                    tooltip: '门徒正在分析新消息...'
                };
                
            case PIG_REALTIME_STATUS.IDLE:
                return {
                    background: 'linear-gradient(135deg, #2196f3, #64b5f6)',
                    icon: '👁️',
                    text: '监听中',
                    animate: 'breathe 3s ease-in-out infinite',
                    tooltip: '门徒在安静地监听，等待新消息...'
                };
                
            case PIG_REALTIME_STATUS.DISABLED:
            default:
                return {
                    background: 'linear-gradient(135deg, #9e9e9e, #bdbdbd)',
                    icon: '😴',
                    text: '已暂停',
                    animate: 'none',
                    tooltip: '点击启动实时监听'
                };
        }
    },
    
    // 显示活动反馈
    showActivityFeedback(messageCount) {
        // 更新最后活动时间显示
        const updateEl = document.getElementById('pig_last_update');
        if (updateEl) {
            updateEl.textContent = '刚刚';
            updateEl.style.color = '#4caf50';
            updateEl.style.fontWeight = 'bold';
            
            // 3秒后恢复正常样式
            setTimeout(() => {
                updateEl.style.color = '';
                updateEl.style.fontWeight = '';
            }, 3000);
        }
        
        // 显示Toast通知
        if (typeof toastr !== 'undefined') {
            toastr.success(
                `🐷 实时分析了 ${messageCount} 条新消息`, 
                '门徒实时监听', 
                { timeOut: 2000 }
            );
        }
    }
};

window.addEventListener('beforeunload', () => {
    if (pigRealtimeTimer) {
        clearInterval(pigRealtimeTimer);
    }
});
// ===== 🐖门徒系统结束👆 =====
