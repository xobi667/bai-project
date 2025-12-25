
// 🔑 版本标记 - 用于确认浏览器加载了最新代码
const APP_VERSION = '2024-12-24-v62-ApplePolish';
console.log('🚀 App.js 版本:', APP_VERSION);

// 🚀 初始化应用工作流
window.addEventListener('load', () => {
    if (typeof setActiveStep === 'function') {
        setActiveStep(1);
        console.log('✨ Workflow Step 1 initialized');
    }
});

// 全局变量
// 定义所有需要序列化的 Fabric 属性列表
const FABRIC_SERIALIZE_PROPS = [
    'left', 'top', 'width', 'height', 'scaleX', 'scaleY', 'angle',
    'selectable', 'hasControls', 'originalStyle', 'padding', 'borderColor',
    'cornerColor', 'cornerSize', 'transparentCorners', 'splitByGrapheme',
    'breakWords', 'lockScalingFlip', 'fontSize', 'fontFamily', 'fontWeight',
    'fontStyle', 'fill', 'stroke', 'strokeWidth', 'paintFirst', 'textAlign', 'charSpacing', 'lineHeight',
    'rx', 'ry', 'isUserRect', '_originalRx', '_originalRy',
    'path', 'globalCompositeOperation', 'shadow',
    'isInpaintPath'  // 🔑 用于标记智能涂抹临时路径，序列化时过滤掉
];


// 🔑 统一序列化函数
function serializeCanvas(c) {
    if (!c) return null;
    const json = c.toJSON(FABRIC_SERIALIZE_PROPS);
    // 🔑 排除智能涂抹的临时路径（它们不应该被保存）
    if (json.objects) {
        json.objects = json.objects.filter(obj => !obj.isInpaintPath);
    }
    return json;
}

// 🔑 保存当前画布状态到 appState 的辅助函数
function syncCurrentCanvasToState() {
    if (canvas && appState.currentLang && appState.currentIndex >= 0) {
        const translations = appState.translations;
        if (translations && translations[appState.currentLang]) {
            const currentImgObj = translations[appState.currentLang].images[appState.currentIndex];
            if (currentImgObj) {
                currentImgObj.canvasData = serializeCanvas(canvas);
                console.log('💾 同步当前画布到 appState');
            }
        }
    }
}

// 全局状态管理
const appState = {

    images: [], // {id, file, url, status, result, canvasData, thumbnail}
    currentIndex: -1,
    syncLock: false,
    mobileActivePanel: null, // 'left', 'right', or null
    currentHistoryName: null // 🔑 当前正在编辑的历史记录名称（如果有），用于覆盖保存
};

let canvas = null;
let currentImage = null; // 兼容性：指向当前图片
let currentFilename = 'translated_image.png';
let selectedObject = null;
let selectedObjectsArray = null; // 用于存储多选的对象数组

// 操作历史记录 - 每张图片独立历史栈（重构版：不使用 loadFromJSON，避免黑屏）
const history = {
    isPerformingAction: false,
    isSavingDisabled: false, // 🔑 新增：用于在批量加载或刷新期间禁止保存状态
    maxStackSize: 30,

    // 需要保存的属性列表
    propertyList: [
        'type', 'left', 'top', 'width', 'height', 'scaleX', 'scaleY', 'angle',
        'fontSize', 'fontFamily', 'fontWeight', 'fontStyle', 'fill', 'stroke',
        'strokeWidth', 'paintFirst', 'textAlign', 'charSpacing', 'lineHeight',
        'text', 'splitByGrapheme', 'breakWords', 'padding', 'originX', 'originY',
        'rx', 'ry', 'isUserRect', '_originalRx', '_originalRy', 'shadow', 'globalCompositeOperation'
    ],

    // 🔑 获取当前图片的历史数据（每个语言+图片索引独立）
    getImageHistory() {
        if (!appState.currentLang || !appState.translations[appState.currentLang]) return null;
        const images = appState.translations[appState.currentLang].images;
        if (!images || appState.currentIndex < 0 || appState.currentIndex >= images.length) return null;

        const imgObj = images[appState.currentIndex];
        if (!imgObj.historyData) {
            imgObj.historyData = { undoStack: [], redoStack: [] };
        }
        return imgObj.historyData;
    },

    // 🔑 序列化当前画布上的可编辑对象（确保获取绝对坐标）
    serializeObjects() {
        if (!canvas) return [];

        // 🔑 关键：获取对象前，先排除所有处于 ActiveSelection 状态的相对坐标影响
        // 🖌️ 新增：支持画笔路径(path)类型
        const objects = canvas.getObjects().filter(obj =>
            obj.type === 'textbox' || obj.type === 'i-text' || obj.type === 'rect' || obj.type === 'path');

        return objects.map(obj => {
            const data = {};

            // 🔑 处理坐标：如果在多选组中，获取其绝对坐标
            const isInsideGroup = obj.group && obj.group.type === 'activeSelection';
            let left = obj.left;
            let top = obj.top;

            if (isInsideGroup) {
                // 如果在组内，计算绝对位置
                const center = obj.getCenterPoint();
                left = center.x - (obj.width * obj.scaleX) / 2;
                top = center.y - (obj.height * obj.scaleY) / 2;
            }

            this.propertyList.forEach(prop => {
                if (prop === 'left') data.left = left;
                else if (prop === 'top') data.top = top;
                else if (obj[prop] !== undefined) {
                    data[prop] = obj[prop];
                }
            });
            // 🖌️ 画笔路径需要额外保存path数据
            if (obj.type === 'path' && obj.path) {
                data.path = obj.path;
            }
            return data;
        });
    },

    // 🔑 从序列化数据重建对象到画布
    restoreObjects(objectsData) {
        if (!canvas || !objectsData) return;

        this.isSavingDisabled = true; // 🔑 锁定保存

        // 只删除可编辑对象（保留背景图）
        // 🖌️ 新增：支持画笔路径(path)类型
        const toRemove = canvas.getObjects().filter(obj =>
            obj.type === 'textbox' || obj.type === 'i-text' || obj.type === 'rect' || obj.type === 'path');
        toRemove.forEach(obj => canvas.remove(obj));

        // 重建对象
        objectsData.forEach(objData => {
            // ... (此处逻辑不变，缩略显示)
            let fabricObj = null;
            if (objData.type === 'textbox' || objData.type === 'i-text' || objData.type === 'text') {
                fabricObj = new fabric.Textbox(objData.text || '', {
                    left: objData.left || 0,
                    top: objData.top || 0,
                    width: objData.width || 200,
                    fontSize: objData.fontSize || 16,
                    fontFamily: objData.fontFamily || 'Arial',
                    fontWeight: objData.fontWeight || 'normal',
                    fontStyle: objData.fontStyle || 'normal',
                    fill: objData.fill !== undefined ? objData.fill : '#000000',
                    textAlign: objData.textAlign || 'left',
                    lineHeight: objData.lineHeight || 1.16,
                    charSpacing: objData.charSpacing || 0,
                    stroke: objData.stroke !== undefined ? objData.stroke : null,
                    strokeWidth: objData.strokeWidth !== undefined ? objData.strokeWidth : 0,
                    paintFirst: objData.paintFirst || 'fill',
                    scaleX: objData.scaleX || 1,
                    scaleY: objData.scaleY || 1,
                    angle: objData.angle || 0,
                    originX: objData.originX || 'left',
                    originY: objData.originY || 'top',
                    splitByGrapheme: objData.splitByGrapheme || false,
                    breakWords: objData.breakWords || false,
                    padding: objData.padding || 0,
                    borderColor: '#0A84FF',
                    cornerColor: '#0A84FF',
                    cornerSize: 10,
                    transparentCorners: false,
                    shadow: objData.shadow ? new fabric.Shadow(objData.shadow) : null
                });
            } else if (objData.type === 'rect') {
                fabricObj = new fabric.Rect({
                    left: objData.left || 0,
                    top: objData.top || 0,
                    width: objData.width || 100,
                    height: objData.height || 50,
                    fill: objData.fill !== undefined ? objData.fill : '#000000',
                    stroke: objData.stroke !== undefined ? objData.stroke : null,
                    strokeWidth: objData.strokeWidth !== undefined ? objData.strokeWidth : 0,
                    rx: objData.rx || 0,
                    ry: objData.ry || 0,
                    scaleX: objData.scaleX || 1,
                    scaleY: objData.scaleY || 1,
                    angle: objData.angle || 0,
                    isUserRect: true,
                    _originalRx: objData._originalRx || objData.rx || 0,
                    _originalRy: objData._originalRy || objData.ry || 0,
                    borderColor: '#0A84FF',
                    cornerColor: '#0A84FF',
                    cornerSize: 10,
                    transparentCorners: false,
                    shadow: objData.shadow ? new fabric.Shadow(objData.shadow) : null
                });

                // 绑定矩形缩放监听器
                fabricObj.on('scaling', function () {
                    this.set('rx', this._originalRx || 0);
                    this.set('ry', this._originalRy || 0);
                });
            } else if (objData.type === 'path' && objData.path) {
                // 🖌️ 恢复画笔路径
                fabricObj = new fabric.Path(objData.path, {
                    left: objData.left || 0,
                    top: objData.top || 0,
                    fill: objData.fill || null,
                    stroke: objData.stroke || '#000000',
                    strokeWidth: objData.strokeWidth || 1,
                    scaleX: objData.scaleX || 1,
                    scaleY: objData.scaleY || 1,
                    angle: objData.angle || 0,
                    strokeLineCap: 'round',
                    strokeLineJoin: 'round',
                    globalCompositeOperation: objData.globalCompositeOperation || 'source-over',
                    // 画笔路径不可选择
                    selectable: false,
                    evented: false,
                    hoverCursor: 'default'
                });
            }

            if (fabricObj) {
                canvas.add(fabricObj);
                fabricObj.setCoords(); // 🔑 强制同步包围盒和坐标点
            }
        });

        this.isSavingDisabled = false; // 🔑 解锁保存
        canvas.renderAll();
    },

    // 保存当前状态
    saveState() {
        if (this.isPerformingAction || this.isSavingDisabled) return;
        if (!canvas) return;

        const historyData = this.getImageHistory();
        if (!historyData) return;

        const objectsData = this.serializeObjects();
        // 🔑 优化：允许保存空数组（即空画布状态），以便撤销到最初落脚点
        const stateToSave = JSON.stringify(objectsData);

        // 如果栈顶已经是这个状态，不要重复保存
        if (historyData.undoStack.length > 0 && historyData.undoStack[historyData.undoStack.length - 1] === stateToSave) {
            return;
        }

        historyData.undoStack.push(stateToSave);
        console.log(`💾 saveState: 图片${appState.currentIndex}, 栈深度=${historyData.undoStack.length}`);

        // 清空重做栈
        historyData.redoStack = [];

        // 限制历史记录大小
        if (historyData.undoStack.length > this.maxStackSize) {
            historyData.undoStack.shift();
        }

        this.updateButtonStates();
    },

    // 撤销 (Ctrl+Z)
    undo() {
        const historyData = this.getImageHistory();
        if (!canvas || !historyData || historyData.undoStack.length <= 1) {
            console.log('❌ 无法撤销：栈为空或已是初始状态');
            return;
        }

        this.isPerformingAction = true;
        console.log('⬅️ 撤销操作');

        // 🔑 逻辑修复：弹出当前状态到重做栈，然后恢复撤销栈的新栈顶
        const currentState = historyData.undoStack.pop();
        historyData.redoStack.push(currentState);

        // 获取新的栈顶状态并恢复
        const previousState = JSON.parse(historyData.undoStack[historyData.undoStack.length - 1]);
        this.restoreObjects(previousState);

        this.isPerformingAction = false;
        this.updateButtonStates();
        console.log('✅ 撤销完成，剩余次数:', historyData.undoStack.length - 1);
    },

    // 重做 (Ctrl+Alt+Z 或 Ctrl+Y)
    redo() {
        const historyData = this.getImageHistory();
        if (!canvas || !historyData || historyData.redoStack.length === 0) {
            console.log('❌ 无法重做：栈为空');
            return;
        }

        this.isPerformingAction = true;
        console.log('➡️ 重做操作');

        // 🔑 逻辑修复：从重做栈弹出，存回撤销栈，然后恢复该状态
        const nextState = historyData.redoStack.pop();
        historyData.undoStack.push(nextState);

        this.restoreObjects(JSON.parse(nextState));

        this.isPerformingAction = false;
        this.updateButtonStates();
        console.log('✅ 重做完成');
    },

    // 更新按钮状态
    updateButtonStates() {
        const historyData = this.getImageHistory();
        const undoBtn = document.getElementById('undoBtn');
        const redoBtn = document.getElementById('redoBtn');

        // 🔑 逻辑修复：由于 undoStack 包含当前状态，只有 length > 1 时才能撤销
        if (undoBtn) {
            undoBtn.disabled = !historyData || historyData.undoStack.length <= 1;
        }
        if (redoBtn) {
            redoBtn.disabled = !historyData || historyData.redoStack.length === 0;
        }
    },

    // 清除当前图片历史
    clear() {
        const historyData = this.getImageHistory();
        if (historyData) {
            historyData.undoStack = [];
            historyData.redoStack = [];
        }
        this.updateButtonStates();
        console.log('🧹 当前图片历史记录已清空');
    }
};

// 页面加载完成时执行
document.addEventListener('DOMContentLoaded', function () {
    console.log('🚀 DOMContentLoaded fired - starting initialization');

    // 加载主题设置
    const savedTheme = localStorage.getItem('theme') || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);

    // 🔑 绑定历史记录展开事件（始终可见的历史记录）
    const historyDetails = document.getElementById('quick-history-details');
    if (historyDetails) {
        historyDetails.addEventListener('toggle', function () {
            if (this.open && typeof loadQuickHistory === 'function') {
                loadQuickHistory();
            }
        });
    }

    // 绑定主题切换按钮 (药丸型) - 纯CSS transition，无卡顿
    const themeToggleBtn = document.getElementById('theme-toggle');

    if (themeToggleBtn) {
        themeToggleBtn.addEventListener('click', function () {
            const html = document.documentElement;
            const currentTheme = html.getAttribute('data-theme');
            const newTheme = currentTheme === 'dark' ? 'light' : 'dark';

            // 🎬 简单切换，让CSS transition处理动画
            html.setAttribute('data-theme', newTheme);
            localStorage.setItem('theme', newTheme);

            console.log('🎨 主题已切换到:', newTheme);
        });
    } else {
        console.warn('⚠️ theme-toggle not found - skipping');
    }

    // 绑定刷新按钮 (with null check)
    const refreshBtn = document.getElementById('refreshButton');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', function () {
            location.reload();
        });
    } else {
        console.warn('⚠️ refreshButton not found - skipping');
    }

    console.log('✅ Theme and refresh handlers initialized');

    // ========== 新UI交互逻辑 ==========

    // 步骤指示器
    function updateStep(stepNum) {
        document.querySelectorAll('.step').forEach(step => {
            const num = parseInt(step.dataset.step);
            step.classList.remove('active', 'completed');
            if (num < stepNum) {
                step.classList.add('completed');
            } else if (num === stepNum) {
                step.classList.add('active');
            }
        });
    }

    // 语言交换按钮 - 已移除，不适用于多语言勾选模式
    // 原来的swapLangs按钮引用了已不存在的target-lang下拉框

    // 上传区域拖拽功能 (click removed - label[for=input] handles it natively)
    const uploadZone = document.getElementById('uploadZone');
    const fileInput = document.getElementById('multi-image-upload');

    if (uploadZone && fileInput) {
        // Note: Click is NOT added here because uploadZone is a <label for="multi-image-upload">
        // which natively triggers the input on click. Adding JS click causes double-dialog.

        uploadZone.addEventListener('dragenter', (e) => {
            e.preventDefault();
            uploadZone.classList.add('dragover');
        });

        uploadZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadZone.classList.add('dragover');
        });

        uploadZone.addEventListener('dragleave', () => {
            uploadZone.classList.remove('dragover');
        });

        uploadZone.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadZone.classList.remove('dragover');
            if (e.dataTransfer.files.length) {
                // 直接调用处理函数，因为 programmatic 修改 files 不会触发 change 事件
                handleImageUpload(e.dataTransfer.files);
            }
        });
        console.log('✅ Upload drag/drop handlers bound (click handled natively by label)');
    }

    // 绑定上传事件 (with null check and debug)
    if (fileInput) {
        fileInput.addEventListener('change', function () {
            console.log('📁 File input change event fired, files:', this.files.length);
            if (this.files.length > 0) {
                // 更新选择计数提示
                const countPreview = document.getElementById('file-count-preview');
                if (countPreview) {
                    countPreview.textContent = `已选择 ${this.files.length} 张图片`;
                    countPreview.style.display = 'block';
                }
                handleImageUpload(this.files);
            }
        });
        console.log('✅ File input change listener bound');
    } else {
        console.warn('⚠️ fileInput not found');
    }
    // 绑定翻译按钮 - 增强版带调试信息
    const translateBtn = document.getElementById('translate-button');
    if (translateBtn) {
        console.log('✅ 翻译按钮找到，正在绑定事件监听器');
        translateBtn.addEventListener('click', function (e) {
            console.log('🔥 翻译按钮被点击了！');
            console.log('当前图片数量:', appState.images ? appState.images.length : 0);

            // 添加视觉反馈 - 按钮抖动
            this.style.transform = 'scale(0.95)';
            setTimeout(() => { this.style.transform = 'scale(1)'; }, 100);

            if (!appState.images || appState.images.length === 0) {
                const statusElem = document.getElementById('uploadStatus');
                statusElem.textContent = '⚠️ 请先上传图片！';
                statusElem.style.color = '#f43f5e';
                statusElem.style.fontSize = '16px';
                statusElem.style.fontWeight = 'bold';
                console.warn('❌ 没有图片，无法翻译');
                alert('请先上传图片再点击翻译！');
                return;
            }

            console.log('✅ 开始调用 translateImage()');
            translateImage();
        });
        console.log('✅ 事件监听器绑定成功');
    } else {
        console.error('❌ 找不到翻译按钮！');
        alert('错误：找不到翻译按钮元素！');
    }

    // 🔑 纯色背景模式勾选框交互
    const solidBgCheckbox = document.getElementById('solid-bg-mode');
    const smartBgCheckbox = document.getElementById('smart-bg-mode');
    const solidBgHint = document.getElementById('solid-bg-hint');
    const bgModelSelector = document.getElementById('bg-model-selector');

    if (solidBgCheckbox) {
        solidBgCheckbox.addEventListener('change', function () {
            if (this.checked) {
                // 互斥：如果勾选了纯色，取消智能背景
                if (smartBgCheckbox && smartBgCheckbox.checked) {
                    smartBgCheckbox.checked = false;
                }

                // 勾选：显示提示，禁用模型选择器
                if (solidBgHint) solidBgHint.style.display = 'block';
                if (bgModelSelector) bgModelSelector.classList.add('disabled-by-solid');
                console.log('🎨 启用纯色背景模式');
            } else {
                // 取消勾选：隐藏提示，启用模型选择器
                if (solidBgHint) solidBgHint.style.display = 'none';
                if (bgModelSelector) bgModelSelector.classList.remove('disabled-by-solid');
                console.log('🎨 禁用纯色背景模式');
            }
        });
    }

    if (smartBgCheckbox) {
        smartBgCheckbox.addEventListener('change', function () {
            if (this.checked) {
                console.log('⚡ 启用智能背景模式');
                // 互斥：如果勾选了智能，取消纯色（通过模拟点击触发逻辑）
                if (solidBgCheckbox && solidBgCheckbox.checked) {
                    solidBgCheckbox.click();
                }
            } else {
                console.log('⚡ 禁用智能背景模式');
            }
        });
    }

    // 集中管理键盘快捷键
    document.addEventListener('keydown', function (e) {
        // 如果在输入框中，或者正在执行历史操作，不处理
        const activeElement = document.activeElement;
        const isInputField = activeElement && (
            activeElement.tagName === 'INPUT' ||
            activeElement.tagName === 'TEXTAREA' ||
            activeElement.contentEditable === 'true'
        );

        const key = e.key.toLowerCase();

        // Ctrl+Z: 撤销
        if (e.ctrlKey && key === 'z' && !e.shiftKey && !e.altKey) {
            e.preventDefault();
            history.undo();
        }

        // Ctrl+Shift+Z 或 Ctrl+Y: 重做
        if ((e.ctrlKey && e.shiftKey && key === 'z') || (e.ctrlKey && key === 'y')) {
            e.preventDefault();
            history.redo();
        }

        // Delete 或 Backspace: 删除选中的对象
        if ((e.key === 'Delete' || e.key === 'Backspace') && !isInputField) {
            if (canvas) {
                const activeObjects = canvas.getActiveObjects();
                if (activeObjects && activeObjects.length > 0) {
                    e.preventDefault();
                    // 在删除前保存状态
                    history.saveState();
                    activeObjects.forEach(obj => {
                        canvas.remove(obj);
                    });
                    canvas.discardActiveObject();
                    canvas.renderAll();
                    console.log('🗑️ 删除了', activeObjects.length, '个对象');
                }
            }
        }

        // Ctrl+A: 全选
        if (e.ctrlKey && key === 'a' && !isInputField) {
            e.preventDefault();
            if (canvas) {
                canvas.discardActiveObject();
                const objects = canvas.getObjects().filter(obj =>
                    obj.type === 'textbox' || obj.type === 'i-text' || obj.type === 'rect'
                );
                if (objects.length > 0) {
                    const selection = new fabric.ActiveSelection(objects, { canvas: canvas });
                    canvas.setActiveObject(selection);
                    canvas.requestRenderAll();
                }
            }
        }
    });

    // 🔑 鼠标滚轮调整数字输入框数值
    document.addEventListener('wheel', function (e) {
        const activeElement = document.activeElement;
        if (activeElement && activeElement.tagName === 'INPUT' && activeElement.type === 'number') {
            // 只有当输入框处于焦点状态时才生效
            e.preventDefault();

            const step = parseFloat(activeElement.step) || 1;
            const direction = e.deltaY < 0 ? 1 : -1;
            let val = parseFloat(activeElement.value) || 0;

            let newVal = val + direction * step;

            // 边界检查
            if (activeElement.min !== '' && newVal < parseFloat(activeElement.min)) newVal = parseFloat(activeElement.min);
            if (activeElement.max !== '' && newVal > parseFloat(activeElement.max)) newVal = parseFloat(activeElement.max);

            // 修复浮点数精度问题
            const precision = (step.toString().split('.')[1] || '').length;
            activeElement.value = newVal.toFixed(precision);

            // 触发 change 和 input 事件以同步 UI (比如滑块)
            activeElement.dispatchEvent(new Event('change', { bubbles: true }));
            activeElement.dispatchEvent(new Event('input', { bubbles: true }));
        }
    }, { passive: false });

    // 绑定字体大小滑块和数字输入框 (with null checks)
    const fontSizeSlider = document.getElementById('font-size');
    const fontSizeInput = document.getElementById('font-size-input');
    console.log('🔧 Font size slider:', fontSizeSlider, 'input:', fontSizeInput);

    function applyFontSize(value) {
        const targetVisualSize = parseInt(value);
        console.log('📏 applyFontSize called with visual size:', targetVisualSize);

        function scaleTextbox(obj) {
            if (obj.type !== 'textbox' && obj.type !== 'i-text') return;

            const oldBaseSize = obj.fontSize || 20;
            const scale = obj.scaleY || 1;

            // 🔑 核心修复：计算所需的内部fontSize，以抵消scale的影响
            // visualSize = fontSize * scale  =>  fontSize = visualSize / scale
            const newBaseSize = targetVisualSize / scale;

            const ratio = newBaseSize / oldBaseSize;

            // Only scale width if ratio is significant
            if (Math.abs(ratio - 1) > 0.01) {
                const oldWidth = obj.width;
                const newWidth = oldWidth * ratio;
                const textAlign = obj.textAlign || 'left';

                // Calculate position adjustment based on text alignment
                let leftAdjust = 0;
                if (textAlign === 'center') {
                    // Center-aligned: expand equally from center
                    leftAdjust = (oldWidth - newWidth) / 2;
                } else if (textAlign === 'right') {
                    // Right-aligned: anchor to right edge
                    leftAdjust = oldWidth - newWidth;
                }
                // Left-aligned: no adjustment needed (anchor to left edge)

                obj.set({
                    fontSize: newBaseSize,
                    width: newWidth,
                    left: obj.left + leftAdjust
                });

                // ========== 🧱 边界限制 (核心修复) ==========
                const canvasWidth = canvas.getWidth();
                const padding = 10;
                const scaledWidth = newWidth * scale; // 渲染后的实际宽度
                if (obj.left + scaledWidth > canvasWidth - padding) {
                    obj.left = Math.max(padding, canvasWidth - padding - scaledWidth);
                    // 如果推到头了仍然超出，缩减内部宽度（触发折行）
                    if (obj.left + scaledWidth > canvasWidth - padding) {
                        obj.width = Math.max(50, (canvasWidth - padding - obj.left) / scale);
                    }
                }
                if (obj.left < padding) obj.left = padding;

                obj.setCoords(); // Update bounding box
                console.log('  → Scaled textbox: fontSize=' + newBaseSize.toFixed(1) + ' (Visual: ' + targetVisualSize + '), width=' + newWidth.toFixed(1));
                // 🔑 关键修复：多选调整字号时，同时也调整文本框宽度以适应
                // 否则字变大框不变，文字会换行或消失
                if (obj.type === 'textbox') {
                    // 1. 设置新字号
                    obj.set('fontSize', newBaseSize);

                    // 2. 测量新字号下的自然宽度
                    // 创建一个临时对象来测量一行到底有多宽
                    const tempText = new fabric.Textbox(obj.text, {
                        fontSize: newBaseSize,
                        fontFamily: obj.fontFamily,
                        fontWeight: obj.fontWeight,
                        fontStyle: obj.fontStyle,
                        scaleX: obj.scaleX,
                        scaleY: obj.scaleY,
                        width: 99999 // 足够宽以确保单行
                    });

                    // 3. 计算适配宽度
                    // 我们希望保持字号变化后，文本依然是一行(或者原来排版)，所以主要防止意外折行
                    // 这里我们简单做：如果原来的文字没换行（不包含\n），现在也不要换行
                    // 使用 includes('\n') 比检查 textLines 更可靠，因为 textLines 可能是滞后的
                    if (obj.text && !obj.text.includes('\n')) {
                        const neededWidth = tempText.calcTextWidth() + 15;
                        const currentScaleX = obj.scaleX || 1;
                        let newScaledWidth = neededWidth; // 实际需要的渲染宽度
                        let newLeft = obj.left;

                        const canvasWidth = canvas.width || 800;
                        const padding = 10;

                        // ========== 🧱 字号调整时的边界防御 ==========
                        // 1. 如果右边溢出，向左移动
                        if (newLeft + newScaledWidth > canvasWidth - padding) {
                            newLeft = canvasWidth - padding - newScaledWidth;
                        }

                        // 2. 如果左边溢出（因为上面向左移导致，或者是本身就溢出），强制贴左边
                        if (newLeft < padding) {
                            newLeft = padding;
                            // 如果还是放不下，强制缩小宽度
                            if (newScaledWidth > canvasWidth - 2 * padding) {
                                newScaledWidth = canvasWidth - 2 * padding;
                            }
                        }

                        // 应用新的位置和宽度
                        obj.set('width', newScaledWidth / currentScaleX);
                        obj.set('left', newLeft);
                    }
                } else {
                    obj.set('fontSize', newBaseSize);
                }

                obj.setCoords();
            } else {
                obj.set('fontSize', newBaseSize);
                obj.setCoords();
            }
        }



        // 🔑 恢复执行逻辑：遍历选中对象并应用缩放
        // 优先使用当前画布的选中对象，比全局变量更可靠
        // ⚠️ 关键步骤：先获取对象，然后【立即解除组合】。
        // 为什么？因为在 ActiveSelection 中，对象的 left/top 是相对于组中心的。
        // 我们的边界检查逻辑依赖于绝对坐标 (canvas 坐标)。
        // 如果不解除组合，boundary check 会失效，导致文字飞出画布。

        let targets = canvas.getActiveObjects().filter(o => o.type === 'textbox' || o.type === 'i-text');

        // 如果没有获取到（可能因为各种原因），尝试使用全局变量
        if (targets.length === 0 && selectedObjectsArray && selectedObjectsArray.length > 0) {
            targets = selectedObjectsArray;
        } else if (targets.length === 0 && selectedObject) {
            targets = [selectedObject];
        }

        if (targets.length > 0) {
            // 标记开始刷新，防止 UI 闪烁/隐藏
            window.isRefreshingSelection = true;

            // 1. 如果当前有选区，先解散，让所有对象回归绝对坐标
            if (canvas.getActiveObject()) {
                canvas.discardActiveObject();
            }

            // 2. 在绝对坐标系下应用缩放和边界检查
            targets.forEach(obj => {
                // 确保 objCoords 更新
                obj.setCoords();
                scaleTextbox(obj);
            });

            // 3. 重新创建选区 (恢复多选状态)
            if (targets.length > 1) {
                const newSel = new fabric.ActiveSelection(targets, {
                    canvas: canvas,
                    borderColor: '#0A84FF',
                    cornerColor: '#0A84FF',
                    cornerSize: 10,
                    transparentCorners: false
                });
                canvas.setActiveObject(newSel);
            } else if (targets.length === 1) {
                canvas.setActiveObject(targets[0]);
            }

            // 4. 完成
            window.isRefreshingSelection = false;

            if (canvas) canvas.renderAll();
            history.saveState();
        }
    }

    if (fontSizeSlider) {
        fontSizeSlider.addEventListener('input', function () {
            if (fontSizeInput) fontSizeInput.value = this.value;
            applyFontSize(this.value);
        });
    }

    if (fontSizeInput) {
        fontSizeInput.addEventListener('change', function () {
            const val = Math.max(8, Math.min(200, parseInt(this.value) || 20));
            this.value = val;
            if (fontSizeSlider) fontSizeSlider.value = Math.min(val, 120);
            applyFontSize(val);
        });
    }

    // 绑定快捷字号按钮
    document.querySelectorAll('.size-shortcut-btn').forEach(btn => {
        btn.addEventListener('click', function (e) {
            e.preventDefault();
            const size = this.dataset.size;
            if (fontSizeInput) fontSizeInput.value = size;
            if (fontSizeSlider) fontSizeSlider.value = Math.min(size, 120);
            applyFontSize(size);
        });
    });

    // 绑定字体选择器
    const fontFamilySelect = document.getElementById('font-family');
    if (fontFamilySelect) {
        fontFamilySelect.addEventListener('change', function () {
            const fontFamily = this.value;
            if (selectedObjectsArray && selectedObjectsArray.length > 0) {
                selectedObjectsArray.forEach(obj => {
                    if (obj.type === 'textbox' || obj.type === 'i-text') {
                        obj.set('fontFamily', fontFamily);
                    }
                });
                canvas.renderAll();
                history.saveState();
            } else if (selectedObject && (selectedObject.type === 'textbox' || selectedObject.type === 'i-text')) {
                selectedObject.set('fontFamily', fontFamily);
                canvas.renderAll();
                history.saveState();
            }
        });
    }

    // 绑定文字颜色选择器 (with null check)
    const textColorPicker = document.getElementById('text-color');
    const textColorHex = document.getElementById('text-color-hex');
    console.log('🔧 Color picker:', textColorPicker);

    if (textColorPicker) {
        textColorPicker.addEventListener('input', function () {
            if (textColorHex) textColorHex.textContent = this.value.toUpperCase();

            if (selectedObjectsArray && selectedObjectsArray.length > 0) {
                selectedObjectsArray.forEach(obj => {
                    if (obj.type === 'textbox' || obj.type === 'i-text') {
                        obj.set('fill', this.value);
                    }
                });
                if (canvas) canvas.renderAll();
                history.saveState();
            } else if (selectedObject && (selectedObject.type === 'textbox' || selectedObject.type === 'i-text')) {
                selectedObject.set('fill', this.value);
                if (canvas) canvas.renderAll();
                history.saveState();
            }
        });
    }

    // 绑定描边控件 (with null checks)
    const strokeColorPicker = document.getElementById('stroke-color');
    const strokeWidthSlider = document.getElementById('stroke-width');
    const strokeWidthValue = document.getElementById('stroke-width-value');

    function applyStroke() {
        if (!strokeColorPicker || !strokeWidthSlider) return;
        const color = strokeColorPicker.value;
        const width = parseInt(strokeWidthSlider.value);
        if (strokeWidthValue) strokeWidthValue.textContent = width + 'px';

        if (selectedObjectsArray && selectedObjectsArray.length > 0) {
            selectedObjectsArray.forEach(obj => {
                if (obj.type === 'textbox' || obj.type === 'i-text') {
                    obj.set({
                        stroke: width > 0 ? color : null,
                        strokeWidth: width,
                        paintFirst: 'stroke'
                    });
                }
            });
            if (canvas) canvas.renderAll();
            history.saveState();
        } else if (selectedObject && (selectedObject.type === 'textbox' || selectedObject.type === 'i-text')) {
            selectedObject.set({
                stroke: width > 0 ? color : null,
                strokeWidth: width,
                paintFirst: 'stroke'
            });
            if (canvas) canvas.renderAll();
            history.saveState();
        }
    }

    if (strokeColorPicker) strokeColorPicker.addEventListener('input', applyStroke);
    if (strokeWidthSlider) strokeWidthSlider.addEventListener('input', applyStroke);

    // 🔑 字间距控制
    const letterSpacingSlider = document.getElementById('letter-spacing');
    const letterSpacingInput = document.getElementById('letter-spacing-input');

    function applyLetterSpacing(value) {
        const spacing = parseFloat(value) || 0;
        if (letterSpacingInput) letterSpacingInput.value = spacing;
        if (letterSpacingSlider) letterSpacingSlider.value = Math.max(-50, Math.min(200, spacing));

        const applyToObj = (obj) => {
            if (obj.type === 'textbox' || obj.type === 'i-text') {
                obj.set('charSpacing', spacing);
            }
        };

        if (selectedObjectsArray && selectedObjectsArray.length > 0) {
            selectedObjectsArray.forEach(applyToObj);
        } else if (selectedObject) {
            applyToObj(selectedObject);
        }
        if (canvas) canvas.renderAll();
        history.saveState();
    }

    if (letterSpacingSlider) {
        letterSpacingSlider.addEventListener('input', function () {
            applyLetterSpacing(this.value);
        });
    }
    if (letterSpacingInput) {
        letterSpacingInput.addEventListener('change', function () {
            applyLetterSpacing(this.value);
        });
    }

    // 🔑 行高控制
    const lineHeightSlider = document.getElementById('line-height');
    const lineHeightInput = document.getElementById('line-height-input');

    function applyLineHeight(value) {
        const lh = parseFloat(value) || 1.2;
        if (lineHeightInput) lineHeightInput.value = lh.toFixed(1);
        if (lineHeightSlider) lineHeightSlider.value = Math.max(0.8, Math.min(3, lh));

        const applyToObj = (obj) => {
            if (obj.type === 'textbox' || obj.type === 'i-text') {
                obj.set('lineHeight', lh);
            }
        };

        if (selectedObjectsArray && selectedObjectsArray.length > 0) {
            selectedObjectsArray.forEach(applyToObj);
        } else if (selectedObject) {
            applyToObj(selectedObject);
        }
        if (canvas) canvas.renderAll();
        history.saveState();
    }

    if (lineHeightSlider) {
        lineHeightSlider.addEventListener('input', function () {
            applyLineHeight(this.value);
        });
    }
    if (lineHeightInput) {
        lineHeightInput.addEventListener('change', function () {
            applyLineHeight(this.value);
        });
    }

    // 🔑 文字转换逻辑
    function applyTextTransform(mode) {
        const transformText = (obj) => {
            if (obj.type !== 'textbox' && obj.type !== 'i-text') return;
            let text = obj.text || '';
            if (mode === 'uppercase') {
                text = text.toUpperCase();
            } else if (mode === 'capitalize') {
                text = text.replace(/\b\w/g, l => l.toUpperCase());
            } else if (mode === 'none') {
                // 恢复默认暂时没有好的反向逻辑，通常只是重新获取原始数据，
                // 但这里我们简单地全小写演示或保持不变
                text = text.toLowerCase();
            }
            obj.set('text', text);
        };

        if (selectedObjectsArray && selectedObjectsArray.length > 0) {
            selectedObjectsArray.forEach(transformText);
        } else if (selectedObject) {
            transformText(selectedObject);
        }
        if (canvas) canvas.renderAll();
        history.saveState();
    }

    document.getElementById('text-transform-capitalize')?.addEventListener('click', () => applyTextTransform('capitalize'));
    document.getElementById('text-transform-uppercase')?.addEventListener('click', () => applyTextTransform('uppercase'));
    document.getElementById('text-transform-none')?.addEventListener('click', () => applyTextTransform('none'));

    // 🔑 文字阴影逻辑
    function applyTextShadow() {
        if (!canvas) return;

        // 使用阴影专用颜色选择器
        const color = document.getElementById('shadow-color')?.value || '#000000';
        const offsetX = parseInt(document.getElementById('shadow-offset-x')?.value) || 2;
        const offsetY = parseInt(document.getElementById('shadow-offset-y')?.value) || 2;
        const blur = parseInt(document.getElementById('shadow-blur')?.value) || 4;

        const isEnabled = !document.getElementById('toggle-shadow')?.classList.contains('disabled');

        const shadow = isEnabled ? new fabric.Shadow({
            color: color,
            blur: blur,
            offsetX: offsetX,
            offsetY: offsetY
        }) : null;

        const applyToObj = (obj) => {
            if (obj.type === 'textbox' || obj.type === 'i-text') {
                obj.set('shadow', shadow);
            }
        };

        if (selectedObjectsArray && selectedObjectsArray.length > 0) {
            selectedObjectsArray.forEach(applyToObj);
        } else if (selectedObject) {
            applyToObj(selectedObject);
        }

        canvas.renderAll();
    }

    // 阴影控件事件绑定（颜色 + XYB）
    document.getElementById('shadow-color')?.addEventListener('input', applyTextShadow);
    document.getElementById('shadow-color')?.addEventListener('change', () => history.saveState());

    document.querySelectorAll('#shadow-offset-x, #shadow-offset-y, #shadow-blur').forEach(el => {
        el.addEventListener('input', applyTextShadow);
        el.addEventListener('change', () => history.saveState());
    });

    document.getElementById('toggle-shadow')?.addEventListener('click', function () {
        this.classList.toggle('disabled');
        this.textContent = this.classList.contains('disabled') ? '×' : '✓';
        applyTextShadow();
        history.saveState();
    });

    // 绑定样式按钮 (with null checks and debug logging)
    const toggleBoldBtn = document.getElementById('toggle-bold');
    if (toggleBoldBtn) toggleBoldBtn.addEventListener('click', function () {
        console.log('🔵 Bold button clicked!');
        console.log('  selectedObject:', selectedObject);
        console.log('  selectedObjectsArray:', selectedObjectsArray);
        console.log('  canvas:', canvas);

        if (selectedObjectsArray && selectedObjectsArray.length > 0) {
            console.log('  → Multi-select mode');
            const isBold = this.classList.contains('active');
            selectedObjectsArray.forEach(obj => {
                if (obj.type === 'textbox' || obj.type === 'i-text') {
                    obj.set('fontWeight', isBold ? 'normal' : 'bold');
                }
            });
            this.classList.toggle('active');
            if (canvas) canvas.renderAll();
            history.saveState();
        } else if (selectedObject && (selectedObject.type === 'textbox' || selectedObject.type === 'i-text')) {
            console.log('  → Single object mode, current weight:', selectedObject.fontWeight);
            const currentWeight = selectedObject.fontWeight;
            selectedObject.set('fontWeight', currentWeight === 'bold' ? 'normal' : 'bold');
            this.classList.toggle('active');
            if (canvas) canvas.renderAll();
            history.saveState();
            console.log('  → New weight:', selectedObject.fontWeight);
        } else {
            console.log('  ⚠️ No valid selection!');
        }
    });

    // Italic button with null check
    const toggleItalicBtn = document.getElementById('toggle-italic');
    if (toggleItalicBtn) toggleItalicBtn.addEventListener('click', function () {
        if (selectedObjectsArray && selectedObjectsArray.length > 0) {
            const isItalic = this.classList.contains('active');
            selectedObjectsArray.forEach(obj => {
                if (obj.type === 'textbox' || obj.type === 'i-text') {
                    obj.set('fontStyle', isItalic ? 'normal' : 'italic');
                }
            });
            this.classList.toggle('active');
            canvas.renderAll();
            history.saveState();
        } else if (selectedObject && (selectedObject.type === 'textbox' || selectedObject.type === 'i-text')) {
            const currentStyle = selectedObject.fontStyle;
            selectedObject.set('fontStyle', currentStyle === 'italic' ? 'normal' : 'italic');
            this.classList.toggle('active');
            canvas.renderAll();
            history.saveState();
        }
    });

    // 绑定文本内对齐按钮
    document.querySelectorAll('.align-btn[data-align]').forEach(button => {
        button.addEventListener('click', function () {
            const alignment = this.getAttribute('data-align');
            if (!canvas) return;

            if (selectedObjectsArray && selectedObjectsArray.length > 0) {
                selectedObjectsArray.forEach(obj => {
                    if (obj.type === 'textbox' || obj.type === 'i-text') {
                        obj.set('textAlign', alignment);
                    }
                });
                document.querySelectorAll('.align-btn[data-align]').forEach(btn => {
                    btn.classList.remove('active');
                });
                this.classList.add('active');
                canvas.renderAll();
                history.saveState();
            } else if (selectedObject && (selectedObject.type === 'textbox' || selectedObject.type === 'i-text')) {
                selectedObject.set('textAlign', alignment);
                document.querySelectorAll('.align-btn[data-align]').forEach(btn => {
                    btn.classList.remove('active');
                });
                this.classList.add('active');
                canvas.renderAll();
                history.saveState();
            }
        });
    });

    // ========== 画布对齐功能 (PS式) ==========
    // ========== 画布对齐功能 (PS式 - 终极修复) ==========
    function alignToCanvas(direction) {
        if (!canvas) return;

        // 1. 获取选中的对象
        // 注意：如果是多选(ActiveSelection)，这些对象的left/top是相对于组中心的
        let objects = canvas.getActiveObjects();
        if (objects.length === 0) return;

        // 2. 🚨 关键修复：必需先解散组，将对象坐标还原为画布绝对坐标
        // 否则直接设置 left/top 会被解释为相对坐标，导致飞出画布
        if (canvas.getActiveObject() && canvas.getActiveObject().type === 'activeSelection') {
            canvas.discardActiveObject();
        }

        const canvasWidth = canvas.getWidth();
        const canvasHeight = canvas.getHeight();
        const padding = 10;

        objects.forEach(obj => {
            // 此时 obj.left / obj.top 这里的 obj 已经是独立对象，坐标是绝对坐标
            const objWidth = obj.getScaledWidth();
            const objHeight = obj.getScaledHeight();

            let targetLeft = null;
            let targetTop = null;

            // 3. 计算目标绝对坐标
            switch (direction) {
                case 'h-left':
                    targetLeft = padding;
                    break;
                case 'h-center':
                    targetLeft = (canvasWidth - objWidth) / 2;
                    break;
                case 'h-right':
                    targetLeft = canvasWidth - objWidth - padding;
                    break;
                case 'v-top':
                    targetTop = padding;
                    break;
                case 'v-center':
                    targetTop = (canvasHeight - objHeight) / 2;
                    break;
                case 'v-bottom':
                    targetTop = canvasHeight - objHeight - padding;
                    break;
            }

            // 4. 应用坐标 (考虑 origin)
            if (targetLeft !== null) {
                if (obj.originX === 'center') {
                    obj.set('left', targetLeft + objWidth / 2);
                } else if (obj.originX === 'right') {
                    obj.set('left', targetLeft + objWidth);
                } else {
                    obj.set('left', targetLeft);
                }
            }

            if (targetTop !== null) {
                if (obj.originY === 'center') {
                    obj.set('top', targetTop + objHeight / 2);
                } else if (obj.originY === 'bottom') {
                    obj.set('top', targetTop + objHeight);
                } else {
                    obj.set('top', targetTop);
                }
            }

            obj.setCoords();
        });

        // 5. 恢复选中状态 (为了用户体验)
        // 使用新坐标重新创建选区
        const sel = new fabric.ActiveSelection(objects, { canvas: canvas });
        canvas.setActiveObject(sel);

        canvas.requestRenderAll();
        history.saveState();
    }

    // 绑定画布对齐按钮
    document.getElementById('align-h-left')?.addEventListener('click', () => alignToCanvas('h-left'));
    document.getElementById('align-h-center')?.addEventListener('click', () => alignToCanvas('h-center'));
    document.getElementById('align-h-right')?.addEventListener('click', () => alignToCanvas('h-right'));
    document.getElementById('align-v-top')?.addEventListener('click', () => alignToCanvas('v-top'));
    document.getElementById('align-v-center')?.addEventListener('click', () => alignToCanvas('v-center'));
    document.getElementById('align-v-bottom')?.addEventListener('click', () => alignToCanvas('v-bottom'));

    // ========== 多选工具 ==========
    document.getElementById('uniform-width')?.addEventListener('click', function () {
        if (!canvas) return;
        const objects = canvas.getActiveObjects().filter(obj =>
            obj.type === 'textbox' || obj.type === 'i-text'
        );
        if (objects.length < 2) return;

        // 找到最大宽度
        const maxWidth = Math.max(...objects.map(obj => obj.width));
        objects.forEach(obj => {
            obj.set('width', maxWidth);
        });
        canvas.renderAll();
        history.saveState();
    });

    document.getElementById('distribute-v')?.addEventListener('click', function () {
        if (!canvas) return;
        const objects = canvas.getActiveObjects().filter(obj =>
            obj.type === 'textbox' || obj.type === 'i-text'
        );
        if (objects.length < 3) return;

        // 按Y位置排序
        objects.sort((a, b) => a.top - b.top);

        const first = objects[0];
        const last = objects[objects.length - 1];
        const totalHeight = last.top - first.top;
        const spacing = totalHeight / (objects.length - 1);

        objects.forEach((obj, i) => {
            if (i > 0 && i < objects.length - 1) {
                obj.set('top', first.top + spacing * i);
                obj.setCoords();
            }
        });
        canvas.renderAll();
        history.saveState();
    });

    // ========== 帮助模态框 ==========
    const helpModal = document.getElementById('helpModal');
    const helpBtn = document.getElementById('help-btn');
    const helpClose = document.getElementById('help-close');

    if (helpBtn && helpModal) {
        helpBtn.addEventListener('click', () => {
            helpModal.classList.add('active');
        });

        helpClose?.addEventListener('click', () => {
            helpModal.classList.remove('active');
        });

        helpModal.addEventListener('click', (e) => {
            if (e.target === helpModal) {
                helpModal.classList.remove('active');
            }
        });
    }

    // ========== 清除缓存按钮 ==========
    const clearCacheBtn = document.getElementById('clear-cache-btn');
    if (clearCacheBtn) {
        clearCacheBtn.addEventListener('click', async function () {
            if (!confirm('确定要清除缓存图片吗？这将删除 static 文件夹中的临时图片。')) {
                return;
            }

            try {
                const response = await fetch('/api/clear-cache', {
                    method: 'POST'
                });

                if (response.ok) {
                    const result = await response.json();
                    alert(`✅ 缓存已清除！删除了 ${result.deleted || 0} 个文件。`);
                } else {
                    alert('❌ 清除缓存失败');
                }
            } catch (error) {
                console.error('清除缓存失败:', error);
                alert('❌ 清除缓存失败: ' + error.message);
            }
        });
    }

    // 🔑 绑定顶部"新增文本"按钮
    const addTextBtnTop = document.getElementById('add-text-btn-top');
    if (addTextBtnTop) {
        addTextBtnTop.addEventListener('click', function () {
            if (typeof addManualTextbox === 'function') {
                addManualTextbox();
            } else {
                alert('请先上传并翻译图片');
            }
        });
        console.log('✅ Bind Add Text Top Button');
    }

    // 🔑 绑定"添加矩形"按钮
    const addRectBtn = document.getElementById('add-rect-btn');
    if (addRectBtn) {
        addRectBtn.addEventListener('click', function () {
            if (typeof addRectangleToCanvas === 'function') {
                addRectangleToCanvas();
            } else {
                alert('请先上传并翻译图片');
            }
        });
        console.log('✅ Bind Add Rectangle Button');
    }

    // 🔑 矩形属性控件事件
    document.getElementById('rect-fill-color')?.addEventListener('input', updateSelectedRectFill);
    document.getElementById('rect-stroke-color')?.addEventListener('input', updateSelectedRectStroke);
    document.getElementById('rect-stroke-width')?.addEventListener('input', updateSelectedRectStrokeWidth);
    document.getElementById('rect-corner-radius')?.addEventListener('input', updateSelectedRectCornerRadius);

    // 🔑 撤销/重做按钮事件
    const undoBtn = document.getElementById('undoBtn');
    const redoBtn = document.getElementById('redoBtn');
    if (undoBtn) {
        undoBtn.addEventListener('click', () => history.undo());
    }
    if (redoBtn) {
        redoBtn.addEventListener('click', () => history.redo());
    }

    // 注意：键盘快捷键已在第 294-331 行绑定，不重复绑定

    // ========== 右侧面板切换逻辑 ==========
    // 显示编辑面板或下载面板
    window.showRightPanel = function (type) {
        const textEditor = document.getElementById('text-style-editor');
        const downloadPanel = document.getElementById('download-panel');
        const layersPanel = document.getElementById('layers-panel');

        if (type === 'edit') {
            if (textEditor) textEditor.style.display = 'block';
            if (downloadPanel) downloadPanel.style.display = 'none';
            if (layersPanel) layersPanel.style.display = 'none'; // 编辑时隐藏图层面板
        } else {
            if (textEditor) textEditor.style.display = 'none';
            if (downloadPanel) downloadPanel.style.display = 'block';
            if (layersPanel) layersPanel.style.display = 'block'; // 非编辑时显示图层面板
        }
    };

    // 注意：保存按钮事件已在HTML中通过onclick="downloadImage()"绑定
    // 不再重复绑定，避免双重保存问题
    // ========== 🔑 滚轮调节数值功能 ==========
    function setupSliderWheelInteraction() {
        document.querySelectorAll('input[type="range"]').forEach(slider => {
            slider.addEventListener('wheel', function (e) {
                // 只有当鼠标悬停在滑块上时才拦截滚动
                e.preventDefault();

                const min = parseFloat(this.min) || 0;
                const max = parseFloat(this.max) || 100;
                const step = parseFloat(this.step) || 1;
                let val = parseFloat(this.value);

                // 根据滚轮方向加减 (向下滚减，向上滚加)
                if (e.deltaY > 0) {
                    val = Math.max(min, val - step);
                } else {
                    val = Math.min(max, val + step);
                }

                this.value = val;

                // 触发事件以更新 UI 和 Canvas
                this.dispatchEvent(new Event('input', { bubbles: true }));
                this.dispatchEvent(new Event('change', { bubbles: true }));
            }, { passive: false });
        });
    }

    setupSliderWheelInteraction();

    // ========== 🎨 快捷色板点击事件 ==========
    document.querySelectorAll('.color-swatches').forEach(container => {
        const targetId = container.getAttribute('data-target');
        const targetInput = document.getElementById(targetId);

        container.querySelectorAll('.color-swatch').forEach(swatch => {
            swatch.addEventListener('click', function () {
                const color = this.getAttribute('data-color');
                if (targetInput) {
                    targetInput.value = color;
                    // 触发 input 事件以更新 UI 和 Canvas
                    targetInput.dispatchEvent(new Event('input', { bubbles: true }));
                    targetInput.dispatchEvent(new Event('change', { bubbles: true }));
                }
            });
        });
    });
});

// 修改 initCanvas 函数以添加智能吸附和事件监听器
function initCanvas() {
    const container = document.getElementById('fabricCanvasContainer');
    if (!container) return;

    // 清空容器
    container.innerHTML = '';

    // 创建画布元素
    const canvasElem = document.createElement('canvas');
    canvasElem.id = 'fabricCanvas';
    container.appendChild(canvasElem);

    // 初始化Fabric.js画布
    canvas = new fabric.Canvas('fabricCanvas', {
        preserveObjectStacking: true,
        selection: true,
        selectionColor: 'rgba(10, 132, 255, 0.15)', // Apple蓝色背景
        selectionLineWidth: 1.5,
        selectionBorderColor: '#0A84FF', // Apple蓝色边框
        backgroundColor: 'transparent'
    });

    // ========== 全局样式覆盖 (Apple蓝色) ==========
    fabric.Object.prototype.set({
        borderColor: '#0A84FF',
        cornerColor: '#0A84FF',
        cornerSize: 10,
        transparentCorners: false,
        selectionBackgroundColor: 'rgba(10, 132, 255, 0.1)'
    });

    // 专门针对多选框的样式
    fabric.ActiveSelection.prototype.set({
        borderColor: '#0A84FF',
        cornerColor: '#0A84FF',
        cornerSize: 10,
        transparentCorners: false,
        selectionBackgroundColor: 'rgba(10, 132, 255, 0.1)'
    });

    // 🔑 设置矩形选择监听器
    setupRectSelectionListener();

    // ========== 图层管理器逻辑 ==========
    window.updateLayersList = function () {
        const layersList = document.getElementById('layers-list');
        const layerCount = document.getElementById('layer-count');
        if (!layersList || !canvas) return;

        const objects = canvas.getObjects().filter(obj =>
            obj.type === 'textbox' || obj.type === 'i-text' || obj.type === 'rect' || obj.type === 'path'
        );

        // 更新数量显示
        if (layerCount) layerCount.textContent = `${objects.length} 个对象`;

        if (objects.length === 0) {
            layersList.innerHTML = '<div class="layers-empty-hint">暂无图层对象</div>';
            return;
        }

        // 倒序排列，因为Fabric的对象栈顶在数组末尾，而图层面板习惯倒序显示
        const displayObjects = [...objects].reverse();

        layersList.innerHTML = '';
        displayObjects.forEach((obj, index) => {
            const item = document.createElement('div');
            item.className = 'layer-item';
            if (canvas.getActiveObjects().includes(obj)) {
                item.classList.add('selected');
            }

            // 获取类型图标和名称
            let icon = '📄';
            let name = '未命名图层';
            let typeName = '对象';

            if (obj.type === 'textbox' || obj.type === 'i-text') {
                icon = 'Aa';
                name = obj.text ? (obj.text.substring(0, 15) + (obj.text.length > 15 ? '...' : '')) : '空文本';
                typeName = '文本';
            } else if (obj.type === 'rect') {
                icon = '◻️';
                name = '矩形区域';
                typeName = '形状';
            } else if (obj.type === 'path') {
                icon = '🖌️';
                name = '画笔笔迹';
                typeName = '笔画';
            }

            item.innerHTML = `
                <div class="layer-icon">${icon}</div>
                <div class="layer-info">
                    <div class="layer-name">${name}</div>
                    <div class="layer-type">${typeName}</div>
                </div>
                <div class="layer-actions">
                    <button class="layer-action-btn ${obj.visible ? 'active' : ''}" data-action="toggle-visibility" title="显示/隐藏">
                        ${obj.visible ? '👁️' : '🙈'}
                    </button>
                    <button class="layer-action-btn ${obj.selectable ? '' : 'active'}" data-action="toggle-lock" title="锁定/解锁">
                        ${obj.selectable ? '🔓' : '🔒'}
                    </button>
                    <button class="layer-action-btn danger" data-action="delete" title="删除">
                        🗑️
                    </button>
                </div>
            `;

            // 点击项选中对象
            item.addEventListener('click', (e) => {
                // 如果点的是按钮，不触发选中
                if (e.target.closest('.layer-action-btn')) return;

                canvas.discardActiveObject();
                // 如果对象不可见或被锁定，点击图层列表项自动临时解锁/显示以便操作？
                // 象寄逻辑：点击列表项直接选中，不管可见性（或者自动变成可见）
                if (!obj.visible) {
                    obj.set('visible', true);
                    updateLayersList();
                }

                canvas.setActiveObject(obj);
                canvas.requestRenderAll();
                // 滚动到该对象
                // canvas.centerObject(obj); // 可选
            });

            // 绑定操作按钮
            const visibleBtn = item.querySelector('[data-action="toggle-visibility"]');
            visibleBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                obj.set('visible', !obj.visible);
                canvas.requestRenderAll();
                updateLayersList();
            });

            const lockBtn = item.querySelector('[data-action="toggle-lock"]');
            lockBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const isLocked = obj.selectable;
                obj.set({
                    selectable: !isLocked,
                    evented: !isLocked,
                    hasControls: !isLocked
                });
                canvas.discardActiveObject();
                canvas.requestRenderAll();
                updateLayersList();
            });

            const deleteBtn = item.querySelector('[data-action="delete"]');
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                history.saveState();
                canvas.remove(obj);
                canvas.requestRenderAll();
                updateLayersList();
            });

            layersList.appendChild(item);
        });
    };

    // 绑定刷新按钮
    document.getElementById('refresh-layers-btn')?.addEventListener('click', () => {
        updateLayersList();
    });

    // 监听画布事件以自动更新图层列表
    canvas.on('object:added', () => updateLayersList());
    canvas.on('object:removed', () => updateLayersList());
    canvas.on('selection:created', () => updateLayersList());
    canvas.on('selection:updated', () => updateLayersList());
    canvas.on('selection:cleared', () => updateLayersList());
    canvas.on('object:modified', () => updateLayersList()); // 比如文字内容改变了


    // ========== 智能吸附系统（优化版） ==========
    // 画布：只吸附到中心线
    // 文字：吸附到其他文字的边缘和中心
    const SNAP_THRESHOLD = 8; // 吸附阈值（像素）
    let verticalLines = [];
    let horizontalLines = [];

    // 创建吸附辅助线
    function createSnapLine(points, color = '#ff6b6b') {
        return new fabric.Line(points, {
            stroke: color,
            strokeWidth: 1,
            strokeDashArray: [5, 5],
            selectable: false,
            evented: false,
            excludeFromExport: true
        });
    }

    // 移除吸附辅助线
    function removeSnapLines() {
        verticalLines.forEach(line => canvas.remove(line));
        horizontalLines.forEach(line => canvas.remove(line));
        verticalLines = [];
        horizontalLines = [];
    }

    // 对象移动时的吸附逻辑
    canvas.on('object:moving', function (e) {
        const obj = e.target;
        if (!obj) return;

        removeSnapLines();

        const canvasWidth = canvas.getWidth();
        const canvasHeight = canvas.getHeight();
        const objLeft = obj.left;
        const objTop = obj.top;
        const objWidth = obj.getScaledWidth();
        const objHeight = obj.getScaledHeight();
        const objCenterX = objLeft + objWidth / 2;
        const objCenterY = objTop + objHeight / 2;
        const objRight = objLeft + objWidth;
        const objBottom = objTop + objHeight;

        // ========== 画布吸附 (水平和垂直居中) ==========
        const canvasCenterX = canvasWidth / 2;
        const canvasCenterY = canvasHeight / 2;

        let snappedX = false;
        let snappedY = false;

        // 画布水平居中吸附 (X轴) - 竖线
        if (Math.abs(objCenterX - canvasCenterX) < SNAP_THRESHOLD) {
            obj.set('left', canvasCenterX - objWidth / 2);
            const line = createSnapLine([canvasCenterX, 0, canvasCenterX, canvasHeight], '#00ff88');
            canvas.add(line);
            verticalLines.push(line);
            snappedX = true;
        }

        // 画布垂直居中吸附 (Y轴) - 横线
        if (Math.abs(objCenterY - canvasCenterY) < SNAP_THRESHOLD) {
            obj.set('top', canvasCenterY - objHeight / 2);
            const line = createSnapLine([0, canvasCenterY, canvasWidth, canvasCenterY], '#00ff88');
            canvas.add(line);
            horizontalLines.push(line);
            snappedY = true;
        }

        // ========== 文字与文字之间的吸附 ==========
        canvas.getObjects().forEach(other => {
            if (other === obj || other.type === 'line') return;
            if (other.type !== 'textbox' && other.type !== 'i-text') return;

            const otherLeft = other.left;
            const otherTop = other.top;
            const otherWidth = other.getScaledWidth();
            const otherHeight = other.getScaledHeight();
            const otherCenterX = otherLeft + otherWidth / 2;
            const otherCenterY = otherTop + otherHeight / 2;
            const otherRight = otherLeft + otherWidth;
            const otherBottom = otherTop + otherHeight;

            // X轴吸附（垂直对齐）- 文字对齐吸附
            if (!snappedX) {
                // 左边对齐左边
                if (Math.abs(objLeft - otherLeft) < SNAP_THRESHOLD) {
                    obj.set('left', otherLeft);
                    const line = createSnapLine([otherLeft, Math.min(objTop, otherTop), otherLeft, Math.max(objBottom, otherBottom)], '#ff6b6b');
                    canvas.add(line);
                    verticalLines.push(line);
                    snappedX = true;
                }
                // 中心对齐中心
                else if (Math.abs(objCenterX - otherCenterX) < SNAP_THRESHOLD) {
                    obj.set('left', otherCenterX - objWidth / 2);
                    const line = createSnapLine([otherCenterX, Math.min(objTop, otherTop), otherCenterX, Math.max(objBottom, otherBottom)], '#ff6b6b');
                    canvas.add(line);
                    verticalLines.push(line);
                    snappedX = true;
                }
                // 右边对齐右边
                else if (Math.abs(objRight - otherRight) < SNAP_THRESHOLD) {
                    obj.set('left', otherRight - objWidth);
                    const line = createSnapLine([otherRight, Math.min(objTop, otherTop), otherRight, Math.max(objBottom, otherBottom)], '#ff6b6b');
                    canvas.add(line);
                    verticalLines.push(line);
                    snappedX = true;
                }
            }

            // Y轴吸附（水平对齐）- 文字对齐吸附
            if (!snappedY) {
                // 顶部对齐顶部
                if (Math.abs(objTop - otherTop) < SNAP_THRESHOLD) {
                    obj.set('top', otherTop);
                    const line = createSnapLine([Math.min(objLeft, otherLeft), otherTop, Math.max(objRight, otherRight), otherTop], '#ff6b6b');
                    canvas.add(line);
                    horizontalLines.push(line);
                    snappedY = true;
                }
                // 中心对齐中心
                else if (Math.abs(objCenterY - otherCenterY) < SNAP_THRESHOLD) {
                    obj.set('top', otherCenterY - objHeight / 2);
                    const line = createSnapLine([Math.min(objLeft, otherLeft), otherCenterY, Math.max(objRight, otherRight), otherCenterY], '#ff6b6b');
                    canvas.add(line);
                    horizontalLines.push(line);
                    snappedY = true;
                }
                // 底部对齐底部
                else if (Math.abs(objBottom - otherBottom) < SNAP_THRESHOLD) {
                    obj.set('top', otherBottom - objHeight);
                    const line = createSnapLine([Math.min(objLeft, otherLeft), otherBottom, Math.max(objRight, otherRight), otherBottom], '#ff6b6b');
                    canvas.add(line);
                    horizontalLines.push(line);
                    snappedY = true;
                }
            }
        });

        // ========== 🧱 强制边界限制 (核心修复) ==========
        // 🔧 使用 getBoundingRect() 获取实际边界盒，处理 originX/originY 可能为 center 的情况
        const padding = 10;
        const boundingRect = obj.getBoundingRect(true, true); // 包含旋转和缩放
        const actualLeft = boundingRect.left;
        const actualTop = boundingRect.top;
        const actualRight = actualLeft + boundingRect.width;
        const actualBottom = actualTop + boundingRect.height;

        // 计算需要的位移量
        let deltaX = 0;
        let deltaY = 0;

        // 限制左边
        if (actualLeft < padding) {
            deltaX = padding - actualLeft;
        }
        // 限制右边
        else if (actualRight > canvasWidth - padding) {
            deltaX = (canvasWidth - padding) - actualRight;
        }

        // 限制顶边
        if (actualTop < padding) {
            deltaY = padding - actualTop;
        }
        // 限制底边
        else if (actualBottom > canvasHeight - padding) {
            deltaY = (canvasHeight - padding) - actualBottom;
        }

        // 应用位移修正
        if (deltaX !== 0 || deltaY !== 0) {
            obj.set({
                left: obj.left + deltaX,
                top: obj.top + deltaY
            });
        }

        obj.setCoords();
    });

    // 移动/缩放结束时记录状态
    canvas.on('object:modified', function () {
        removeSnapLines();
        history.saveState();
    });

    // 🔑 新增：对象添加/删除时记录状态
    canvas.on('object:added', function (e) {
        // 如果是撤销重做或初始化过程，isPerformingAction 为 true，不会触发重复保存
        if (e.target && !e.target.excludeFromExport) {
            history.saveState();
        }
    });

    canvas.on('object:removed', function (e) {
        if (e.target && !e.target.excludeFromExport) {
            history.saveState();
        }
    });

    // 🔑 新增：文本内容修改时记录状态
    canvas.on('text:changed', function () {
        history.saveState();
    });

    canvas.on('mouse:up', function () {
        removeSnapLines();
    });

    // 添加对象选择事件监听器 - 切换右侧面板
    canvas.on('selection:created', function (e) {
        if (e.selected.length === 1) {
            updateTextStyleEditor(e.selected[0]);
        } else if (e.selected.length > 1) {
            showMultiSelectionEditor(e.selected);
        }
        // 显示编辑面板，隐藏下载面板
        if (typeof showRightPanel === 'function') showRightPanel('edit');
    });

    // 🔑 新增：缩放对象时实时更新UI显示的字号
    canvas.on('object:scaling', function (e) {
        if (e.target && (e.target.type === 'textbox' || e.target.type === 'i-text')) {
            updateTextStyleEditor(e.target);
        }
    });

    canvas.on('selection:updated', function (e) {
        if (e.selected.length === 1) {
            updateTextStyleEditor(e.selected[0]);
        } else if (e.selected.length > 1) {
            showMultiSelectionEditor(e.selected);
        }
        // 确保编辑面板可见
        if (typeof showRightPanel === 'function') showRightPanel('edit');
    });

    canvas.on('selection:cleared', function () {
        // 🔑 关键修复：如果是代码触发的刷新选区，不要隐藏面板
        if (window.isRefreshingSelection) return;

        document.getElementById('text-style-editor').style.display = 'none';
        selectedObject = null;
        selectedObjectsArray = null;
        // 显示下载面板
        if (typeof showRightPanel === 'function') showRightPanel('download');
        // 🔑 恢复提示显示
        const hint = document.getElementById('text-edit-hint');
        if (hint) hint.style.display = 'block';
    });

    return canvas;
}


// 显示多选样式编辑器
function showMultiSelectionEditor(selectedObjects) {
    // 检查是否都是文本对象
    const allTextObjects = selectedObjects.every(obj =>
        obj.type === 'textbox' || obj.type === 'i-text'
    );

    if (allTextObjects) {
        const styleEditor = document.getElementById('text-style-editor');
        styleEditor.style.display = 'block';

        // 更新多选状态提示
        const styleHeader = document.querySelector('.style-header');
        if (styleHeader) {
            styleHeader.textContent = `编辑 ${selectedObjects.length} 个文本 ✏️`;
        }

        // 显示多选工具
        const multiTools = document.getElementById('multi-select-tools');
        if (multiTools) multiTools.style.display = 'block';

        // 保存到全局变量
        selectedObjectsArray = selectedObjects;
        selectedObject = null;
    } else {
        document.getElementById('text-style-editor').style.display = 'none';
    }
}

// 修改 updateTextStyleEditor 以支持所有新控件
function updateTextStyleEditor(obj) {
    if (!obj) return;

    // 清除多选数组
    selectedObjectsArray = null;
    selectedObject = obj;

    // 隐藏多选工具
    const multiTools = document.getElementById('multi-select-tools');
    if (multiTools) multiTools.style.display = 'none';

    // 只有文本对象才显示样式编辑器
    if (obj.type === 'textbox' || obj.type === 'i-text') {
        const styleEditor = document.getElementById('text-style-editor');
        styleEditor.style.display = 'block';

        // 更新标题
        const styleHeader = document.querySelector('.style-header');
        if (styleHeader) {
            styleHeader.textContent = '文字编辑 ✏️';
        }

        // 更新字体选择器
        const fontFamilySelect = document.getElementById('font-family');
        if (fontFamilySelect && obj.fontFamily) {
            // 尝试匹配现有选项
            const options = Array.from(fontFamilySelect.options);
            const match = options.find(opt => obj.fontFamily.includes(opt.value.split(',')[0].replace(/'/g, '')));
            if (match) {
                fontFamilySelect.value = match.value;
            }
        }

        // 更新字体大小（滑块和数字输入）
        // 🔑 修复：显示实际视觉字号 (fontSize * scaleY)，并四舍五入
        const rawFontSize = obj.fontSize || 20;
        const scale = obj.scaleY || 1;
        const effectiveFontSize = Math.round(rawFontSize * scale);

        const fontSizeSlider = document.getElementById('font-size');
        const fontSizeInput = document.getElementById('font-size-input');
        if (fontSizeSlider) fontSizeSlider.value = Math.min(effectiveFontSize, 120);
        if (fontSizeInput) fontSizeInput.value = effectiveFontSize;

        // 更新文字颜色和hex显示
        const textColorPicker = document.getElementById('text-color');
        const textColorHex = document.getElementById('text-color-hex');
        const colorHex = obj.fill ? rgb2hex(obj.fill) : '#000000';
        if (textColorPicker) textColorPicker.value = colorHex;
        if (textColorHex) textColorHex.textContent = colorHex.toUpperCase();

        // 更新描边控件
        const strokeColorPicker = document.getElementById('stroke-color');
        const strokeWidthSlider = document.getElementById('stroke-width');
        const strokeWidthValue = document.getElementById('stroke-width-value');
        if (strokeColorPicker) strokeColorPicker.value = obj.stroke || '#FFFFFF';
        if (strokeWidthSlider) strokeWidthSlider.value = obj.strokeWidth || 0;
        if (strokeWidthValue) strokeWidthValue.textContent = (obj.strokeWidth || 0) + 'px';

        // 更新字体样式按钮
        document.getElementById('toggle-bold')?.classList.toggle('active', obj.fontWeight === 'bold');
        document.getElementById('toggle-italic')?.classList.toggle('active', obj.fontStyle === 'italic');

        // 更新对齐按钮
        document.querySelectorAll('.align-btn[data-align]').forEach(btn => {
            btn.classList.remove('active');
        });
        const alignBtn = document.querySelector(`.align-btn[data-align="${obj.textAlign || 'center'}"]`);
        if (alignBtn) alignBtn.classList.add('active');

        // 更新间距和行高
        if (document.getElementById('letter-spacing-input')) {
            document.getElementById('letter-spacing-input').value = obj.charSpacing || 0;
        }
        if (document.getElementById('line-height-input')) {
            document.getElementById('line-height-input').value = (obj.lineHeight || 1.2).toFixed(1);
        }

        // 更新阴影控件
        if (obj.shadow) {
            const s = obj.shadow;
            document.getElementById('toggle-shadow')?.classList.remove('disabled');
            const span = document.getElementById('toggle-shadow')?.querySelector('span');
            if (span) span.innerHTML = '✓';

            if (document.getElementById('shadow-offset-x')) document.getElementById('shadow-offset-x').value = s.offsetX || 0;
            if (document.getElementById('shadow-offset-y')) document.getElementById('shadow-offset-y').value = s.offsetY || 0;
            if (document.getElementById('shadow-blur')) document.getElementById('shadow-blur').value = s.blur || 0;

            // 更新数值显示
            if (document.getElementById('shadow-x-val')) document.getElementById('shadow-x-val').textContent = s.offsetX || 0;
            if (document.getElementById('shadow-y-val')) document.getElementById('shadow-y-val').textContent = s.offsetY || 0;
            if (document.getElementById('shadow-blur-val')) document.getElementById('shadow-blur-val').textContent = s.blur || 0;
        } else {
            document.getElementById('toggle-shadow')?.classList.add('disabled');
            const span = document.getElementById('toggle-shadow')?.querySelector('span');
            if (span) span.innerHTML = '&times;';
        }
    } else {
        // 不是文本对象，隐藏样式编辑器
        document.getElementById('text-style-editor').style.display = 'none';
    }
}

// 将RGB颜色转换为HEX格式
function rgb2hex(rgb) {
    if (rgb.startsWith('#')) return rgb;

    if (rgb.startsWith('rgb')) {
        const matches = rgb.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
        if (matches) {
            return '#' + ((1 << 24) + (parseInt(matches[1]) << 16) + (parseInt(matches[2]) << 8) + parseInt(matches[3])).toString(16).slice(1);
        }
    }

    return rgb;
}

// 添加初始历史记录保存
function saveInitialState() {
    if (canvas) {
        setTimeout(() => {
            history.saveState();
        }, 500);
    }
}

// 修改 translateImage 函数末尾，在绘制文本后保存初始状态
// ========== 批量处理逻辑 ==========

async function translateImage() {
    // 🔑 获取所有选中的目标语言
    const selectedLangs = Array.from(document.querySelectorAll('input[name="target-lang"]:checked'))
        .map(cb => ({ code: cb.value, name: cb.nextElementSibling.textContent.trim() }));

    if (selectedLangs.length === 0) {
        alert('⚠️ 请至少选择一种目标语言！');
        return;
    }

    const queue = appState.images.filter(img => img.status === 'pending');

    // 🔑 关键调试信息
    console.log('📊 翻译开始 - 调试信息:');
    console.log('  - appState.images 总数:', appState.images.length);
    console.log('  - pending队列长度:', queue.length);
    console.log('  - 队列中的文件名:', queue.map(img => img.file.name));
    console.log('  - 选中的语言:', selectedLangs.map(l => l.name));

    if (queue.length === 0) {
        const statusElem = document.getElementById('uploadStatus');
        statusElem.textContent = "所有图片已处理完成或没有待处理图片";
        return;
    }

    // 🔑 初始化多语言数据结构
    if (!appState.translations) appState.translations = {};
    if (!appState.currentLang) appState.currentLang = selectedLangs[0].code;

    selectedLangs.forEach(lang => {
        // 🔑 关键修复：每次翻译时重置该语言的images数组
        // 防止多次点击翻译按钮导致结果累积重复
        appState.translations[lang.code] = {
            name: lang.name,
            images: [], // 始终重置为空数组
            status: 'pending'
        };
    });

    const statusElem = document.getElementById('uploadStatus');
    const batchProgress = document.getElementById('batch-progress');
    const batchBar = document.getElementById('batch-progress-bar');
    const batchText = document.getElementById('batch-status-text');
    const loadingOverlay = document.getElementById('loadingOverlay');
    const loadingText = document.getElementById('loadingText');

    statusElem.textContent = "正在批量处理...";
    batchProgress.style.display = 'block';
    loadingOverlay.classList.add('active');

    const progressFill = document.getElementById('progressBarFill');
    const percentDisplay = document.getElementById('loadingPercent');

    const totalTasks = queue.length * selectedLangs.length;
    let completed = 0;

    // 🔑 显示语言标签栏
    renderLangTabs(selectedLangs);

    // 按图片顺序，每张图翻译所有语言
    for (let i = 0; i < queue.length; i++) {
        const img = queue[i];
        img.status = 'processing';
        renderThumbnails();

        // 对每种语言翻译这张图
        for (let j = 0; j < selectedLangs.length; j++) {
            const lang = selectedLangs[j];
            appState.translations[lang.code].status = 'processing';
            renderLangTabs(selectedLangs);

            loadingText.textContent = `翻译 ${img.file.name} → ${lang.name} (${completed + 1}/${totalTasks})`;

            // 更新进度条和百分比
            const percent = Math.round(((completed) / totalTasks) * 100);
            if (progressFill) progressFill.style.width = percent + '%';
            if (percentDisplay) percentDisplay.textContent = percent + '%';

            try {
                const formData = new FormData();
                formData.append('image', img.file);
                formData.append('source_lang', document.getElementById('source-lang').value);
                formData.append('target_lang', lang.code);
                // 获取选中的背景处理模型
                const bgModelRadio = document.querySelector('input[name="bg-model"]:checked');
                formData.append('bg_model', bgModelRadio ? bgModelRadio.value : 'opencv');
                // 获取纯色背景模式
                const solidBgCheckbox = document.getElementById('solid-bg-mode');
                formData.append('solid_bg_mode', solidBgCheckbox && solidBgCheckbox.checked ? 'true' : 'false');
                // 获取智能背景模式
                const smartBgCheckbox = document.getElementById('smart-bg-mode');
                formData.append('smart_bg_mode', smartBgCheckbox && smartBgCheckbox.checked ? 'true' : 'false');

                const response = await fetch('/process_image', {
                    method: 'POST',
                    body: formData
                });
                const data = await response.json();

                // 存储该语言的翻译结果
                const resultObj = {
                    originalImg: img,
                    status: data.success ? 'done' : 'error',
                    result: data,
                    canvasData: null
                };
                appState.translations[lang.code].images.push(resultObj);

                // 🔑 关键修复：立即为这张图生成并保存canvasData
                // 确保批量下载时排版和缩略图一致，无需用户点击进入
                if (data.success && data.inpainted_url) {
                    try {
                        const savedCanvasData = await generateCanvasDataForImage(resultObj);
                        if (savedCanvasData) {
                            resultObj.canvasData = savedCanvasData;
                            console.log(`✅ 预生成canvasData: ${img.file.name} → ${lang.name}`);
                        }
                    } catch (err) {
                        console.warn('预生成canvasData失败:', err);
                    }
                }

                // 🔑 第一张图第一个语言处理完就关闭loading并显示
                if (i === 0 && j === 0 && data.success) {
                    appState.currentLang = lang.code;
                    appState.currentIndex = 0;
                    await loadMultiLangImageToCanvas(lang.code, 0);
                    loadingOverlay.classList.remove('active');
                    console.log(`✅ 首个结果完成: ${lang.name}`);
                }

            } catch (e) {
                appState.translations[lang.code].images.push({
                    originalImg: img,
                    status: 'error',
                    error: e.message
                });
                console.error(`翻译失败: ${img.file.name} → ${lang.name}`, e);
            }

            completed++;
            const pct = Math.round((completed / totalTasks) * 100);
            if (batchBar) batchBar.style.width = `${pct}%`;
            if (batchText) batchText.innerText = `${completed}/${totalTasks}`;

            // 更新新UI组件 (局部遮罩中的进度条)
            if (progressFill) progressFill.style.width = pct + '%';
            if (percentDisplay) percentDisplay.textContent = pct + '%';
        }

        // 这张图所有语言处理完，标记为done
        img.status = 'done';
        renderThumbnails();
    }

    // 更新所有语言状态为done
    selectedLangs.forEach(lang => {
        appState.translations[lang.code].status = 'done';
    });
    renderLangTabs(selectedLangs);

    loadingOverlay.classList.remove('active');
    statusElem.textContent = `✅ 完成! ${queue.length}图 × ${selectedLangs.length}语`;
    statusElem.classList.add('active', 'success'); // 🔑 Ensure active and styled

    // 🔑 Advance workflow step to "Edit/Download"
    setActiveStep(3);

    // 🔑 渲染下载按钮
    renderDownloadButtons();
    renderMultiLangThumbnails();

    // 🔑 显示快捷同步区域
    if (typeof showQuickSyncSection === 'function') {
        showQuickSyncSection();
    }

    // 🔑 自动保存翻译结果到历史记录 - 已改为仅在下载时保存
    // autoSaveTranslationHistory(queue, selectedLangs);
}

// 🔑 自动保存翻译历史（新翻译完成后调用）
async function autoSaveTranslationHistory(images, langs) {
    console.log('📦 自动保存翻译历史...');

    // 新翻译时，清除历史编辑标记，创建新记录
    appState.currentHistoryName = null;

    // 调用统一的保存函数
    await saveCurrentToHistory();
}

// 🔑 渲染语言标签栏
function renderLangTabs(langs) {
    const container = document.getElementById('langTabsContainer');
    const tabsDiv = document.getElementById('langTabs');

    if (!langs || langs.length === 0) {
        container.style.display = 'none';
        return;
    }

    container.style.display = 'block';
    tabsDiv.innerHTML = '';

    langs.forEach(lang => {
        const tab = document.createElement('div');
        const langData = appState.translations[lang.code];
        const status = langData ? langData.status : 'pending';

        tab.className = `lang-tab ${appState.currentLang === lang.code ? 'active' : ''}`;
        tab.innerHTML = `
                    <span class="tab-status ${status}"></span>
                    <span>${lang.name}</span>
                `;
        tab.onclick = () => switchLang(lang.code);
        tabsDiv.appendChild(tab);
    });
}

// 🔑 切换语言版本
function switchLang(langCode) {
    if (!appState.translations[langCode]) return;

    // 🔑 自动退出智能涂抹模式（如果激活）
    if (window._smartInpaint && window._smartInpaint.isActive && typeof window.exitSmartInpaintMode === 'function') {
        window.exitSmartInpaintMode();
    }

    // 🔑 关键修复：切换前先保存当前画布状态！
    // 但如果有同步锁，不要保存（避免覆盖同步后的数据）
    if (!appState.syncLock) {
        syncCurrentCanvasToState();
    } else {
        console.log('🔒 同步锁激活，跳过保存当前画布状态');
    }


    // 🔑 恢复目标语言的上次查看索引，如果没有则默认为0
    const targetLangData = appState.translations[langCode];
    const restoredIndex = targetLangData.lastIndex !== undefined ? targetLangData.lastIndex : 0;

    appState.currentLang = langCode;
    appState.currentIndex = restoredIndex;
    console.log(`🔄 切换到语言 ${langCode}，恢复到图片索引 ${restoredIndex}`);

    // 🔑 更新撤销/重做按钮状态
    if (history && typeof history.updateButtonStates === 'function') {
        history.updateButtonStates();
    }

    // 重新渲染标签和缩略图
    const selectedLangs = Object.keys(appState.translations).map(code => ({
        code,
        name: appState.translations[code].name
    }));
    renderLangTabs(selectedLangs);
    renderMultiLangThumbnails();

    // 加载恢复索引的图片
    if (appState.translations[langCode].images.length > 0) {
        // 确保索引不超出范围
        const safeIndex = Math.min(restoredIndex, appState.translations[langCode].images.length - 1);
        const targetImg = appState.translations[langCode].images[safeIndex];
        console.log(`🔍 切换到 ${langCode}，目标图片 ${safeIndex}:`, {
            hasData: !!targetImg?.canvasData,
            objectsCount: targetImg?.canvasData?.objects?.length || 0,
            firstText: targetImg?.canvasData?.objects?.[0]?.text?.substring(0, 30)
        });
        loadMultiLangImageToCanvas(langCode, safeIndex);
    }
}

// 🔑 加载多语言版本图片到画布 - 优化版
async function loadMultiLangImageToCanvas(langCode, index) {
    const langData = appState.translations[langCode];
    if (!langData || !langData.images[index]) return;

    // 🔑 锁定历史保存，防止加载大量对象时产生多余历史点
    if (history) history.isSavingDisabled = true;

    const imgObj = langData.images[index];
    if (!imgObj.result || !imgObj.result.success) return;

    const data = imgObj.result;
    const canvasContainer = document.getElementById('fabricCanvasContainer');
    canvasContainer.style.display = 'block';

    // 🔑 设置原图预览
    const originalPreview = document.getElementById('original-preview');
    if (originalPreview && imgObj.originalImg) {
        originalPreview.src = imgObj.originalImg.url;
        originalPreview.style.display = 'block';
    }

    // 获取原图尺寸（用于正确缩放）
    const bgImageUrl = data.inpainted_url;
    if (!bgImageUrl) {
        console.error("未收到处理后的图像URL");
        return;
    }

    // 🔑 性能优化：预加载图片尺寸
    const imgDimensions = await new Promise((resolve) => {
        const tempImg = new Image();
        tempImg.onload = function () {
            resolve({ width: this.width, height: this.height });
        };
        tempImg.onerror = () => resolve({ width: 800, height: 600 });
        tempImg.src = imgObj.originalImg ? imgObj.originalImg.url : bgImageUrl;
    });

    window.originalImageWidth = imgDimensions.width;
    window.originalImageHeight = imgDimensions.height;

    // 🔑 性能优化：只有在必要时初始化画布
    initCanvas();

    // 🔑 关键优化：禁用逐个渲染，所有操作完成后一次性渲染
    if (canvas) {
        canvas.renderOnAddRemove = false;
    }

    // 🔑 检查是否有有效的已保存画布状态
    const hasValidCanvasData = imgObj.canvasData &&
        imgObj.canvasData.objects &&
        imgObj.canvasData.objects.length > 0;

    console.log(`🔍 ${langCode} canvasData 检查:`, {
        hasCanvasData: !!imgObj.canvasData,
        hasObjects: !!imgObj.canvasData?.objects,
        objectsLength: imgObj.canvasData?.objects?.length || 0,
        isValid: hasValidCanvasData
    });

    if (hasValidCanvasData) {
        console.log("🔄 恢复已保存的画布状态...", langCode, index);
        // 显示所有文本框的样式信息（用于调试）
        const allStyles = imgObj.canvasData.objects
            .filter(o => o.type === 'textbox' || o.type === 'i-text')
            .map(o => ({ fill: o.fill, stroke: o.stroke, strokeWidth: o.strokeWidth, fontSize: o.fontSize }));
        console.log(`📦 canvasData 详情:`, allStyles);

        // 🔑 先加载背景
        await loadImageToCanvas(bgImageUrl);

        // 从保存的数据中恢复文字对象
        await new Promise((resolve) => {
            const savedObjects = imgObj.canvasData.objects;

            // 清除当前所有非背景对象
            const objectsToRemove = canvas.getObjects().filter(obj => obj !== canvas.backgroundImage);
            objectsToRemove.forEach(obj => canvas.remove(obj));
            console.log(`🗑️ 已清除 ${objectsToRemove.length} 个旧对象`);

            // 手动创建对象（替代 enlivenObjects）
            try {
                savedObjects.forEach((objData, i) => {
                    let fabricObj = null;

                    if (objData.type === 'textbox' || objData.type === 'i-text' || objData.type === 'text') {
                        // 🔑 关键修复：使用显式检查防止颜色被默认值覆盖
                        const fillColor = objData.fill !== undefined ? objData.fill : '#000000';
                        const strokeColor = objData.stroke !== undefined ? objData.stroke : null;
                        const strokeWidthVal = objData.strokeWidth !== undefined ? objData.strokeWidth : 0;

                        fabricObj = new fabric.Textbox(objData.text || '', {
                            left: objData.left || 0,
                            top: objData.top || 0,
                            width: objData.width || 200,
                            // 文本属性
                            fontSize: objData.fontSize || 16,
                            fontFamily: objData.fontFamily || 'Arial',
                            fontWeight: objData.fontWeight || 'normal',
                            fontStyle: objData.fontStyle || 'normal',
                            fill: fillColor,
                            textAlign: objData.textAlign || 'left',
                            lineHeight: objData.lineHeight || 1.16,
                            charSpacing: objData.charSpacing || 0,
                            // 描边属性 - 🔑 关键修复：添加 paintFirst
                            stroke: strokeColor,
                            strokeWidth: strokeWidthVal,
                            paintFirst: objData.paintFirst || 'fill',
                            // 通用属性
                            scaleX: objData.scaleX || 1,
                            scaleY: objData.scaleY || 1,
                            angle: objData.angle || 0,
                            // 控制属性
                            borderColor: '#0A84FF',
                            cornerColor: '#0A84FF',
                            cornerSize: 10,
                            transparentCorners: false
                        });
                    } else if (objData.type === 'rect') {
                        fabricObj = new fabric.Rect({
                            left: objData.left || 0,
                            top: objData.top || 0,
                            width: objData.width || 100,
                            height: objData.height || 50,
                            fill: objData.fill || '#000000',
                            stroke: objData.stroke || null,
                            strokeWidth: objData.strokeWidth || 0,
                            rx: objData.rx || 0,
                            ry: objData.ry || 0,
                            scaleX: objData.scaleX || 1,
                            scaleY: objData.scaleY || 1,
                            angle: objData.angle || 0,
                            // 自定义属性
                            isUserRect: true,  // 强制标记
                            _originalRx: objData._originalRx || objData.rx || 0,
                            _originalRy: objData._originalRy || objData.ry || 0,
                            // 控制属性
                            borderColor: '#0A84FF',
                            cornerColor: '#0A84FF',
                            cornerSize: 10,
                            transparentCorners: false,
                            lockUniScaling: false
                        });

                        // 🔑 重新绑定矩形缩放监听器
                        fabricObj.on('scaling', function () {
                            const originalRx = this._originalRx || 0;
                            const originalRy = this._originalRy || 0;
                            this.set('rx', originalRx);
                            this.set('ry', originalRy);
                        });

                        fabricObj.on('modified', function () {
                            if (this.scaleX !== 1 || this.scaleY !== 1) {
                                const newWidth = this.width * this.scaleX;
                                const newHeight = this.height * this.scaleY;
                                this.set({
                                    width: newWidth,
                                    height: newHeight,
                                    scaleX: 1,
                                    scaleY: 1
                                });
                                this.setCoords();
                            }
                        });
                    } else if (objData.type === 'path' && objData.path) {
                        // 🖌️ 恢复画笔路径
                        fabricObj = new fabric.Path(objData.path, {
                            left: objData.left || 0,
                            top: objData.top || 0,
                            fill: objData.fill || null,
                            stroke: objData.stroke || '#000000',
                            strokeWidth: objData.strokeWidth || 1,
                            scaleX: objData.scaleX || 1,
                            scaleY: objData.scaleY || 1,
                            angle: objData.angle || 0,
                            strokeLineCap: 'round',
                            strokeLineJoin: 'round',
                            globalCompositeOperation: objData.globalCompositeOperation || 'source-over',
                            // 画笔路径不可选择
                            selectable: false,
                            evented: false,
                            hoverCursor: 'default'
                        });
                    }

                    if (fabricObj) {
                        canvas.add(fabricObj);
                        // 🖌️ 如果是路径，移到底部（背景图之上）
                        if (objData.type === 'path') {
                            canvas.sendToBack(fabricObj);
                        }
                        console.log(`  恢复对象${i}: type=${objData.type}, fill=${objData.fill}, stroke=${objData.stroke}, strokeWidth=${objData.strokeWidth}`);
                    }
                });

                canvas.renderOnAddRemove = true;

                // 🖌️ 确保背景图在最底部
                const bgImage = canvas.getObjects().find(obj => obj.type === 'image');
                if (bgImage) {
                    canvas.sendToBack(bgImage);
                }

                canvas.renderAll();
                console.log(`✅ 画布状态手动恢复完成，共 ${savedObjects.length} 个对象`);
                resolve();

            } catch (err) {
                console.error("❌ 手动恢复对象失败:", err);
                resolve(); // 即使失败也为了流程继续resolve
            }
        });
    } else {
        // 首次加载或无效数据：设置背景并绘制文本
        console.log("📝 首次加载，绘制默认文本...", langCode, index);
        await loadImageToCanvas(bgImageUrl);
        if (data.text_positions && data.text_positions.length > 0 && data.translations) {
            drawTextBoxes(data.text_positions, data.translations);
        }
        canvas.renderOnAddRemove = true;
    }

    // 确保背景不透明
    canvas.backgroundColor = "#000";
    canvas.renderAll();

    // 显示编辑面板
    const textStyleEditor = document.getElementById('text-style-editor');
    const savePanel = document.getElementById('save-panel');
    if (textStyleEditor) textStyleEditor.style.display = 'block';
    if (savePanel) savePanel.style.display = 'block';

    // 隐藏结果区域的空状态占位符
    const resultEmpty = document.getElementById('result-empty');
    if (resultEmpty) resultEmpty.style.display = 'none';

    // 🔑 统一调用一次适应屏幕，避免加载背景和加载对象时多次缩放
    if (typeof fitToScreen === 'function') fitToScreen();

    // 🔑 加载完成，解锁保存
    if (history) history.isSavingDisabled = false;

    // 🔑 如果这是第一次加载（没有历史记录），保存初始状态
    const historyData = history.getImageHistory();
    if (historyData && historyData.undoStack.length === 0) {
        history.saveState();
        console.log('✅ 保存初始历史记录 (v57)');
    }

    // 🔑 更新撤销/重做按钮状态
    if (history && typeof history.updateButtonStates === 'function') {
        history.updateButtonStates();
    }

    // 自动选中第一个文本框
    if (canvas) {
        const texts = canvas.getObjects('textbox');
        if (texts && texts.length > 0) {
            canvas.setActiveObject(texts[0]);
            canvas.renderAll();
        }
    }
}

// 🔑 渲染多语言缩略图
function renderMultiLangThumbnails() {
    const container = document.getElementById('thumbnailArea');
    container.innerHTML = '';

    const langCode = appState.currentLang;
    const langData = appState.translations[langCode];
    if (!langData || !langData.images) return;

    langData.images.forEach((imgObj, index) => {
        const div = document.createElement('div');
        let className = 'thumbnail';
        if (index === appState.currentIndex) className += ' active';
        if (imgObj.status !== 'done') className += ' processing';
        div.className = className;
        div.style.position = 'relative';

        if (imgObj.status === 'done') {
            div.onclick = () => {
                // 🔑 自动退出智能涂抹模式（如果激活）
                if (window._smartInpaint && window._smartInpaint.isActive && typeof window.exitSmartInpaintMode === 'function') {
                    window.exitSmartInpaintMode();
                }

                // 🔑 切换前保存当前画布状态（包含完整属性）
                // 但如果有同步锁，不要保存（避免覆盖同步后的数据）
                if (canvas && appState.currentLang && appState.currentIndex >= 0 && !appState.syncLock) {
                    const currentLangData = appState.translations[appState.currentLang];
                    if (currentLangData && currentLangData.images[appState.currentIndex]) {
                        currentLangData.images[appState.currentIndex].canvasData = serializeCanvas(canvas);
                        console.log('✅ 保存画布状态:', appState.currentLang, appState.currentIndex);
                    }
                } else if (appState.syncLock) {
                    console.log('🔒 同步锁激活，跳过保存当前画布状态');
                }
                appState.currentIndex = index;

                // 🔑 修复：切换图片时不应清空历史，每张图片有独立的撤销栈
                // if (history && typeof history.clear === 'function') {
                //     history.clear();
                // }
                loadMultiLangImageToCanvas(langCode, index);
                renderMultiLangThumbnails();
            };
            div.style.cursor = 'pointer';
        } else {
            div.style.cursor = 'not-allowed';
        }

        div.title = imgObj.originalImg ? imgObj.originalImg.file.name : '';

        const image = document.createElement('img');
        image.src = imgObj.originalImg ? imgObj.originalImg.url : '';
        image.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:10px';

        // 🔑 处理中/等待处理的图片: 灰色+转圈+不可点击
        if (imgObj.status !== 'done') {
            image.style.filter = 'grayscale(100%) opacity(0.5)';

            // 添加转圈圈动画
            const spinner = document.createElement('div');
            spinner.style.cssText = `
                        position: absolute;
                        top: 50%;
                        left: 50%;
                        transform: translate(-50%, -50%);
                        width: 24px;
                        height: 24px;
                        border: 3px solid rgba(255,255,255,0.3);
                        border-top: 3px solid #0A84FF;
                        border-radius: 50%;
                        animation: spin 1s linear infinite;
                    `;
            div.appendChild(spinner);
        }

        div.appendChild(image);

        container.appendChild(div);
    });
}

// 加载已处理的图片数据到画布
async function loadProcessedImageToCanvas(imgObj) {
    if (!imgObj || !imgObj.result) return;

    const data = imgObj.result;
    const canvasContainer = document.getElementById('fabricCanvasContainer');
    canvasContainer.style.display = 'block';

    initCanvas();
    // 确保使用IOPaint处理后的背景图像
    const bgImageUrl = data.inpainted_url;
    if (!bgImageUrl) {
        console.error("未收到处理后的图像URL");
        return;
    }
    // 记录翻译文本和位置，用于调试
    console.log("文本位置:", data.text_positions);
    console.log("翻译结果:", data.translations);

    // 如果之前保存过画布状态，恢复它
    // 如果之前保存过画布状态，恢复它
    if (imgObj.canvasData) {
        await loadImageToCanvas(bgImageUrl);
        await new Promise((resolve) => {
            canvas.loadFromJSON(imgObj.canvasData, function () {
                canvas.renderAll();
                // 恢复完状态后，重新设置背景（有时loadFromJSON会覆盖背景设置）
                resolve();
            });
        });
    } else {
        // 首次加载结果
        await loadImageToCanvas(bgImageUrl);
        // 绘制文本
        if (data.text_positions && data.text_positions.length > 0 && data.translations) {
            drawTextBoxes(data.text_positions, data.translations);
        }
    }
    // 调整预览区域滚动位置，确保用户可以看到结果
    const previewArea = document.querySelector('.preview-container');
    if (previewArea) previewArea.scrollTop = 0;

    // 保存初始状态到历史记录
    saveInitialState();

    // ========== 显示右侧编辑面板 ==========
    const textStyleEditor = document.getElementById('text-style-editor');
    const savePanel = document.getElementById('save-panel');
    const tipCard = document.getElementById('tipCard');

    if (textStyleEditor) textStyleEditor.style.display = 'block';
    if (savePanel) savePanel.style.display = 'block';
    if (tipCard) tipCard.style.display = 'none';

    // 更新步骤到第4步
    document.querySelectorAll('.step').forEach(step => {
        const num = parseInt(step.dataset.step);
        step.classList.remove('active', 'completed');
        if (num < 4) step.classList.add('completed');
        else if (num === 4) step.classList.add('active');
    });
}

// 旧函数保留占位，实际逻辑已移至上方
function translateImage_legacy() {


    const formData = new FormData();
    formData.append('image', currentImage);
    formData.append('source_lang', document.getElementById('source-lang').value);
    formData.append('target_lang', document.getElementById('target-lang').value);

    fetch('/process_image', {
        method: 'POST',
        body: formData
    })
        .then(response => response.json())
        .then(data => {
            console.log("翻译响应:", data); // 添加日志，检查响应数据

            statusElem.textContent = data.success ? "翻译完成" : "翻译失败: " + (data.error || "未知错误");

            if (data.success) {
                // 显示Canvas容器
                const canvasContainer = document.getElementById('fabricCanvasContainer');
                canvasContainer.style.display = 'block';

                // 初始化画布
                initCanvas();
                if (canvas) {
                    // 确保使用IOPaint处理后的背景图像
                    const bgImageUrl = data.inpainted_url;
                    if (!bgImageUrl) {
                        console.error("未收到处理后的图像URL");
                        statusElem.textContent = "翻译失败: 未收到处理后的图像";
                        return;
                    }

                    // 记录翻译文本和位置，用于调试
                    console.log("文本位置:", data.text_positions);
                    console.log("翻译结果:", data.translations);

                    loadImageToCanvas(bgImageUrl).then(() => {
                        // 绘制文本
                        if (data.text_positions && data.text_positions.length > 0 && data.translations) {
                            drawTextBoxes(data.text_positions, data.translations);
                            // 调整预览区域滚动位置，确保用户可以看到结果
                            const previewArea = document.querySelector('.preview-container');
                            if (previewArea) previewArea.scrollTop = 0;

                            // 保存初始状态到历史记录
                            saveInitialState();

                            // ========== 显示右侧编辑面板 ==========
                            const textStyleEditor = document.getElementById('text-style-editor');
                            const toolsPanel = document.getElementById('tools-panel'); // 新增工具面板
                            const savePanel = document.getElementById('save-panel');
                            const tipCard = document.getElementById('tipCard');

                            if (textStyleEditor) textStyleEditor.style.display = 'block';
                            if (toolsPanel) toolsPanel.style.display = 'block'; // 显示工具面板
                            if (savePanel) savePanel.style.display = 'block';
                            if (tipCard) tipCard.style.display = 'none';

                            // 更新步骤到第4步
                            if (typeof updateStep === 'function') {
                                updateStep(4);
                            } else {
                                document.querySelectorAll('.step').forEach(step => {
                                    const num = parseInt(step.dataset.step);
                                    step.classList.remove('active', 'completed');
                                    if (num < 4) step.classList.add('completed');
                                    else if (num === 4) step.classList.add('active');
                                });
                            }
                        } else {
                            console.error("未收到文本位置或翻译结果");
                            statusElem.textContent += " (未检测到文本)";
                        }
                    }).catch(err => {
                        console.error("加载图像到画布时出错:", err);
                        statusElem.textContent = "加载图像失败: " + err.message;
                    });
                }
            }
        })
        .catch(error => {
            console.error('Error:', error);
            statusElem.textContent = "翻译失败: " + error.message;
            document.getElementById('loadingOverlay').classList.remove('active');
            document.getElementById('uploadStatus').textContent = '翻译失败，请重试';
            document.getElementById('uploadStatus').className = 'status-msg error';
        })
        .finally(() => {
            document.getElementById('loadingOverlay').classList.remove('active');
        });
}

// 完全重写loadImageToCanvas函数，确保图像不变形且默认75%大小
function loadImageToCanvas(url) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "anonymous";

        img.onload = function () {
            // 获取原图参考尺寸
            const originalWidth = window.originalImageWidth;
            const originalHeight = window.originalImageHeight;

            if (!originalWidth || !originalHeight) {
                console.error("未找到原始图像尺寸");
                reject(new Error("无法获取原始图像尺寸"));
                return;
            }

            console.log(`翻译后图像尺寸: ${img.width}x${img.height}`);
            console.log(`原图尺寸: ${originalWidth}x${originalHeight}`);

            // 获取容器元素
            const canvasContainer = document.getElementById('fabricCanvasContainer');

            // 设置容器样式，确保与原图容器完全一致
            // 使用原始尺寸，容器的transform:scale会处理缩放
            canvasContainer.style.width = '100%';
            canvasContainer.style.height = '100%';
            // canvasContainer.style.maxWidth = 'none';
            // canvasContainer.style.maxHeight = 'none';

            // 设置Canvas的确切尺寸，和原图一样
            canvas.setWidth(originalWidth);
            canvas.setHeight(originalHeight);

            // 设置背景图像 - 使用精确尺寸
            fabric.Image.fromURL(url, function (imgObj) {
                // 强制调整为与原图完全一致的尺寸，不使用缩放
                imgObj.set({
                    originX: 'left',
                    originY: 'top',
                    left: 0,
                    top: 0,
                    width: originalWidth,
                    height: originalHeight,
                    scaleX: 1,
                    scaleY: 1
                });

                // 设置背景图像
                canvas.setBackgroundImage(imgObj, canvas.renderAll.bind(canvas), {
                    originX: 'left',
                    originY: 'top'
                });

                // 确保canvas元素本身不会被缩放（由外层容器控制缩放）
                const canvasElement = document.getElementById('fabricCanvas');
                if (canvasElement) {
                    canvasElement.style.width = '100%';
                    canvasElement.style.height = '100%';
                }

                resolve();
            }, { crossOrigin: 'anonymous' });
        };

        img.onerror = function (err) {
            console.error("加载图像失败:", err);
            reject(new Error("无法加载图像"));
        };

        img.src = url;
    });
}

// ========== 精确匹配原文样式的文本绘制函数 ==========
// 🔑 文本渲染模式应用函数
function applyRenderModeToText(textObj, mode) {
    if (!textObj) return;

    // 获取当前模式 (或者从参数传入)
    const domSelect = document.getElementById('text-render-mode');
    const renderMode = mode || (domSelect ? domSelect.value : 'sharp');

    // console.log(`应用渲染模式: ${renderMode}`);

    if (renderMode === 'default') {
        textObj.set({
            strokeWidth: 0,
            stroke: null,
            paintFirst: 'fill',
            objectCaching: true // 标准Fabric缓存
        });
    } else if (renderMode === 'sharp') {
        textObj.set({
            strokeWidth: 0, // 用户要求去除默认微弱描边
            stroke: null, // 去除描边颜色
            paintFirst: 'stroke',
            objectCaching: false // 禁用缓存以获得并在矢量
        });
    } else if (renderMode === 'strong') {
        textObj.set({
            strokeWidth: 0.8, // 较粗描边
            stroke: textObj.fill,
            paintFirst: 'stroke',
            objectCaching: false
        });
    }

    // 如果颜色更新了，描边颜色也要更新
    if (renderMode !== 'default') {
        textObj.stroke = textObj.fill;
    }
}

// 全局新增文本函数
function addManualTextbox() {
    if (!canvas) {
        alert("请先上传并翻译图片");
        return;
    }

    // 获取中心点
    const center = canvas.getCenter();

    // 创建文本对象 - 宽度会自动适应文字长度
    const defaultText = '点击输入文字';
    const defaultFontSize = 40;

    // 测量默认文本需要的宽度
    const tempText = new fabric.Textbox(defaultText, {
        fontSize: defaultFontSize,
        fontFamily: 'Arial',
        fontWeight: 'bold',
        width: 99999
    });
    const autoWidth = Math.max(tempText.calcTextWidth() + 30, 150); // 最小150px

    const textObj = new fabric.Textbox(defaultText, {
        left: center.left,
        top: center.top,
        width: autoWidth,
        fontSize: defaultFontSize,
        fill: '#ff0000', // 默认红色显眼
        textAlign: 'center',
        originX: 'center',
        originY: 'center',
        fontFamily: 'Arial',
        fontWeight: 'bold',
        padding: 10,
        borderColor: '#0A84FF',
        cornerColor: '#0A84FF',
        cornerSize: 10,
        transparentCorners: false,
        selectable: true,
        editable: true,
        splitByGrapheme: true,
        breakWords: true
    });

    // ========== 🧱 边缘生成检查 ==========
    const padding = 20;
    const canvasWidth = canvas.getWidth();  // 🔧 使用 getWidth() 获取正确的画布尺寸
    const canvasHeight = canvas.getHeight(); // 🔧 使用 getHeight() 获取正确的画布尺寸
    const objWidth = textObj.width;
    const objHeight = textObj.height;

    // 确保中心点不至于让边缘出界
    if (textObj.left - objWidth / 2 < padding) textObj.left = objWidth / 2 + padding;
    if (textObj.left + objWidth / 2 > canvasWidth - padding) textObj.left = canvasWidth - objWidth / 2 - padding;
    if (textObj.top - objHeight / 2 < padding) textObj.top = objHeight / 2 + padding;
    if (textObj.top + objHeight / 2 > canvasHeight - padding) textObj.top = canvasHeight - objHeight / 2 - padding;

    // 如果文本框本身就比画布宽，强制缩小
    if (objWidth > canvasWidth - 2 * padding) {
        textObj.width = canvasWidth - 2 * padding;
        textObj.left = canvasWidth / 2;
    }

    // 应用渲染模式
    applyRenderModeToText(textObj);

    canvas.add(textObj);
    canvas.setActiveObject(textObj);
    canvas.renderAll();
    history.saveState();

    console.log("已添加手动文本框");
}
window.addTextToCanvas = addManualTextbox;

// 🔑 通用文本框创建函数 - 确保屏幕显示和离屏生成的一致性
function addTextboxToCanvas(targetCanvas, item, translatedText, index) {
    if (!item || !item.box) {
        console.error(`文本位置项 #${index} 无效:`, item);
        return;
    }

    const box = item.box;

    // ========== 精确计算文本框位置 (bbox转换) ==========
    const points = box.map(point => ({ x: point[0], y: point[1] }));
    const minX = Math.min(...points.map(p => p.x));
    const minY = Math.min(...points.map(p => p.y));
    const maxX = Math.max(...points.map(p => p.x));
    const maxY = Math.max(...points.map(p => p.y));
    const boxWidth = maxX - minX;
    const boxHeight = maxY - minY;

    // ========== 直接使用后端提供的样式 ==========
    const style = item.style || {};

    // 直接使用后端提取的颜色（已经是rgb格式）
    let textColor = style.color || 'rgb(0, 0, 0)';

    // 直接使用后端提取的字体大小
    let fontSize = style.font_size || Math.max(12, boxHeight * 0.8);

    // 处理粗体和斜体
    const isBold = style.is_bold === 1 || style.is_bold === true;
    const isItalic = style.is_italic === 1 || style.is_italic === true;

    // 使用后端检测的对齐方式
    const textAlign = style.align || 'left';

    console.log(`添加文本 #${index}: "${translatedText}"`);

    // ========== 创建文本对象 ==========
    const textObj = new fabric.Textbox(translatedText, {
        left: minX,
        top: minY,
        width: boxWidth,
        fontSize: fontSize,
        fill: textColor,
        fontWeight: isBold ? 'bold' : 'normal',
        fontStyle: isItalic ? 'italic' : 'normal',
        fontFamily: 'Arial, "Microsoft YaHei", sans-serif',
        textAlign: textAlign,
        originX: 'left',
        originY: 'top',
        padding: 0,
        borderColor: '#0A84FF',
        cornerColor: '#0A84FF',
        cornerSize: 10,
        transparentCorners: false,
        selectable: true,
        editable: true,
        splitByGrapheme: true,
        breakWords: true, // 允许长单词换行
        lockScalingFlip: true // 禁用翻转缩放
    });

    // 🔑 应用渲染模式 (锐化/加粗)
    applyRenderModeToText(textObj);

    // ========== 只在文字溢出时才缩小字体 ==========
    // 临时添加到canvas计算高度(如果是离屏canvas可能不需要，但为了准确性推荐)
    // 注意：Textbox的height是自动计算的

    // 简单的自适应字体大小循环
    let maxIterations = 15;
    // 预估高度: fabric.Textbox在初始化时会自动计算高度
    // 如果文字太多超出盒子高度，减小字体
    // 注意：这里需要更精确的测量，可以通过targetCanvas上下文测量，或者直接依赖fabric的计算
    // 在离屏模式下，可能需要先add再measure

    // 如果是主Canvas，可以直接添加
    targetCanvas.add(textObj);

    // 强制更新以获取正确的高度
    textObj.setCoords();

    while (textObj.height > boxHeight && fontSize > 8 && maxIterations > 0) {
        fontSize = fontSize * 0.9;
        textObj.set('fontSize', fontSize);
        // textObj.initDimensions(); // 重新计算尺寸
        maxIterations--;
    }

    // ========== 垂直居中对齐 ==========
    const actualTextHeight = textObj.height;
    if (actualTextHeight < boxHeight) {
        const verticalOffset = (boxHeight - actualTextHeight) / 2;
        textObj.set('top', minY + verticalOffset);
    }

    // 保存原始样式信息供编辑使用
    textObj.originalStyle = {
        color: textColor,
        fontSize: fontSize,
        isBold: isBold,
        isItalic: isItalic,
        align: textAlign,
        box: box,
        boxWidth: boxWidth,
        boxHeight: boxHeight,
        originalX: minX,
        originalY: minY
    };

    // 对象修改事件处理程序 (仅用于主canvas)
    if (targetCanvas === canvas) { // canvas是全局变量
        textObj.on('modified', function () {
            if (history && typeof history.saveState === 'function') {
                history.saveState();
            }
        });
    }
}

// ========== 精确匹配原文样式的文本绘制函数 ==========
function drawTextBoxes(textPositions, translations) {
    if (!canvas || !textPositions) {
        console.error("没有画布或文本位置信息");
        return;
    }

    // 🔑 锁定保存，防止批量添加触发无数次 history.saveState
    if (history) history.isSavingDisabled = true;

    console.log(`开始绘制${textPositions.length}个文本框`);

    // 清除现有文本
    canvas.getObjects().forEach(obj => {
        if (obj.type === 'textbox' || obj.type === 'i-text') {
            canvas.remove(obj);
        }
    });

    // 直接绘制，使用后端提供的样式
    textPositions.forEach((item, index) => {
        // ... (绘制逻辑)
        let translatedText = "";
        if (translations && translations[index]) {
            translatedText = translations[index];
        } else if (item.text) {
            translatedText = item.text;
        }

        if (translatedText) {
            try {
                addTextboxToCanvas(canvas, item, translatedText, index);
            } catch (e) {
                console.error(`绘制文本框 #${index} 失败:`, e);
            }
        }
    });

    if (history) history.isSavingDisabled = false; // 解锁
    canvas.renderAll();
}

// 增强的文本颜色提取函数 - 优化版
function extractTextColor(img, box, text) {
    try {
        // 使用canvas进行高级颜色分析
        const tempCanvas = document.createElement('canvas');
        const ctx = tempCanvas.getContext('2d');

        // 提取文本区域
        const minX = Math.min(...box.map(point => point[0]));
        const minY = Math.min(...box.map(point => point[1]));
        const maxX = Math.max(...box.map(point => point[0]));
        const maxY = Math.max(...box.map(point => point[1]));

        const width = maxX - minX;
        const height = maxY - minY;

        // 扩展区域以获取更好的上下文 (增加5像素边距)
        const padding = 5;
        const safeMinX = Math.max(0, minX - padding);
        const safeMinY = Math.max(0, minY - padding);
        const safeMaxX = Math.min(img.width, maxX + padding);
        const safeMaxY = Math.min(img.height, maxY + padding);
        const safeWidth = safeMaxX - safeMinX;
        const safeHeight = safeMaxY - safeMinY;

        tempCanvas.width = safeWidth;
        tempCanvas.height = safeHeight;

        // 绘制文本区域
        ctx.drawImage(img, safeMinX, safeMinY, safeWidth, safeHeight, 0, 0, safeWidth, safeHeight);

        // 获取像素数据
        const imageData = ctx.getImageData(0, 0, safeWidth, safeHeight);
        const data = imageData.data;

        // 创建颜色直方图 - 不再量化颜色，保持精确值
        const colorHistogram = {};
        const backgroundColors = new Set();

        // 第一步：识别可能的背景色（边缘1像素区域）
        for (let y = 0; y < safeHeight; y++) {
            for (let x = 0; x < safeWidth; x++) {
                if (x === 0 || y === 0 || x === safeWidth - 1 || y === safeHeight - 1) {
                    const idx = (y * safeWidth + x) * 4;
                    const r = data[idx];
                    const g = data[idx + 1];
                    const b = data[idx + 2];
                    const a = data[idx + 3];

                    if (a > 200) { // 只处理不透明像素
                        // 使用更精确的颜色表示，不再量化
                        backgroundColors.add(`${r},${g},${b}`);
                    }
                }
            }
        }

        // 第二步：分析文本区域颜色，排除背景色
        // 特殊处理黑色和白色
        let blackPixelCount = 0;
        let whitePixelCount = 0;
        let coloredPixelCount = 0;

        for (let y = 0; y < safeHeight; y++) {
            for (let x = 0; x < safeWidth; x++) {
                const idx = (y * safeWidth + x) * 4;
                const r = data[idx];
                const g = data[idx + 1];
                const b = data[idx + 2];
                const a = data[idx + 3];

                // 忽略透明像素
                if (a < 200) {
                    continue;
                }

                // 精确的颜色值
                const exactColor = `${r},${g},${b}`;

                // 如果不是背景色，则添加到直方图
                if (!backgroundColors.has(exactColor)) {
                    // 检测是否为纯黑色或接近黑色
                    if (r <= 30 && g <= 30 && b <= 30) {
                        blackPixelCount++;
                        // 使用完全黑色
                        colorHistogram['0,0,0'] = (colorHistogram['0,0,0'] || 0) + 3; // 加权
                    }
                    // 检测是否为纯白色或接近白色
                    else if (r >= 240 && g >= 240 && b >= 240) {
                        whitePixelCount++;
                        // 使用完全白色
                        colorHistogram['255,255,255'] = (colorHistogram['255,255,255'] || 0) + 3; // 加权
                    }
                    // 其他颜色
                    else {
                        coloredPixelCount++;
                        colorHistogram[exactColor] = (colorHistogram[exactColor] || 0) + 1;
                    }
                }
            }
        }

        // 按频率排序颜色
        const sortedColors = Object.keys(colorHistogram).sort((a, b) => colorHistogram[b] - colorHistogram[a]);

        // 如果没有找到有效颜色，返回默认黑色
        if (sortedColors.length === 0) {
            return '#000000';
        }

        // 特殊处理：如果黑色或白色像素占比很高，直接使用纯黑或纯白
        const totalNonBackgroundPixels = blackPixelCount + whitePixelCount + coloredPixelCount;
        if (totalNonBackgroundPixels > 0) {
            const blackRatio = blackPixelCount / totalNonBackgroundPixels;
            const whiteRatio = whitePixelCount / totalNonBackgroundPixels;

            if (blackRatio > 0.6) {
                console.log("检测到大量黑色像素，使用纯黑色");
                return '#000000';
            }

            if (whiteRatio > 0.6) {
                console.log("检测到大量白色像素，使用纯白色");
                return '#FFFFFF';
            }
        }

        // 转换RGB到HEX - 确保颜色精确
        const dominantColor = sortedColors[0].split(',').map(n => parseInt(n));
        return `#${(1 << 24 | dominantColor[0] << 16 | dominantColor[1] << 8 | dominantColor[2]).toString(16).slice(1)}`;
    } catch (error) {
        console.error('提取文本颜色时出错:', error);
        return '#000000'; // 出错时返回默认黑色
    }
}

// 增强的文本样式分析
function analyzeTextStyle(img, box, text) {
    const style = {};

    try {
        // 提取颜色 - 使用优化过的颜色提取算法
        style.color = extractTextColor(img, box, text);

        // 计算字体大小 - 使用更精确的方法
        const minX = Math.min(...box.map(point => point[0]));
        const minY = Math.min(...box.map(point => point[1]));
        const maxX = Math.max(...box.map(point => point[0]));
        const maxY = Math.max(...box.map(point => point[1]));

        const width = maxX - minX;
        const height = maxY - minY;

        // 汉字和英文的计算方法略有不同
        const charCount = text.length;
        if (charCount > 0) {
            // 检测是否主要是中文字符
            const chineseCharCount = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
            const isMainlyChinese = chineseCharCount / charCount > 0.5;

            if (isMainlyChinese) {
                // 中文字符通常是方形，直接用高度作为参考更准确
                // 增加系数到0.9以获得更准确的大小
                style.font_size = Math.max(12, Math.min(height * 0.9, width / charCount * 1.9));
            } else {
                // 英文和数字需要考虑宽高比
                // 检查是否是单行文本
                const isSingleLine = !text.includes('\n') && width > height * 1.5;

                if (isSingleLine) {
                    // 单行英文文本 - 使用更精确的计算方法
                    const avgCharWidth = width / charCount;
                    // 英文字符高宽比约为1.8-2.0，使用更精确的值
                    style.font_size = Math.round(avgCharWidth * 1.8);

                    // 防止字体过大或过小
                    style.font_size = Math.max(12, Math.min(style.font_size, height * 0.9));
                } else {
                    // 多行文本 - 使用高度作为主要参考
                    // 估计行数
                    const estimatedLines = Math.max(1, Math.round(height / (width / charCount * 1.8)));
                    const lineHeight = height / estimatedLines;
                    style.font_size = Math.round(lineHeight * 0.9); // 90%的行高作为字体大小
                }
            }
        } else {
            style.font_size = height * 0.8; // 默认值，增加到80%
        }

        // 估计字体粗细 - 使用改进的颜色深度分析法
        const tempCanvas = document.createElement('canvas');
        const ctx = tempCanvas.getContext('2d');
        tempCanvas.width = width;
        tempCanvas.height = height;

        // 绘制文本区域
        ctx.drawImage(img, minX, minY, width, height, 0, 0, width, height);
        const imageData = ctx.getImageData(0, 0, width, height);
        const data = imageData.data;

        // 分析颜色深度和像素分布
        let totalDarkness = 0;
        let darkPixelCount = 0;
        let totalPixels = 0;

        // 计算边缘像素的平均暗度，用于检测粗体
        let edgePixels = 0;
        let edgeDarkness = 0;

        for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            const a = data[i + 3];

            if (a > 128) { // 不透明像素
                totalPixels++;

                // 用亮度公式计算颜色的暗度 (0-255)
                const darkness = 255 - (r * 0.299 + g * 0.587 + b * 0.114);

                // 只考虑足够暗的像素（可能是文本）
                if (darkness > 50) {
                    totalDarkness += darkness;
                    darkPixelCount++;

                    // 检查是否是边缘像素 (简化版边缘检测)
                    const x = (i / 4) % width;
                    const y = Math.floor((i / 4) / width);

                    if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
                        edgePixels++;
                        edgeDarkness += darkness;
                    }
                }
            }
        }

        // 计算平均暗度和文本像素密度
        const avgDarkness = darkPixelCount > 0 ? totalDarkness / darkPixelCount : 0;
        const pixelDensity = totalPixels > 0 ? darkPixelCount / totalPixels : 0;
        const avgEdgeDarkness = edgePixels > 0 ? edgeDarkness / edgePixels : 0;

        // 根据暗度和像素密度综合判断是否为粗体
        // 粗体通常有更高的平均暗度、像素密度和边缘暗度
        style.is_bold = (avgDarkness > 170) ||
            (avgDarkness > 150 && pixelDensity > 0.5) ||
            (avgEdgeDarkness > 160);

        // 检查文本颜色 - 如果是纯黑色，更可能是粗体
        if (style.color === '#000000') {
            style.is_bold = style.is_bold || (pixelDensity > 0.4);
        }

        // 估计是否斜体 - 通过分析像素分布的倾斜度
        // 这个算法较为复杂，这里用改进版：检测左侧和右侧暗像素的垂直分布差异
        let leftColumnPixels = new Array(height).fill(0);
        let rightColumnPixels = new Array(height).fill(0);

        // 取最左和最右的几列像素
        const sampleWidth = Math.min(Math.floor(width / 4), 15); // 最多取1/4宽度或15像素

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < sampleWidth; x++) {
                // 左侧像素
                const leftIdx = (y * width + x) * 4;
                if (leftIdx < data.length && data[leftIdx + 3] > 128) {
                    const darkness = 255 - (data[leftIdx] * 0.299 + data[leftIdx + 1] * 0.587 + data[leftIdx + 2] * 0.114);
                    if (darkness > 50) leftColumnPixels[y]++;
                }

                // 右侧像素
                const rightIdx = (y * width + (width - x - 1)) * 4;
                if (rightIdx < data.length && data[rightIdx + 3] > 128) {
                    const darkness = 255 - (data[rightIdx] * 0.299 + data[rightIdx + 1] * 0.587 + data[rightIdx + 2] * 0.114);
                    if (darkness > 50) rightColumnPixels[y]++;
                }
            }
        }

        // 计算左右像素分布的垂直偏移
        let leftWeightedPos = 0, rightWeightedPos = 0;
        let leftTotal = 0, rightTotal = 0;

        for (let y = 0; y < height; y++) {
            leftWeightedPos += y * leftColumnPixels[y];
            leftTotal += leftColumnPixels[y];

            rightWeightedPos += y * rightColumnPixels[y];
            rightTotal += rightColumnPixels[y];
        }

        const leftCenter = leftTotal > 0 ? leftWeightedPos / leftTotal : 0;
        const rightCenter = rightTotal > 0 ? rightWeightedPos / rightTotal : 0;

        // 如果右侧中心明显高于左侧中心，可能是斜体
        const verticalOffset = rightCenter - leftCenter;
        style.is_italic = verticalOffset < -height * 0.05; // 倾斜角度足够大

        // 估计文本对齐方式 - 基于文本框在图像中的水平位置
        if (text && text.length > 2) {
            const centerX = (minX + maxX) / 2;
            const imageWidth = img.width;

            const relativePosition = centerX / imageWidth;

            if (relativePosition < 0.35) {
                style.align = 'left';
            } else if (relativePosition > 0.65) {
                style.align = 'right';
            } else {
                style.align = 'center';
            }
        } else {
            style.align = 'center'; // 短文本默认居中
        }

        // 检查文本是否为标题 - 通常标题字体更大、更粗
        const isLargeText = style.font_size > 24;
        if (isLargeText && pixelDensity > 0.4) {
            // 大字体更可能是粗体
            style.is_bold = true;
        }

    } catch (error) {
        console.error('分析文本样式时出错:', error);

        // 提供默认样式值
        style.color = style.color || '#000000';
        style.font_size = style.font_size || 20;
        style.is_bold = style.is_bold || false;
        style.is_italic = style.is_italic || false;
        style.align = style.align || 'center';
    }

    return style;
}

// 应用样式变更时保持原始位置不变
function applyStylePreservingPosition(textObj, newStyle) {
    if (!textObj) return;

    // 记录原始状态
    const originalLeft = textObj.left;
    const originalTop = textObj.top;
    const originalWidth = textObj.getScaledWidth();
    const originalHeight = textObj.getScaledHeight();
    const originalCenter = textObj.getCenterPoint();

    // 应用新样式
    textObj.set(newStyle);

    // 强制更新对象尺寸
    textObj.setCoords();

    // 恢复到原始中心点位置
    textObj.setPositionByOrigin(originalCenter, 'center', 'center');

    // 再次更新坐标以确保正确渲染
    textObj.setCoords();
}

// ========== 批量图片管理 ==========

// 🔑 防重复上传机制
let lastUploadTime = 0;
const UPLOAD_DEBOUNCE_MS = 500; // 500ms内的重复调用会被忽略

function handleImageUpload(files) {
    if (!files || files.length === 0) return;

    // 🔑 防重复：如果距离上次调用不到500ms，忽略
    const now = Date.now();
    if (now - lastUploadTime < UPLOAD_DEBOUNCE_MS) {
        console.warn('⚠️ 重复上传被阻止 (防抖机制)');
        return;
    }
    lastUploadTime = now;

    console.log('📤 handleImageUpload 调用:', files.length, '个文件');
    console.trace('调用堆栈:'); // 打印调用堆栈

    const statusElem = document.getElementById('uploadStatus');

    // 将文件添加到状态队列
    let addedCount = 0;
    Array.from(files).forEach(file => {
        // 简单去重：检查文件名是否已存在
        if (!appState.images.some(img => img.file.name === file.name && img.file.size === file.size)) {
            appState.images.push({
                id: Date.now() + Math.random(),
                file: file,
                url: URL.createObjectURL(file),
                status: 'pending', // pending, processing, done, error
                result: null,
                canvasData: null
            });
            addedCount++;
        }
    });

    statusElem.textContent = `已添加 ${addedCount} 张新图片，共 ${appState.images.length} 张待处理`;
    renderThumbnails();

    // 🔑 隐藏空状态占位符
    const originalEmpty = document.getElementById('original-empty');
    if (originalEmpty && addedCount > 0) originalEmpty.style.display = 'none';

    // 🔑 成功上传反馈：给上传区域添加一个短暂的成功状态
    if (addedCount > 0) {
        const uz = document.getElementById('uploadZone');
        if (uz) {
            uz.classList.add('upload-success');
            setTimeout(() => uz.classList.remove('upload-success'), 2000);
        }
    }

    // 如果当前没有选中的图片，自动选中第一张新添加的
    if (appState.currentIndex === -1 && appState.images.length > 0) {
        switchImage(0);
    }

    // 🔑 重置file input，允许再次选择同样的文件
    const fileInput = document.getElementById('multi-image-upload');
    if (fileInput) fileInput.value = '';
}

// 切换当前显示的图片
async function switchImage(index) {
    if (index < 0 || index >= appState.images.length) return;

    // 1. 保存当前图片的状态 (如果有)
    if (appState.currentIndex !== -1 && canvas) {
        const currentImg = appState.images[appState.currentIndex];
        // 只有当图片已处理且画布有效时才保存
        if (currentImg.status === 'done') {
            currentImg.canvasData = serializeCanvas(canvas);
        }
    }

    // 2. 切换索引
    appState.currentIndex = index;
    const nextImg = appState.images[index];

    // 更新全局变量
    currentImage = nextImg.file;
    currentFilename = nextImg.file.name;

    // 3. 更新UI
    renderThumbnails();

    // 更新原图预览
    const originalPreview = document.getElementById('original-preview');
    // 不要清空src，这会导致闪烁。直接让新图片替换旧图片即可。
    // originalPreview.src = '';

    // 优化切换：不立即清空，以免闪烁。
    // 只有当需要显示loading或明确切换失败时再清理

    // 如果canvas存在，可以暂时禁用交互，防止在切换期间误触
    if (canvas) {
        canvas.discardActiveObject();
        canvas.requestRenderAll();
    }

    // [Critical Fix] Set source immediately to ensure display
    // Don't wait for onload to set src, otherwise it stays blank until loaded
    originalPreview.src = nextImg.url;

    return new Promise((resolve) => {
        // 等待图片加载以更新原始尺寸
        const tempImg = new Image();
        tempImg.onload = async function () {
            window.originalImageWidth = this.width;
            window.originalImageHeight = this.height;

            // 设置原图预览样式 - 让CSS控制，不要用JS反复修改，防止抖动
            // 由于已经在外部设置了src，这里不需要重新设置
            // originalPreview.src = nextImg.url; 

            // 4. 统一调用多语言加载函数数据项内容数据项内容数据项内容数据项内容数据项内容数据项内容数据项内容
            // 无论是否有结果，都调用它来处理背景、画布和历史锁定数据项内容数据项内容数据项内容数据项内容数据项内容数据项内容数据项内容
            try {
                await loadMultiLangImageToCanvas(appState.currentLang, index);
            } catch (e) {
                console.error("加载图片失败:", e);
            }

            resolve();
        };
        // 🔑 关键修复：指定 crossOrigin 否则加载本地/外部资源可能冲突
        tempImg.crossOrigin = "anonymous";
        tempImg.src = nextImg.url;
    });
}

// 渲染缩略图栏
function renderThumbnails() {
    const container = document.getElementById('thumbnailArea');
    if (!container) return;
    container.innerHTML = ''; // 清空

    if (appState.images.length === 0) {
        container.innerHTML = '<div class="thumbnail-placeholder">上传图片后，缩略图将显示在这里</div>';
        return;
    }

    appState.images.forEach((img, index) => {
        const div = document.createElement('div');

        // 🔑 根据状态添加class
        let className = 'thumbnail';
        if (index === appState.currentIndex) className += ' active';
        if (img.status === 'processing' || img.status === 'pending') {
            className += ' processing';
        }
        if (img.status === 'done') {
            className += ' done';
        }
        div.className = className;

        // 只有done状态才能点击切换
        if (img.status === 'done') {
            div.onclick = () => switchImage(index);
        } else {
            div.style.cursor = 'not-allowed';
        }

        // 索引角标
        const indexBadge = document.createElement('div');
        indexBadge.className = 'thumbnail-index';
        indexBadge.textContent = index + 1;
        div.appendChild(indexBadge);

        const image = document.createElement('img');
        image.src = img.url;
        div.appendChild(image);

        // 删除按钮
        const deleteBtn = document.createElement('div');
        deleteBtn.className = 'thumbnail-delete';
        deleteBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
        deleteBtn.title = '删除此图片';
        deleteBtn.onclick = (e) => {
            e.stopPropagation();
            deleteImage(index);
        };
        div.appendChild(deleteBtn);

        // 成功勾选
        if (img.status === 'done') {
            const check = document.createElement('div');
            check.className = 'thumbnail-success-check';
            check.innerHTML = '✓';
            div.appendChild(check);
        }

        // 处理中指示器
        if (img.status === 'processing' || img.status === 'pending') {
            const loader = document.createElement('div');
            loader.className = 'thumbnail-loading-spinner';
            div.appendChild(loader);
        }

        container.appendChild(div);
    });
}

// 删除图片函数
function deleteImage(index) {
    if (index < 0 || index >= appState.images.length) return;

    // 确认删除
    const img = appState.images[index];
    if (!confirm(`确定要删除图片 "${img.file.name}" 吗？`)) {
        return;
    }

    // 释放URL对象
    URL.revokeObjectURL(img.url);

    // 从数组中移除
    appState.images.splice(index, 1);

    // 更新当前索引
    if (appState.images.length === 0) {
        // 没有图片了，重置状态
        appState.currentIndex = -1;
        const originalPreview = document.getElementById('original-preview');
        if (originalPreview) originalPreview.src = '';
        const canvasContainer = document.getElementById('fabricCanvasContainer');
        if (canvasContainer) canvasContainer.style.display = 'none';
        document.getElementById('uploadStatus').textContent = '所有图片已删除，请重新上传';
    } else if (appState.currentIndex >= appState.images.length) {
        // 当前索引超出范围，选择最后一张
        switchImage(appState.images.length - 1);
    } else if (appState.currentIndex === index) {
        // 删除的是当前图片，切换到下一张（如果有）或上一张
        const nextIndex = index < appState.images.length ? index : index - 1;
        switchImage(nextIndex);
    } else if (index < appState.currentIndex) {
        // 删除的在当前图片之前，索引需要-1
        appState.currentIndex--;
    }

    // 重新渲染缩略图
    renderThumbnails();

    // 更新状态文本
    const statusElem = document.getElementById('uploadStatus');
    if (appState.images.length > 0) {
        statusElem.textContent = `剩余 ${appState.images.length} 张图片`;
    }
}

// 🔑 单张下载功能 - 保存当前画布（精确导出，保持原始格式）
async function downloadImage() {
    console.log('downloadImage() 被调用');

    if (!canvas) {
        alert('没有可下载的图片');
        console.error('canvas is null');
        return;
    }

    try {
        // 尝试获取当前图片的原始文件名和格式
        let filename = 'image_' + Date.now() + '.png';
        let mimeType = 'image/png';
        let quality = 1;

        // 如果在多语言模式，尝试获取原始文件名和格式
        if (appState.translations && appState.currentLang) {
            const langData = appState.translations[appState.currentLang];
            if (langData && langData.images && langData.images[appState.currentIndex]) {
                const imgObj = langData.images[appState.currentIndex];
                if (imgObj.originalImg && imgObj.originalImg.file) {
                    const originalName = imgObj.originalImg.file.name;
                    const ext = originalName.split('.').pop().toLowerCase();

                    // 🔑 保持原始格式
                    if (ext === 'jpg' || ext === 'jpeg') {
                        filename = originalName; // 保持原名
                        mimeType = 'image/jpeg';
                        quality = 0.95; // JPEG 质量
                    } else if (ext === 'webp') {
                        filename = originalName;
                        mimeType = 'image/webp';
                        quality = 0.95;
                    } else {
                        // 默认 PNG
                        filename = originalName.replace(/\.[^.]+$/, '.png');
                        mimeType = 'image/png';
                    }
                }
            }
        }

        // 🔑 方案：将画布内容绘制到一个2D canvas上导出
        const originalWidth = window.originalImageWidth || canvas.getWidth();
        const originalHeight = window.originalImageHeight || canvas.getHeight();
        const scale = originalWidth / canvas.getWidth();

        console.log('导出参数:', {
            canvasWidth: canvas.getWidth(),
            canvasHeight: canvas.getHeight(),
            originalWidth: originalWidth,
            originalHeight: originalHeight,
            scale: scale,
            format: mimeType,
            filename: filename
        });

        // 创建临时2D画布
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = originalWidth;
        tempCanvas.height = originalHeight;
        const ctx = tempCanvas.getContext('2d');

        // 缩放上下文
        ctx.scale(scale, scale);

        // 将fabric canvas的内容绘制到2D canvas
        const fabricCanvasElem = canvas.getElement();
        ctx.drawImage(fabricCanvasElem, 0, 0);

        // 🔑 根据原始格式导出
        const dataURL = tempCanvas.toDataURL(mimeType, quality);

        const link = document.createElement('a');
        link.download = filename;
        link.href = dataURL;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        // 🔑 只有在成功获取 dataURL 后才保存历史
        console.log('✅ 下载成功，准备保存到同步历史');
        saveCurrentToHistory();

        console.log('✅ 下载成功:', filename);
    } catch (e) {
        console.error('下载失败:', e);
        alert('下载失败: ' + e.message);
    }
}

// 批量下载功能 - 支持多语言模式
async function downloadAllImages() {
    console.log('downloadAllImages() 被调用');

    // 🔑 先保存当前画布状态
    syncCurrentCanvasToState();

    // 检查是否有多语言翻译数据
    const hasMultiLang = appState.translations && Object.keys(appState.translations).length > 0;
    console.log('多语言模式:', hasMultiLang, '翻译数据:', appState.translations);

    if (!hasMultiLang) {
        // 兼容旧模式：检查appState.images
        const processedImages = appState.images.filter(img => img.status === 'done');
        if (processedImages.length === 0) {
            alert("没有已完成处理的图片可供下载");
            return;
        }
    }

    const btn = document.getElementById('download-all-btn');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<span>打包中...</span>';
    btn.disabled = true;

    try {
        const zip = new JSZip();

        if (hasMultiLang) {
            // 🔑 多语言模式：每种语言一个文件夹
            const langCodes = Object.keys(appState.translations);
            let totalCount = 0;
            let exportedCount = 0;

            // 计算总数
            langCodes.forEach(code => {
                totalCount += appState.translations[code].images.filter(i => i.status === 'done').length;
            });

            for (const langCode of langCodes) {
                const langData = appState.translations[langCode];
                const doneImages = langData.images.filter(img => img.status === 'done');

                if (doneImages.length === 0) continue;

                const folder = zip.folder(langData.name);

                for (let i = 0; i < doneImages.length; i++) {
                    const imgObj = doneImages[i];
                    exportedCount++;
                    btn.innerHTML = `<span>导出 ${exportedCount}/${totalCount}</span>`;

                    try {
                        const dataURL = await exportImageOffscreen(imgObj);
                        if (dataURL) {
                            const base64Data = dataURL.replace(/^data:image\/(png|jpg);base64,/, "");
                            const fileName = imgObj.originalImg ? imgObj.originalImg.file.name : `image_${i}.png`;
                            folder.file(fileName, base64Data, { base64: true });
                        }
                    } catch (e) {
                        console.error(`导出失败: ${langData.name}/${imgObj.originalImg?.file?.name}`, e);
                    }
                }
            }
        } else {
            // 旧模式兼容
            const folder = zip.folder("translated_images");
            const processedImages = appState.images.filter(img => img.status === 'done');

            for (let i = 0; i < processedImages.length; i++) {
                const img = processedImages[i];
                btn.innerHTML = `<span>导出 ${i + 1}/${processedImages.length}</span>`;

                try {
                    await loadProcessedImageToCanvas(img);
                    await new Promise(r => setTimeout(r, 500));
                    canvas.renderAll();

                    const dataURL = canvas.toDataURL({ format: 'png', quality: 1 });
                    const base64Data = dataURL.replace(/^data:image\/(png|jpg);base64,/, "");
                    folder.file(img.file.name, base64Data, { base64: true });
                } catch (e) {
                    console.error("导出失败", img.file.name, e);
                }
            }
        }

        // 生成并下载
        const content = await zip.generateAsync({ type: "blob" });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(content);
        // 使用 xobi_日期 格式命名
        const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        link.download = `xobi_${today}.zip`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        // 🔑 批量下载成功后保存历史
        console.log('✅ 批量下载成功，准备保存到同步历史');
        saveCurrentToHistory();

    } catch (e) {
        alert("打包下载失败: " + e.message);
        console.error(e);
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

// 直接下载功能 - 不打包成ZIP，直接触发多次浏览器下载
// 直接下载功能 - 不打包成ZIP，直接触发多次浏览器下载
async function downloadDirectly() {
    console.log('downloadDirectly() 被调用');

    const hasMultiLang = appState.translations && Object.keys(appState.translations).length > 0;

    // 🔑 保存当前状态
    syncCurrentCanvasToState();

    if (!hasMultiLang) {
        const processedImages = appState.images.filter(img => img.status === 'done');
        if (processedImages.length === 0) {
            alert("没有已完成处理的图片可供下载");
            return;
        }
    }

    const btn = document.getElementById('download-direct-btn');
    if (!btn) return;
    const originalText = btn.innerHTML;
    btn.innerHTML = '<span>🚀 正在下载...</span>';
    btn.disabled = true;

    try {
        let exportedImages = [];

        if (hasMultiLang) {
            const langCodes = Object.keys(appState.translations);
            for (const langCode of langCodes) {
                const langData = appState.translations[langCode];
                const doneImages = langData.images.filter(img => img.status === 'done');
                for (const imgObj of doneImages) {
                    const fileName = imgObj.originalImg ? imgObj.originalImg.file.name.replace(/\.[^.]+$/, `_${langCode}.png`) : `image_${langCode}.png`;
                    exportedImages.push({ imgObj, fileName });
                }
            }
        } else {
            const processedImages = appState.images.filter(img => img.status === 'done');
            processedImages.forEach((img, i) => {
                exportedImages.push({ imgObj: img, fileName: img.file.name });
            });
        }

        if (exportedImages.length === 0) {
            alert("没有已完成处理的图片可供下载");
            return;
        }

        if (exportedImages.length > 5 && !confirm(`即将直接下载 ${exportedImages.length} 张图片，浏览器可能会弹出多次提示，是否继续？`)) {
            return;
        }

        for (let i = 0; i < exportedImages.length; i++) {
            const { imgObj, fileName } = exportedImages[i];
            btn.innerHTML = `<span>下载中 ${i + 1}/${exportedImages.length}</span>`;

            try {
                const dataURL = await exportImageOffscreen(imgObj);
                if (dataURL) {
                    const link = document.createElement('a');
                    link.href = dataURL;
                    link.download = fileName;
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    // 增加小延迟防止浏览器拦截
                    await new Promise(r => setTimeout(r, 400));
                }
            } catch (e) {
                console.error("单个下载失败", fileName, e);
            }
        }

        // 🔑 直接下载成功后保存历史
        console.log('✅ 直接下载成功，准备保存到同步历史');
        saveCurrentToHistory();

    } catch (e) {
        alert("直接下载失败: " + e.message);
        console.error(e);
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}


// 注意: 批量下载按钮在HTML中已用onclick绑定，这里不再重复绑定
// 否则会触发两次下载


// 🔑 同步样式到所有语言（当前图片）
async function syncStylesToAllLangs() {
    console.log('syncStylesToAllLangs() 被调用');

    // 🔑 调试：打印所有语言的状态
    console.log('📊 所有语言状态:');
    Object.keys(appState.translations || {}).forEach(lang => {
        const langData = appState.translations[lang];
        console.log(`  ${lang}: images=${langData?.images?.length || 0}, image0Status=${langData?.images?.[0]?.status}`);
    });

    if (!canvas || !appState.currentLang || appState.currentIndex === -1 || !appState.translations) {
        alert('❌ 无法同步：当前没有可用的翻译数据或未开启多语言翻译。');
        return;
    }

    // 🔑 激活同步锁，防止后续操作覆盖同步数据
    appState.syncLock = true;
    console.log('🔒 同步锁已激活');

    // 1. 保存当前状态到当前语言对象
    const curIdx = appState.currentIndex;
    const curLang = appState.currentLang;
    const currentImgObj = appState.translations[curLang].images[curIdx];

    if (!currentImgObj) {
        alert('❌ 找不到当前图片的翻译记录');
        appState.syncLock = false;  // 解除锁
        return;
    }

    // 获取包含关键属性的JSON
    // 明确包含我们需要同步的属性
    const sourceJSON = serializeCanvas(canvas);

    // 🔑 调试：显示源 JSON 的结构
    console.log('📦 源 canvasData:', {
        hasObjects: !!sourceJSON.objects,
        objectsCount: sourceJSON.objects?.length || 0,
        objectTypes: sourceJSON.objects?.map(o => o.type),
        firstObjFill: sourceJSON.objects?.[0]?.fill,
        firstObjFontSize: sourceJSON.objects?.[0]?.fontSize,  // 🔑 添加字号
        firstObjLeft: sourceJSON.objects?.[0]?.left,
        firstObjTextAlign: sourceJSON.objects?.[0]?.textAlign,
        firstObjWidth: sourceJSON.objects?.[0]?.width
    });

    currentImgObj.canvasData = sourceJSON;

    let updatedCount = 0;
    const allLangs = Object.keys(appState.translations);
    const syncedData = {}; // 🔑 存储同步的数据，用于验证

    console.log(`[T+0] 🌐 开始遍历语言: [${allLangs.join(', ')}], 当前: ${curLang}`);
    const startTime = performance.now();

    // 2. 遍历其他所有语言
    allLangs.forEach(targetLang => {
        if (targetLang === curLang) {
            return;
        }

        const targetImgObj = appState.translations[targetLang].images[curIdx];

        // 🔑 调试日志：帮助诊断同步问题
        console.log(`检查语言 ${targetLang}:`, {
            hasImgObj: !!targetImgObj,
            hasResult: targetImgObj?.result ? true : false,
            status: targetImgObj?.status,
            hasTranslations: targetImgObj?.result?.translations ? true : false
        });

        if (!targetImgObj) {
            console.warn(`⚠️ 跳过 ${targetLang}: 找不到图片对象`);
            return;
        }
        if (!targetImgObj.result) {
            console.warn(`⚠️ 跳过 ${targetLang}: 没有翻译结果`);
            return;
        }
        if (targetImgObj.status !== 'done') {
            console.warn(`⚠️ 跳过 ${targetLang}: 状态不是 done，当前状态: ${targetImgObj.status}`);
            return;
        }

        const targetTranslations = targetImgObj.result.translations || [];
        console.log(`✅ 同步到 ${targetLang}, 翻译文本数量: ${targetTranslations.length}`);

        // 3. 克隆当前布局 (Deep Copy)
        const targetJSON = JSON.parse(JSON.stringify(sourceJSON));

        // 4. 按顺序替换文本框内容，保留字号，智能适配宽度避免换行
        let textCount = 0;
        const canvasWidth = sourceJSON.width || canvas.width || 800;
        const canvasHeight = sourceJSON.height || canvas.height || 600;

        targetJSON.objects.forEach(obj => {
            if (obj.type === 'textbox' || obj.type === 'i-text') {
                if (textCount < targetTranslations.length) {
                    const newText = targetTranslations[textCount];
                    const oldWidth = obj.width;
                    const oldLeft = obj.left;
                    obj.text = newText;

                    console.log(`[Sync Debug] Processing Obj #${textCount} for ${targetLang}:`);
                    console.log(`  Source: left=${oldLeft}, textAlign=${obj.textAlign}, width=${oldWidth}, text="${obj.text}"`);

                    // 🔑 使用 fabric.js 测量实际渲染宽度
                    try {
                        const tempText = new fabric.Textbox(newText, {
                            fontSize: obj.fontSize,
                            fontFamily: obj.fontFamily || 'Arial',
                            fontWeight: obj.fontWeight || 'normal',
                            fontStyle: obj.fontStyle || 'normal',
                            width: 99999  // 设置很大的宽度来测量单行文本宽度
                        });

                        // 获取文本实际需要的宽度（单行时的宽度）
                        const neededWidth = (tempText.calcTextWidth() + 25); // 加一些padding
                        const scaleX = obj.scaleX || 1;
                        const currentScaledWidth = oldWidth * scaleX;
                        const neededScaledWidth = neededWidth * scaleX;

                        // 如果需要的渲染宽度比当前渲染宽度大，扩展宽度
                        if (neededScaledWidth > currentScaledWidth) {
                            let newScaledWidth = Math.round(neededScaledWidth);
                            const deltaWidth = newScaledWidth - currentScaledWidth;

                            // 🔑 修复：根据 originX 和 textAlign 决定扩展方向
                            // originX 决定了 "left" 坐标指的是框的哪个位置
                            // textAlign 决定了用户期望的视觉对齐方式
                            const originX = obj.originX || 'left';
                            const textAlign = obj.textAlign || 'left';

                            // 首先，计算当前框的"视觉左边缘"位置
                            let visualLeftEdge;
                            if (originX === 'center') {
                                visualLeftEdge = oldLeft - (currentScaledWidth / 2);
                            } else if (originX === 'right') {
                                visualLeftEdge = oldLeft - currentScaledWidth;
                            } else { // 'left'
                                visualLeftEdge = oldLeft;
                            }

                            // 然后，根据 textAlign 决定扩展后框的新位置
                            // 保持对应边缘不变
                            if (textAlign === 'right') {
                                // 右对齐：保持右边缘不变，向左扩展
                                const visualRightEdge = visualLeftEdge + currentScaledWidth;
                                const newVisualLeftEdge = visualRightEdge - newScaledWidth;
                                // 根据 originX 计算新的 left
                                if (originX === 'center') {
                                    obj.left = newVisualLeftEdge + (newScaledWidth / 2);
                                } else if (originX === 'right') {
                                    obj.left = newVisualLeftEdge + newScaledWidth;
                                } else {
                                    obj.left = newVisualLeftEdge;
                                }
                            } else if (textAlign === 'center') {
                                // 居中对齐：保持中心不变，向两边扩展
                                const visualCenter = visualLeftEdge + (currentScaledWidth / 2);
                                const newVisualLeftEdge = visualCenter - (newScaledWidth / 2);
                                if (originX === 'center') {
                                    obj.left = visualCenter; // 中心不变
                                } else if (originX === 'right') {
                                    obj.left = newVisualLeftEdge + newScaledWidth;
                                } else {
                                    obj.left = newVisualLeftEdge;
                                }
                            } else {
                                // 左对齐：保持左边缘不变，向右扩展
                                // 视觉左边缘不变
                                if (originX === 'center') {
                                    obj.left = visualLeftEdge + (newScaledWidth / 2);
                                } else if (originX === 'right') {
                                    obj.left = visualLeftEdge + newScaledWidth;
                                } else {
                                    obj.left = visualLeftEdge; // 不变
                                }
                            }

                            // 🔑 边界约束：确保文本框渲染后不超出画布左右边界
                            const padding = 15;
                            const maxPossibleScaledWidth = canvasWidth - 2 * padding;

                            // 重新计算当前的视觉左边缘
                            let currentVisualLeft;
                            if (originX === 'center') {
                                currentVisualLeft = obj.left - (newScaledWidth / 2);
                            } else if (originX === 'right') {
                                currentVisualLeft = obj.left - newScaledWidth;
                            } else {
                                currentVisualLeft = obj.left;
                            }

                            // 1. 宽度强制限制
                            if (newScaledWidth > maxPossibleScaledWidth) {
                                newScaledWidth = maxPossibleScaledWidth;
                            }

                            // 2. 左边界检查
                            if (currentVisualLeft < padding) {
                                currentVisualLeft = padding;
                            }
                            // 3. 右边界检查
                            if (currentVisualLeft + newScaledWidth > canvasWidth - padding) {
                                currentVisualLeft = canvasWidth - padding - newScaledWidth;
                            }
                            // 4. 再次检查左边界
                            if (currentVisualLeft < padding) {
                                currentVisualLeft = padding;
                                newScaledWidth = canvasWidth - 2 * padding;
                            }

                            // 根据 originX 转换回 obj.left
                            if (originX === 'center') {
                                obj.left = currentVisualLeft + (newScaledWidth / 2);
                            } else if (originX === 'right') {
                                obj.left = currentVisualLeft + newScaledWidth;
                            } else {
                                obj.left = currentVisualLeft;
                            }

                            obj.width = newScaledWidth / scaleX;
                            console.log(`  📐 智能扩展 (textAlign=${textAlign}, originX=${originX}): left=${obj.left.toFixed(1)}, width=${obj.width.toFixed(1)}`);
                        }
                    } catch (e) {
                        console.error('测量宽度失败:', e);
                        // 回退逻辑
                        const maxW = (canvasWidth - obj.left - 10) / (obj.scaleX || 1);
                        obj.width = Math.min(obj.width * 1.5, maxW);
                    }

                    console.log(`  同步文本 ${textCount}: fontSize=${obj.fontSize}, width=${obj.width}`);
                }
                textCount++;
            }
        });

        // 5. 创建完全独立的 canvasData
        const finalCanvasData = JSON.parse(JSON.stringify(targetJSON));

        // 🔑 存储到本地变量
        syncedData[targetLang] = finalCanvasData;

        // 直接设置到 appState
        appState.translations[targetLang].images[curIdx].canvasData = finalCanvasData;

        const elapsed = (performance.now() - startTime).toFixed(2);
        console.log(`[T+${elapsed}ms] 📝 已保存 ${targetLang}: fontSize=${finalCanvasData?.objects?.[0]?.fontSize}`);

        updatedCount++;
    });

    const totalElapsed = (performance.now() - startTime).toFixed(2);
    console.log(`[T+${totalElapsed}ms] ✅ forEach 循环结束, updatedCount=${updatedCount}`);

    // 🔑 同步完成后的处理（在 forEach 循环外部）
    if (updatedCount > 0) {
        // 🔑 从本地变量验证
        console.log(`[T+${(performance.now() - startTime).toFixed(2)}ms] 📊 从 syncedData 验证:`);
        Object.keys(syncedData).forEach(lang => {
            const fs = syncedData[lang]?.objects?.[0]?.fontSize;
            console.log(`  ${lang}: fontSize=${fs}`);
        });

        // 🔑 从 appState 验证
        console.log(`[T+${(performance.now() - startTime).toFixed(2)}ms] 📊 同步后验证（renderMultiLangThumbnails 之前）:`);
        Object.keys(appState.translations).forEach(lang => {
            const imgObj = appState.translations[lang].images[curIdx];
            const objects = imgObj?.canvasData?.objects || [];
            const fontSizes = objects.filter(o => o.type === 'textbox').map(o => o.fontSize);
            console.log(`  ${lang}: fontSizes=[${fontSizes.join(', ')}]`);
        });

        // 刷新缩略图显示
        renderMultiLangThumbnails();

        // 🔑 再次验证（在 renderMultiLangThumbnails 之后）
        console.log('📊 同步后验证（renderMultiLangThumbnails 之后）:');
        Object.keys(appState.translations).forEach(lang => {
            const imgObj = appState.translations[lang].images[curIdx];
            const objects = imgObj?.canvasData?.objects || [];
            const fontSizes = objects.filter(o => o.type === 'textbox').map(o => o.fontSize);
            console.log(`  ${lang}: fontSizes=[${fontSizes.join(', ')}]`);
        });

        alert(`✅ 同步完成！当前图片的"排版布局"和"字体样式"已同步到其他 ${updatedCount} 种语言。`);
        console.log(`✅ 已同步样式到 ${updatedCount} 个语言版本`);
    } else {
        alert('ℹ️ 未发现需要同步的其他语言图片。');
    }

    // 🔑 延迟解除同步锁（确保所有异步操作完成后再允许保存）
    setTimeout(() => {
        appState.syncLock = false;
        console.log('🔓 同步锁已解除');
    }, 500);
}


// 🌍 全局同步：同步当前样式到【所有图片】的【所有语言】
async function syncStylesToEverything() {
    console.log('syncStylesToEverything() 被调用');

    if (!canvas || !appState.translations) {
        alert('❌ 无法同步：当前没有可用的翻译数据。');
        return;
    }

    const totalImages = appState.images.length;
    const totalLangs = Object.keys(appState.translations).length;

    if (!confirm(`确定要将当前排版样式应用到所有图片吗？\n这将影响 ${totalImages} 张图片 × ${totalLangs} 种语言共 ${totalImages * totalLangs} 个结果。`)) {
        return;
    }

    // 1. 获取源样式JSON
    const sourceJSON = serializeCanvas(canvas);

    // 立即保存当前这张图
    if (appState.translations[appState.currentLang] && appState.translations[appState.currentLang].images[appState.currentIndex]) {
        appState.translations[appState.currentLang].images[appState.currentIndex].canvasData = sourceJSON;
    }

    // 🔑 激活同步锁
    appState.syncLock = true;
    console.log('🔒 全局同步锁已激活');

    const btn = document.getElementById('sync-all-everything-btn');
    let originalText = '';
    if (btn) {
        originalText = btn.innerHTML;
        btn.innerHTML = '<span>⏳ 正在全局同步...</span>';
        btn.disabled = true;
    }

    let updatedCount = 0;

    try {
        // 2. 遍历所有语言
        Object.keys(appState.translations).forEach(langCode => {
            const langData = appState.translations[langCode];

            // 3. 遍历该语言下的所有图片
            langData.images.forEach((imgObj, imgIdx) => {
                if (!imgObj || !imgObj.result || imgObj.status !== 'done') return;

                // 跳过当前正在编辑的这张（已经存过了）
                if (langCode === appState.currentLang && imgIdx === appState.currentIndex) return;

                const translations = imgObj.result.translations || [];

                // 4. 克隆布局
                const targetJSON = JSON.parse(JSON.stringify(sourceJSON));

                // 5. 替换文本，保持字号不变，智能扩展宽度
                let textCount = 0;
                const canvasWidth = sourceJSON.width || canvas.width || 800;

                targetJSON.objects.forEach(obj => {
                    if (obj.type === 'textbox' || obj.type === 'i-text') {
                        if (textCount < translations.length) {
                            const newText = translations[textCount];
                            const oldWidth = obj.width;
                            const oldLeft = obj.left;
                            obj.text = newText;

                            // 🔑 使用 fabric.js 测量实际渲染宽度
                            try {
                                const tempText = new fabric.Textbox(newText, {
                                    fontSize: obj.fontSize,
                                    fontFamily: obj.fontFamily || 'Arial',
                                    fontWeight: obj.fontWeight || 'normal',
                                    fontStyle: obj.fontStyle || 'normal',
                                    width: 99999  // 设置很大的宽度来测量单行文本宽度
                                });

                                // 获取文本实际需要的宽度（单行时的宽度）
                                const neededWidth = (tempText.calcTextWidth() + 25); // 加一些padding
                                const scaleX = obj.scaleX || 1;
                                const currentScaledWidth = oldWidth * scaleX;
                                const neededScaledWidth = neededWidth * scaleX;

                                // 如果需要的宽度比当前宽度大，扩展宽度
                                if (neededScaledWidth > currentScaledWidth) {
                                    let newScaledWidth = Math.round(neededScaledWidth);
                                    const deltaWidth = newScaledWidth - currentScaledWidth;

                                    // 🔑 修复：根据 originX 和 textAlign 决定扩展方向
                                    const originX = obj.originX || 'left';
                                    const textAlign = obj.textAlign || 'left';

                                    // 计算当前框的"视觉左边缘"位置
                                    let visualLeftEdge;
                                    if (originX === 'center') {
                                        visualLeftEdge = oldLeft - (currentScaledWidth / 2);
                                    } else if (originX === 'right') {
                                        visualLeftEdge = oldLeft - currentScaledWidth;
                                    } else {
                                        visualLeftEdge = oldLeft;
                                    }

                                    // 根据 textAlign 决定扩展后框的新位置
                                    if (textAlign === 'right') {
                                        const visualRightEdge = visualLeftEdge + currentScaledWidth;
                                        const newVisualLeftEdge = visualRightEdge - newScaledWidth;
                                        if (originX === 'center') {
                                            obj.left = newVisualLeftEdge + (newScaledWidth / 2);
                                        } else if (originX === 'right') {
                                            obj.left = newVisualLeftEdge + newScaledWidth;
                                        } else {
                                            obj.left = newVisualLeftEdge;
                                        }
                                    } else if (textAlign === 'center') {
                                        const visualCenter = visualLeftEdge + (currentScaledWidth / 2);
                                        const newVisualLeftEdge = visualCenter - (newScaledWidth / 2);
                                        if (originX === 'center') {
                                            obj.left = visualCenter;
                                        } else if (originX === 'right') {
                                            obj.left = newVisualLeftEdge + newScaledWidth;
                                        } else {
                                            obj.left = newVisualLeftEdge;
                                        }
                                    } else {
                                        // 左对齐：保持左边缘不变
                                        if (originX === 'center') {
                                            obj.left = visualLeftEdge + (newScaledWidth / 2);
                                        } else if (originX === 'right') {
                                            obj.left = visualLeftEdge + newScaledWidth;
                                        } else {
                                            obj.left = visualLeftEdge;
                                        }
                                    }

                                    // 🧱 边界约束
                                    const padding = 15;
                                    const maxPossibleScaledWidth = canvasWidth - 2 * padding;

                                    // 重新计算视觉左边缘
                                    let currentVisualLeft;
                                    if (originX === 'center') {
                                        currentVisualLeft = obj.left - (newScaledWidth / 2);
                                    } else if (originX === 'right') {
                                        currentVisualLeft = obj.left - newScaledWidth;
                                    } else {
                                        currentVisualLeft = obj.left;
                                    }

                                    if (newScaledWidth > maxPossibleScaledWidth) {
                                        newScaledWidth = maxPossibleScaledWidth;
                                    }
                                    if (currentVisualLeft < padding) {
                                        currentVisualLeft = padding;
                                    }
                                    if (currentVisualLeft + newScaledWidth > canvasWidth - padding) {
                                        currentVisualLeft = canvasWidth - padding - newScaledWidth;
                                    }
                                    if (currentVisualLeft < padding) {
                                        currentVisualLeft = padding;
                                        newScaledWidth = canvasWidth - 2 * padding;
                                    }

                                    // 转换回 obj.left
                                    if (originX === 'center') {
                                        obj.left = currentVisualLeft + (newScaledWidth / 2);
                                    } else if (originX === 'right') {
                                        obj.left = currentVisualLeft + newScaledWidth;
                                    } else {
                                        obj.left = currentVisualLeft;
                                    }

                                    obj.width = newScaledWidth / scaleX;
                                }
                            } catch (e) {
                                // 回退
                                const maxW = (canvasWidth - obj.left - 10) / (obj.scaleX || 1);
                                obj.width = Math.min(obj.width * 1.5, maxW);
                            }
                        }
                        textCount++;
                    }
                });

                imgObj.canvasData = targetJSON;
                updatedCount++;
            });
        });

        // 🔑 刷新缩略图显示
        renderMultiLangThumbnails();
        alert(`✅ 全局同步完成！已应用到 ${updatedCount} 个翻译结果。所有图片的排版现在都与当前图片一致。`);
    } catch (e) {
        console.error('全局同步失败:', e);
        alert('❌ 全局同步失败: ' + e.message);
    } finally {
        if (btn) {
            btn.innerHTML = originalText;
            btn.disabled = false;
        }
        // 🔑 延迟解除同步锁
        setTimeout(() => {
            appState.syncLock = false;
            console.log('🔓 全局同步锁已解除');
        }, 500);
    }
}

function renderDownloadButtons() {
    const container = document.getElementById('multi-lang-downloads');
    const btnsDiv = document.getElementById('lang-download-btns');
    const syncContainer = document.getElementById('sync-buttons-container');

    if (!appState.translations || Object.keys(appState.translations).length === 0) {
        if (container) container.style.display = 'none';
        if (syncContainer) syncContainer.style.display = 'none';
        return;
    }

    // 检查是否有任何已完成的翻译
    let totalDone = 0;
    let allLangsDone = true;
    const langCodes = Object.keys(appState.translations);

    langCodes.forEach(langCode => {
        const langData = appState.translations[langCode];
        const doneCount = langData.images.filter(img => img.status === 'done').length;
        totalDone += doneCount;
        if (doneCount < langData.images.length) {
            allLangsDone = false;
        }
    });

    // 🔑 显示同步按钮容器（只要有任何翻译完成）
    if (syncContainer && totalDone > 0) {
        syncContainer.style.display = 'block';
    }

    if (container) container.style.display = 'block';
    if (btnsDiv) btnsDiv.innerHTML = '';

    Object.keys(appState.translations).forEach(langCode => {
        const langData = appState.translations[langCode];
        const doneCount = langData.images.filter(img => img.status === 'done').length;

        if (doneCount === 0) return;

        // 🔑 创建行容器
        const row = document.createElement('div');
        row.style.cssText = 'display: flex; align-items: center; gap: 8px;';

        // 语言下载按钮
        const btn = document.createElement('button');
        btn.className = 'action-btn secondary';
        btn.id = `download-lang-${langCode}`;
        btn.style.cssText = 'padding: 8px 12px; font-size: 12px; flex: 1;';
        btn.innerHTML = `📦 ${langData.name} (${doneCount}张)`;
        btn.onclick = (e) => downloadByLang(langCode, e.currentTarget);
        row.appendChild(btn);

        // 🔑 打包开关复选框
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = `zip-toggle-${langCode}`;
        checkbox.checked = true; // 默认打包
        checkbox.style.cssText = 'width: 18px; height: 18px; cursor: pointer; accent-color: var(--accent);';
        checkbox.title = '打勾=打包ZIP，不勾=单张下载';
        row.appendChild(checkbox);

        if (btnsDiv) btnsDiv.appendChild(row);
    });
}

// 🔑 按语言下载 - 根据开关决定打包还是单张
async function downloadByLang(langCode, btnElement) {
    // 🔑 保存当前状态
    syncCurrentCanvasToState();

    const langData = appState.translations[langCode];
    if (!langData) {
        alert('找不到该语言的翻译数据');
        return;
    }

    const doneImages = langData.images.filter(img => img.status === 'done');
    if (doneImages.length === 0) {
        alert('该语言没有已完成的翻译');
        return;
    }

    // 🔑 检查打包开关
    const zipToggle = document.getElementById(`zip-toggle-${langCode}`);
    const useZip = zipToggle ? zipToggle.checked : true;

    const btn = btnElement;
    const originalText = btn.innerHTML;
    btn.innerHTML = useZip ? '打包中...' : '导出中...';
    btn.disabled = true;

    try {
        if (useZip) {
            // === 打包ZIP模式 ===
            const zip = new JSZip();

            for (let i = 0; i < doneImages.length; i++) {
                const imgObj = doneImages[i];
                btn.innerHTML = `导出中 ${i + 1}/${doneImages.length}`;

                try {
                    const dataURL = await exportImageOffscreen(imgObj);
                    if (dataURL) {
                        const base64Data = dataURL.replace(/^data:image\/(png|jpg);base64,/, "");
                        const fileName = imgObj.originalImg ? imgObj.originalImg.file.name : `image_${i}.png`;
                        zip.file(fileName, base64Data, { base64: true });
                    }
                } catch (e) {
                    console.error(`导出失败: ${imgObj.originalImg?.file?.name}`, e);
                }
            }

            const content = await zip.generateAsync({ type: "blob" });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(content);
            link.download = `${langData.name}_${doneImages.length}张.zip`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

        } else {
            // === 单张下载模式 ===
            for (let i = 0; i < doneImages.length; i++) {
                const imgObj = doneImages[i];
                btn.innerHTML = `下载 ${i + 1}/${doneImages.length}`;

                try {
                    const dataURL = await exportImageOffscreen(imgObj);
                    if (dataURL) {
                        const fileName = imgObj.originalImg ? imgObj.originalImg.file.name : `image_${i}.png`;
                        const link = document.createElement('a');
                        link.href = dataURL;
                        link.download = fileName;
                        document.body.appendChild(link);
                        link.click();
                        document.body.removeChild(link);

                        // 稍作延迟避免浏览器拦截
                        await new Promise(r => setTimeout(r, 300));
                    }
                } catch (e) {
                    console.error(`下载失败: ${imgObj.originalImg?.file?.name}`, e);
                }
            }
        }

        // 🔑 下载成功后保存历史
        console.log('✅ 按语言下载成功，准备保存到同步历史');
        saveCurrentToHistory();

    } catch (e) {
        alert("下载失败: " + e.message);
        console.error(e);
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

// 🔑 预生成canvasData - 用于批量下载时保持排版一致
// 在翻译完成后立即调用，确保即使用户不点击缩略图也能正确下载
async function generateCanvasDataForImage(imgObj) {
    return new Promise((resolve, reject) => {
        if (!imgObj.result || !imgObj.result.success) {
            resolve(null);
            return;
        }

        const data = imgObj.result;
        const bgImageUrl = data.inpainted_url;
        if (!bgImageUrl) {
            resolve(null);
            return;
        }

        const bgImg = new Image();
        bgImg.crossOrigin = 'anonymous';

        bgImg.onload = function () {
            const tempCanvasElem = document.createElement('canvas');
            tempCanvasElem.width = bgImg.width;
            tempCanvasElem.height = bgImg.height;

            const tempCanvas = new fabric.StaticCanvas(tempCanvasElem, {
                width: bgImg.width,
                height: bgImg.height
            });

            // 设置背景图
            tempCanvas.setBackgroundImage(new fabric.Image(bgImg), () => {
                // 使用和drawTextBoxes一致的文本渲染逻辑
                if (data.text_positions && data.translations) {
                    data.text_positions.forEach((item, idx) => {
                        const translatedText = data.translations[idx];
                        if (!translatedText) return;

                        try {
                            // 🔑 使用相同的通用函数
                            addTextboxToCanvas(tempCanvas, item, translatedText, idx);
                        } catch (e) {
                            console.error(`generateCanvasDataForImage 绘制文本 #${idx} 失败:`, e);
                        }
                    });
                }

                tempCanvas.renderAll();

                // 返回JSON格式的画布数据
                const canvasJSON = serializeCanvas(tempCanvas);
                tempCanvas.dispose();
                resolve(canvasJSON);
            }, { crossOrigin: 'anonymous' });
        };

        bgImg.onerror = () => {
            console.warn('generateCanvasDataForImage: 背景图加载失败');
            resolve(null);
        };
        bgImg.src = bgImageUrl;
    });
}

// 🔑 离屏导出单张图片 - 优先使用保存的画布状态
async function exportImageOffscreen(imgObj) {
    return new Promise(async (resolve, reject) => {
        if (!imgObj.result || !imgObj.result.success) {
            resolve(null);
            return;
        }

        const data = imgObj.result;
        const bgImageUrl = data.inpainted_url;
        if (!bgImageUrl) {
            resolve(null);
            return;
        }

        // 🔑 如果有保存的画布数据，使用它来精确还原用户编辑的状态
        if (imgObj.canvasData) {
            const bgImg = new Image();
            bgImg.crossOrigin = 'anonymous';
            bgImg.onload = function () {
                const tempCanvasElem = document.createElement('canvas');
                tempCanvasElem.width = bgImg.width;
                tempCanvasElem.height = bgImg.height;

                const tempCanvas = new fabric.StaticCanvas(tempCanvasElem, {
                    width: bgImg.width,
                    height: bgImg.height
                });

                // 从保存的JSON恢复画布
                // 🔑 关键修复：不使用 loadFromJSON，而是手动反序列化对象
                // 这样可以完全控制背景图，避免 JSON 中携带的错误背景图导致的问题
                // 同时这种方式更稳定，不容易卡死

                // 1. 先设置正确的背景图
                const correctBgImg = new fabric.Image(bgImg, {
                    originX: 'left',
                    originY: 'top',
                    scaleX: 1,
                    scaleY: 1
                });

                tempCanvas.setBackgroundImage(correctBgImg, () => {
                    // 2. 反序列化对象
                    if (imgObj.canvasData.objects && imgObj.canvasData.objects.length > 0) {
                        imgObj.canvasData.objects.forEach(objData => {
                            try {
                                let fabricObj = null;
                                if (objData.type === 'textbox' || objData.type === 'i-text' || objData.type === 'text') {
                                    fabricObj = new fabric.Textbox(objData.text || '', objData);
                                } else if (objData.type === 'rect') {
                                    fabricObj = new fabric.Rect(objData);
                                } else if (objData.type === 'path') { // 🖌️ 画笔路径
                                    fabricObj = new fabric.Path(objData.path, objData);
                                }
                                if (fabricObj) {
                                    tempCanvas.add(fabricObj);
                                }
                            } catch (objErr) {
                                console.warn('创建对象失败:', objErr, objData.type);
                            }
                        });
                        // 3. 渲染并导出
                        try {
                            tempCanvas.renderAll();
                            const dataURL = tempCanvas.toDataURL({ format: 'png', quality: 1 });
                            tempCanvas.dispose();
                            resolve(dataURL);
                        } catch (renderErr) {
                            console.error('Export render failed:', renderErr);
                            // 尝试回退
                            tempCanvas.dispose();
                            resolve(null);
                        }
                    } else {
                        // 没有对象，直接导出背景
                        tempCanvas.renderAll();
                        const dataURL = tempCanvas.toDataURL({ format: 'png', quality: 1 });
                        tempCanvas.dispose();
                        resolve(dataURL);
                    }
                });
            };
            bgImg.onerror = () => reject(new Error('背景图加载失败'));
            bgImg.src = bgImageUrl;
            return;
        }

        // 加载背景图
        const bgImg = new Image();
        bgImg.crossOrigin = 'anonymous';

        bgImg.onload = function () {
            // 创建临时Fabric canvas
            const tempCanvasElem = document.createElement('canvas');
            tempCanvasElem.width = bgImg.width;
            tempCanvasElem.height = bgImg.height;

            const tempCanvas = new fabric.StaticCanvas(tempCanvasElem, {
                width: bgImg.width,
                height: bgImg.height
            });

            // 设置背景图
            tempCanvas.setBackgroundImage(new fabric.Image(bgImg), () => {
                try {
                    // 绘制文本

                    if (data.text_positions && data.translations) {
                        data.text_positions.forEach((position, idx) => {
                            if (!data.translations[idx]) return;

                            // 🔑 关键修复: text_positions是对象数组，需要访问.box属性
                            const box = position.box || position;
                            if (!box || !Array.isArray(box)) return;

                            const minX = Math.min(...box.map(p => p[0]));
                            const minY = Math.min(...box.map(p => p[1]));
                            const maxX = Math.max(...box.map(p => p[0]));
                            const maxY = Math.max(...box.map(p => p[1]));
                            const width = maxX - minX;
                            const height = maxY - minY;

                            // 🔑 使用position.style中的样式信息
                            const style = position.style || {};
                            const fontSize = style.font_size || Math.max(12, Math.min(height * 0.8, 48));
                            const fill = style.color || '#000000';
                            const fontWeight = style.is_bold ? 'bold' : 'normal';
                            const fontStyle = style.is_italic ? 'italic' : 'normal';
                            const textAlign = style.align || 'center';

                            const text = new fabric.Textbox(data.translations[idx], {
                                left: minX,
                                top: minY,
                                width: width,
                                fontSize: fontSize,
                                fill: fill,
                                fontFamily: 'Arial, "Noto Sans SC", sans-serif',
                                fontWeight: fontWeight,
                                fontStyle: fontStyle,
                                textAlign: textAlign,
                                originX: 'left',
                                originY: 'top'
                            });

                            tempCanvas.add(text);
                        });
                    }

                    tempCanvas.renderAll();

                    const dataURL = tempCanvas.toDataURL({
                        format: 'png',
                        quality: 1
                    });

                    // 清理
                    tempCanvas.dispose();
                    resolve(dataURL);
                } catch (err) {
                    console.error("Canvas导出发生错误 (可能是内存不足):", err);
                    // 发生错误时，回退到原始背景图 (转为Base64)
                    fetch(bgImageUrl)
                        .then(r => r.blob())
                        .then(blob => {
                            const reader = new FileReader();
                            reader.onloadend = () => resolve(reader.result);
                            reader.readAsDataURL(blob);
                        })
                        .catch(e => {
                            console.error("Fallback fetch failed", e);
                            resolve(null);
                        });
                }


            }, { crossOrigin: 'anonymous' });
        };

        bgImg.onerror = () => {
            console.error('exportImageOffscreen: 图片加载失败');
            // 回退到Fetch
            fetch(bgImageUrl)
                .then(r => r.blob())
                .then(blob => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve(reader.result);
                    reader.readAsDataURL(blob);
                })
                .catch(e => resolve(null));
        };
        bgImg.src = bgImageUrl;
    });
}

// 替换原有的 handleImageUpload
function handleImageUpload_legacy(files) {
    const statusElem = document.getElementById('uploadStatus');
    statusElem.textContent = "图片已选择，请点击'开始翻译'按钮";
    // Old logic placeholder
}

document.addEventListener('DOMContentLoaded', () => {


    // ========== 视图控制和缩放逻辑 ==========
    let currentZoom = 1;
    const MIN_ZOOM = 0.1;
    const MAX_ZOOM = 5;
    const ZOOM_STEP = 0.1;

    function applyZoom() {
        const level = Math.round(currentZoom * 100);
        const zoomLabel = document.getElementById('zoomLevel');
        if (zoomLabel) zoomLabel.textContent = `${level}%`;

        // 获取原始尺寸
        const originalWidth = window.originalImageWidth;
        const originalHeight = window.originalImageHeight;

        if (!originalWidth) return;

        const newWidth = originalWidth * currentZoom;
        const newHeight = originalHeight * currentZoom;

        // 应用到原图
        const originalImg = document.getElementById('original-preview');
        if (originalImg) {
            originalImg.style.width = `${newWidth}px`;
            originalImg.style.height = `${newHeight}px`;
            originalImg.style.maxWidth = 'none';
            originalImg.style.maxHeight = 'none';
            originalImg.style.transform = 'none';
        }

        // 应用到结果图容器
        const canvasContainer = document.getElementById('fabricCanvasContainer');
        if (canvasContainer) {
            canvasContainer.style.width = `${newWidth}px`;
            canvasContainer.style.height = `${newHeight}px`;
            canvasContainer.style.maxWidth = 'none';
            canvasContainer.style.maxHeight = 'none';
            canvasContainer.style.transform = 'none';
            canvasContainer.style.transition = 'none'; // 🔑 强制禁用动画
        }

        // 还需要调整内部Fabric wrapper的大小
        const fabricWrapper = document.querySelector('.canvas-container');
        if (fabricWrapper) {
            fabricWrapper.style.width = `${newWidth}px`;
            fabricWrapper.style.height = `${newHeight}px`;
            fabricWrapper.style.maxWidth = 'none';
        }

        // 调整Canvas本身缩放 (Fabric方式)
        // 注意: 我们只调整容器大小来缩放显示，Canvas内部分辨率保持不变
        // 这样编辑时还是高分辨率，显示时则跟随容器
        // 但Fabric canvas是canvas元素，style.width会拉伸内容
        // 应该配合 setZoom?
        // 如果我们改变了 CSS width，画布会被拉伸。
        // 之前的 transform 也是拉伸。
        // 所以 style.width 拉伸是此时期望的行为 (视图缩放)。
        // 只要 fabricCanvas (canvas element) 的 style.width set 即可.
        const canvasEl = document.getElementById('fabricCanvas');
        if (canvasEl) {
            canvasEl.style.width = `${newWidth}px`;
            canvasEl.style.height = `${newHeight}px`;
            canvasEl.style.maxWidth = 'none';
            canvasEl.style.transition = 'none'; // 🔑 强制禁用动画
        }
    }

    const zoomInBtn = document.getElementById('zoomIn');
    if (zoomInBtn) {
        zoomInBtn.addEventListener('click', () => {
            if (currentZoom < MAX_ZOOM) {
                currentZoom += ZOOM_STEP;
                applyZoom();
            }
        });
    }

    const zoomOutBtn = document.getElementById('zoomOut');
    if (zoomOutBtn) {
        zoomOutBtn.addEventListener('click', () => {
            if (currentZoom > MIN_ZOOM) {
                currentZoom -= ZOOM_STEP;
                applyZoom();
            }
        });
    }

    // 定义适应屏幕函数
    function fitToScreen() {
        const container = document.querySelector('.image-wrapper');
        const imgWidth = window.originalImageWidth;
        const imgHeight = window.originalImageHeight;

        if (container && imgWidth && imgHeight) {
            // 减去padding
            const containerWidth = container.clientWidth - 40;
            const containerHeight = container.clientHeight - 40;

            if (containerWidth <= 0 || containerHeight <= 0) return;

            const scaleX = containerWidth / imgWidth;
            const scaleY = containerHeight / imgHeight;

            // 选择较小的缩放比例以完全容纳
            currentZoom = Math.min(scaleX, scaleY);

            // 确保不大于1 (可选，如果用户想看原图就不限制，但Fit通常是缩小)
            if (currentZoom > 1) currentZoom = 1;

            // 防止太小
            if (currentZoom < 0.01) currentZoom = 0.01;

            applyZoom();
        } else {
            // 默认
            currentZoom = 0.5;
            applyZoom();
        }
    }

    const zoomFitBtn = document.getElementById('zoomFit');
    if (zoomFitBtn) {
        zoomFitBtn.addEventListener('click', fitToScreen);
    }

    // 视图切换
    document.querySelectorAll('.view-tab').forEach(btn => {
        btn.addEventListener('click', function () {
            document.querySelectorAll('.view-tab').forEach(b => b.classList.remove('active'));
            this.classList.add('active');

            const viewType = this.dataset.view;
            const container = document.querySelector('.preview-container');

            if (viewType === 'overlay') {
                // 叠加模式
                container.style.display = 'block';
                container.style.position = 'relative';

                const panels = document.querySelectorAll('.image-panel');
                panels.forEach(panel => {
                    panel.style.width = '100%';
                    panel.style.height = '100%';
                    panel.style.position = 'absolute';
                    panel.style.top = '0';
                    panel.style.left = '0';
                });

                // 让结果面板在上面，设置半透明以便对比
                const resultPanel = document.querySelector('.result-panel');
                if (resultPanel) {
                    resultPanel.style.opacity = '0.9';
                    resultPanel.style.zIndex = '10';
                }
            } else {
                // 并排模式 (默认) - 修复：完全重置所有可能被叠加模式改变的样式
                container.style.display = 'grid';
                container.style.gridTemplateColumns = '1fr 1fr';
                container.style.position = 'static';

                const panels = document.querySelectorAll('.image-panel');
                panels.forEach(panel => {
                    panel.style.width = '';
                    panel.style.height = '';
                    panel.style.position = '';
                    panel.style.top = '';
                    panel.style.left = '';
                    panel.style.inset = '';
                    panel.style.opacity = '';
                    panel.style.zIndex = '';
                });

                // 重置图片和canvas容器的样式，防止溢出
                const originalPreview = document.getElementById('original-preview');
                const canvasContainer = document.getElementById('fabricCanvasContainer');

                if (originalPreview) {
                    originalPreview.style.width = '';
                    originalPreview.style.height = '';
                    originalPreview.style.maxWidth = '';
                    originalPreview.style.maxHeight = '';
                    originalPreview.style.transform = '';
                }

                if (canvasContainer) {
                    canvasContainer.style.width = '';
                    canvasContainer.style.height = '';
                    canvasContainer.style.maxWidth = '';
                    canvasContainer.style.maxHeight = '';
                    canvasContainer.style.transform = 'translate(-50%, -50%)';
                }
            }

            // 🔑 关键修复: 视图切换后重新适应画布尺寸
            setTimeout(() => {
                if (typeof fitToScreen === 'function') {
                    fitToScreen();
                } else {
                    const zoomFitBtn = document.getElementById('zoomFit');
                    if (zoomFitBtn) zoomFitBtn.click();
                }
            }, 100);
        });
    });

    // 🔑 注意：save-image 按钮的 onclick 已在 HTML 中绑定 downloadImage()
    // 此处不再重复绑定事件，避免双倍下载问题

    // 🔑 渲染模式切换 - 实时应用 sharpness 设置 (全局生效)
    const renderModeSelect = document.getElementById('text-render-mode');
    if (renderModeSelect) {
        renderModeSelect.addEventListener('change', function () {
            if (!canvas) return;

            const mode = this.value;
            // 更新画布上所有文本对象
            canvas.getObjects().forEach(obj => {
                if (obj.type === 'textbox') {
                    applyRenderModeToText(obj, mode);
                }
            });

            canvas.requestRenderAll();
        });
    }

}); // Close DOMContentLoaded

// ========== 同步到文件夹功能模块 ==========

// 同步路径配置（从 localStorage 加载）
const syncPaths = JSON.parse(localStorage.getItem('xobi_syncPaths') || '{}');

// 语言名称映射
const LANG_NAMES = {
    'en': '🇺🇸 英语',
    'th': '🇹🇭 泰语',
    'id': '🇮🇩 印尼语',
    'vi': '🇻🇳 越南语',
    'ru': '🇷🇺 俄语',
    'ja': '🇯🇵 日语',
    'ko': '🇰🇷 韩语',
    'zh': '🇨🇳 中文'
};

// 保存路径配置到 localStorage
function saveSyncPaths() {
    localStorage.setItem('xobi_syncPaths', JSON.stringify(syncPaths));
}

// 打开同步设置模态框
function openSyncModal() {
    const modal = document.getElementById('syncModal');
    if (modal) {
        modal.classList.add('show');
        renderSyncLangPaths();
    }
}

// 关闭同步设置模态框
function closeSyncModal() {
    const modal = document.getElementById('syncModal');
    if (modal) {
        modal.classList.remove('show');
    }
}

// 渲染语言路径配置列表
function renderSyncLangPaths() {
    const container = document.getElementById('sync-lang-paths');
    const emptyHint = document.getElementById('sync-empty-hint');

    if (!container) return;

    // 获取已翻译的语言列表
    const translatedLangs = appState.translations ? Object.keys(appState.translations) : [];

    if (translatedLangs.length === 0) {
        if (emptyHint) emptyHint.style.display = 'block';
        return;
    }

    if (emptyHint) emptyHint.style.display = 'none';

    // 清空容器（保留空提示元素）
    const rows = container.querySelectorAll('.sync-lang-row');
    rows.forEach(row => row.remove());

    // 为每种语言生成配置行
    translatedLangs.forEach(langCode => {
        const langName = LANG_NAMES[langCode] || langCode;
        const savedPath = syncPaths[langCode] || '';

        const row = document.createElement('div');
        row.className = 'sync-lang-row';
        row.innerHTML = `
            <div class="sync-lang-label">${langName}</div>
            <div class="sync-path-wrapper">
                <input type="text"
                    class="sync-path-input"
                    id="sync-path-${langCode}"
                    placeholder="例如: D:\\项目\\${langCode}"
                    value="${savedPath}"
                    data-lang="${langCode}">
                <button class="sync-folder-picker" onclick="selectFolder('${langCode}')" title="选择文件夹">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                    </svg>
                </button>
            </div>
            <button class="sync-btn" onclick="syncSingleLang('${langCode}', this)">同步</button>
        `;

        container.appendChild(row);

        // 绑定路径输入事件 - 自动保存和验证
        const input = row.querySelector('.sync-path-input');
        input.addEventListener('change', async function () {
            const path = this.value.trim();
            syncPaths[langCode] = path;
            saveSyncPaths();

            // 验证路径
            if (path) {
                const valid = await validatePath(path);
                this.classList.remove('valid', 'invalid');
                this.classList.add(valid ? 'valid' : 'invalid');
            } else {
                this.classList.remove('valid', 'invalid');
            }
        });
    });
}

// 🔑 调用原生对话框选择文件夹
async function selectFolder(langCode) {
    try {
        const response = await fetch('/api/select-folder', {
            method: 'POST'
        });
        const result = await response.json();

        if (result.success && result.path) {
            const input = document.getElementById(`sync-path-${langCode}`);
            if (input) {
                input.value = result.path;
                // 手动触发 change 事件以保存路径并验证
                input.dispatchEvent(new Event('change'));
            }
        } else if (result.error) {
            alert('选择文件夹出错: ' + result.error);
        }
    } catch (e) {
        console.error('选择文件夹失败:', e);
        alert('无法连接到后端服务，请确保已启动 Python 后端。');
    }
}

// 验证路径是否有效
async function validatePath(path) {
    try {
        const response = await fetch('/api/validate-path', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: path })
        });
        const result = await response.json();
        return result.valid === true;
    } catch (e) {
        console.error('验证路径失败:', e);
        return false;
    }
}

// 同步单个语言到指定文件夹
async function syncSingleLang(langCode, btnElement) {
    // 🔑 同步前先保存当前编辑状态
    syncCurrentCanvasToState();

    const pathInput = document.getElementById(`sync-path-${langCode}`);
    const targetPath = pathInput ? pathInput.value.trim() : '';

    if (!targetPath) {
        alert('请先输入目标文件夹路径');
        return;
    }

    // 获取该语言的翻译数据
    const langData = appState.translations ? appState.translations[langCode] : null;
    if (!langData || !langData.images) {
        alert('找不到该语言的翻译数据');
        return;
    }

    const doneImages = langData.images.filter(img => img.status === 'done' && img.result);
    if (doneImages.length === 0) {
        alert('该语言没有已完成的翻译');
        return;
    }

    // 更新按钮状态
    const originalText = btnElement.innerHTML;
    btnElement.innerHTML = '正在导出...';
    btnElement.classList.add('syncing');
    btnElement.disabled = true;

    let successCount = 0;
    let failCount = 0;

    try {
        console.log(`🚀 开始同步语言 [${langCode}] 到:`, targetPath);
        for (let i = 0; i < doneImages.length; i++) {
            const imgObj = doneImages[i];
            // 🔑 修复：正确获取原始文件名 (langData.images 中的对象包含 originalImg)
            const fileMeta = imgObj.originalImg ? imgObj.originalImg.file : imgObj.file;
            const originalFilename = fileMeta ? fileMeta.name : `image_${i + 1}.png`;

            // 更新显示进度
            btnElement.innerHTML = `同步中 ${i + 1}/${doneImages.length}`;
            showSyncStatus(`${LANG_NAMES[langCode] || langCode}: 正在同步 (${i + 1}/${doneImages.length}) - ${originalFilename}`);

            // 导出图片为 Base64
            const imageData = await exportImageForSync(imgObj);
            if (!imageData) {
                console.warn(`⚠️ 跳过图片 ${originalFilename}: 无法导出`);
                failCount++;
                continue;
            }

            // 调用后端 API 同步文件
            try {
                const response = await fetch('/api/sync-to-folder', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        target_path: targetPath,
                        filename: originalFilename,
                        image_data: imageData
                    })
                });

                const result = await response.json();
                if (result.success) {
                    successCount++;
                    console.log(`✅ 同步成功: ${originalFilename}`);
                } else {
                    failCount++;
                    console.error(`❌ 后端报错: ${originalFilename} - ${result.error}`);
                }
            } catch (e) {
                failCount++;
                console.error(`❌ 请求失败: ${originalFilename}`, e);
            }

            // 毫秒级微小延迟，释放主线程保持 UI 响应
            await new Promise(r => setTimeout(r, 50));
        }

        // 显示最终结果
        if (failCount === 0) {
            btnElement.innerHTML = '✓ 已完成';
            btnElement.classList.add('success');
            pathInput.classList.add('valid');
        } else {
            btnElement.innerHTML = `${successCount}/${doneImages.length}`;
            btnElement.classList.add('error');
        }

        showSyncStatus(`${LANG_NAMES[langCode] || langCode}: 同步结束，成功 ${successCount} 张，失败 ${failCount} 张`, failCount > 0);

        // 🔑 同步成功后保存历史
        console.log('✅ 单语言同步成功，准备保存到同步历史');
        saveCurrentToHistory();

    } catch (e) {
        console.error('🔥 同步过程崩溃:', e);
        btnElement.innerHTML = '同步失败';
        btnElement.classList.add('error');
        showSyncStatus(`严重错误: ${e.message}`, true);
    } finally {
        btnElement.classList.remove('syncing');
        btnElement.disabled = false;

        // 3秒后尝试恢复状态，但不强制恢复文本，保留成功/失败显示
        setTimeout(() => {
            if (btnElement.innerHTML === '✓ 已完成' || btnElement.classList.contains('error')) {
                // 暂时保持状态
            } else {
                btnElement.innerHTML = '同步';
                btnElement.classList.remove('success', 'error');
            }
        }, 3000);
    }
}

// 一键同步全部语言 (直接同步，不创建历史记录)
async function syncAllToFolders() {
    // 🔑 同步前先保存当前编辑状态
    syncCurrentCanvasToState();

    const syncAllBtn = document.getElementById('sync-all-btn') || document.getElementById('quick-sync-all-btn');
    if (!syncAllBtn) return;

    // 收集所有有效路径的语言
    const langPaths = {};
    const translatedLangs = appState.translations ? Object.keys(appState.translations) : [];

    for (const langCode of translatedLangs) {
        const path = syncPaths[langCode];
        if (path && path.trim()) {
            langPaths[langCode] = path.trim();
        }
    }

    if (Object.keys(langPaths).length === 0) {
        alert('请至少配置一个语言的目标路径');
        return;
    }

    // 更新按钮状态
    const originalText = syncAllBtn.innerHTML;
    syncAllBtn.innerHTML = '🚀 同步中...';
    syncAllBtn.disabled = true;
    syncAllBtn.classList.add('syncing');

    let totalSuccess = 0;
    let totalFail = 0;

    try {
        console.log('🚀 开始直接同步到文件夹...');
        showSyncStatus('正在同步翻译图片到目标文件夹...');

        // 直接同步每种语言的图片
        for (const langCode of Object.keys(langPaths)) {
            const targetPath = langPaths[langCode];
            const langData = appState.translations[langCode];
            if (!langData || !langData.images) continue;

            const doneImages = langData.images.filter(img => img.status === 'done' && img.result);

            for (let i = 0; i < doneImages.length; i++) {
                const imgObj = doneImages[i];
                const fileMeta = imgObj.originalImg ? imgObj.originalImg.file : imgObj.file;
                const filename = fileMeta ? fileMeta.name : `image_${i + 1}.png`;

                syncAllBtn.innerHTML = `📤 ${langCode} (${i + 1}/${doneImages.length})`;
                showSyncStatus(`同步 [${LANG_NAMES[langCode] || langCode}]: ${filename}`);

                try {
                    const imageData = await exportImageForSync(imgObj);
                    if (imageData) {
                        const response = await fetch('/api/sync-to-folder', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                target_path: targetPath,
                                filename: filename,
                                image_data: imageData
                            })
                        });

                        const result = await response.json();
                        if (result.success) {
                            totalSuccess++;
                        } else {
                            totalFail++;
                            console.error(`同步失败 ${filename}:`, result.error);
                        }
                    }
                } catch (e) {
                    totalFail++;
                    console.error(`同步出错 ${filename}:`, e);
                }

                await new Promise(r => setTimeout(r, 20));
            }
        }

        const msg = `✅ 同步完成！成功 ${totalSuccess} 张，失败 ${totalFail} 张`;
        showSyncStatus(msg, totalFail > 0);
        // alert(msg);

        // 🔑 同步成功后保存历史
        console.log('✅ 文件夹同步成功，准备保存到同步历史');
        saveCurrentToHistory();

        syncAllBtn.innerHTML = '✓ 完成';
        syncAllBtn.classList.add('success');

    } catch (e) {
        console.error('🔥 同步过程出错:', e);
        showSyncStatus(`同步失败: ${e.message}`, true);
        alert('同步失败: ' + e.message);
        syncAllBtn.innerHTML = '❌ 失败';
        syncAllBtn.classList.add('error');
    } finally {
        setTimeout(() => {
            syncAllBtn.innerHTML = originalText;
            syncAllBtn.disabled = false;
            syncAllBtn.classList.remove('syncing', 'success', 'error');
        }, 3000);
    }
}

// 导出图片为 Base64 (用于同步功能) - 使用 Fabric.js 确保与预览一致
async function exportImageForSync(imgObj) {
    const fileMeta = imgObj.originalImg ? imgObj.originalImg.file : imgObj.file;
    const fileName = fileMeta ? fileMeta.name : 'Unknown';
    console.log('🖼️ 开始导出图片用于同步:', fileName);

    return new Promise((resolve) => {
        // 设置 15 秒超时
        const timeout = setTimeout(() => {
            console.error(`⌛ 导出图片超时 (15s): ${fileName}`);
            resolve(null);
        }, 15000);

        if (!imgObj.result || !imgObj.result.success) {
            console.warn('⚠️ 图片未完成或失败，跳过');
            clearTimeout(timeout);
            resolve(null);
            return;
        }

        const data = imgObj.result;

        // 🚀 方法1：如果当前画布正在显示这张图，直接导出（最快最准）
        if (appState.currentLang && appState.translations[appState.currentLang]) {
            const currentLangImages = appState.translations[appState.currentLang].images;
            const currentImgObj = currentLangImages[appState.currentIndex];
            if (currentImgObj === imgObj && canvas) {
                try {
                    console.log('🚀 使用活跃画布直接导出');
                    const dataURL = canvas.toDataURL({ format: 'png', quality: 1, multiplier: 1 });
                    clearTimeout(timeout);
                    resolve(dataURL);
                    return;
                } catch (e) {
                    console.warn('活跃画布导出失败，回退:', e);
                }
            }
        }

        // 🎨 方法2：使用 Fabric.js StaticCanvas 精确还原
        const bgImageUrl = data.inpainted_url;
        if (!bgImageUrl) {
            console.warn('⚠️ 无背景图 URL，跳过');
            clearTimeout(timeout);
            resolve(null);
            return;
        }

        console.log('🔗 使用 Fabric.js StaticCanvas 渲染:', fileName);

        // 加载背景图
        const bgImg = new Image();
        bgImg.crossOrigin = 'anonymous';
        bgImg.src = bgImageUrl;

        bgImg.onload = function () {
            try {
                const imgWidth = bgImg.width;
                const imgHeight = bgImg.height;

                // 创建离屏 canvas 元素
                const tempCanvasElem = document.createElement('canvas');
                tempCanvasElem.width = imgWidth;
                tempCanvasElem.height = imgHeight;

                // 初始化 Fabric.js StaticCanvas
                const tempCanvas = new fabric.StaticCanvas(tempCanvasElem, {
                    width: imgWidth,
                    height: imgHeight,
                    renderOnAddRemove: false
                });

                // 确保 viewportTransform 已初始化
                if (!tempCanvas.viewportTransform) {
                    tempCanvas.viewportTransform = [1, 0, 0, 1, 0, 0];
                }

                // 设置背景图
                const fabricBgImg = new fabric.Image(bgImg, {
                    originX: 'left',
                    originY: 'top',
                    scaleX: 1,
                    scaleY: 1
                });

                tempCanvas.setBackgroundImage(fabricBgImg, function () {
                    // 如果有 canvasData，手动重建对象（比 enlivenObjects 更可靠）
                    if (imgObj.canvasData && imgObj.canvasData.objects && imgObj.canvasData.objects.length > 0) {
                        console.log('🎨 从 canvasData 加载 ' + imgObj.canvasData.objects.length + ' 个对象');

                        // 手动创建每个对象
                        imgObj.canvasData.objects.forEach(objData => {
                            try {
                                let fabricObj = null;

                                if (objData.type === 'textbox' || objData.type === 'i-text' || objData.type === 'text') {
                                    // 🔑 关键修复：使用 !== undefined 防止颜色丢失
                                    const fillColor = objData.fill !== undefined ? objData.fill : '#000000';
                                    const strokeColor = objData.stroke !== undefined ? objData.stroke : null;
                                    const strokeWidthVal = objData.strokeWidth !== undefined ? objData.strokeWidth : 0;

                                    // 创建文本对象
                                    fabricObj = new fabric.Textbox(objData.text || '', {
                                        left: objData.left || 0,
                                        top: objData.top || 0,
                                        width: objData.width || 200,
                                        fontSize: objData.fontSize || 16,
                                        fontFamily: objData.fontFamily || 'Arial',
                                        fontWeight: objData.fontWeight || 'normal',
                                        fontStyle: objData.fontStyle || 'normal',
                                        fill: fillColor,
                                        stroke: strokeColor,
                                        strokeWidth: strokeWidthVal,
                                        paintFirst: objData.paintFirst || 'fill',
                                        textAlign: objData.textAlign || 'left',
                                        lineHeight: objData.lineHeight || 1.16,
                                        charSpacing: objData.charSpacing || 0,
                                        scaleX: objData.scaleX || 1,
                                        scaleY: objData.scaleY || 1,
                                        angle: objData.angle || 0,
                                        // 矩形特有属性
                                        rx: objData.rx || 0,
                                        ry: objData.ry || 0,
                                        isUserRect: objData.isUserRect || false,
                                        _originalRx: objData._originalRx || 0,
                                        _originalRy: objData._originalRy || 0,
                                        path: objData.path || undefined // 🖌️ 画笔路径数据
                                    });
                                    console.log(`  导出文本: fill=${fillColor}, stroke=${strokeColor}, strokeWidth=${strokeWidthVal}, paintFirst=${objData.paintFirst || 'fill'}`);
                                } else if (objData.type === 'rect') {
                                    // 🔑 矩形也使用显式检查
                                    const fillColor = objData.fill !== undefined ? objData.fill : '#000000';
                                    const strokeColor = objData.stroke !== undefined ? objData.stroke : null;
                                    const strokeWidthVal = objData.strokeWidth !== undefined ? objData.strokeWidth : 0;

                                    // 创建矩形对象
                                    fabricObj = new fabric.Rect({
                                        left: objData.left || 0,
                                        top: objData.top || 0,
                                        width: objData.width || 100,
                                        height: objData.height || 50,
                                        fill: fillColor,
                                        stroke: strokeColor,
                                        strokeWidth: strokeWidthVal,
                                        rx: objData.rx || 0,
                                        ry: objData.ry || 0,
                                        scaleX: objData.scaleX || 1,
                                        scaleY: objData.scaleY || 1,
                                        angle: objData.angle || 0,
                                        isUserRect: objData.isUserRect || false,
                                        _originalRx: objData._originalRx || 0,
                                        _originalRy: objData._originalRy || 0
                                    });
                                } else if (objData.type === 'path') { // 🖌️ 画笔路径
                                    fabricObj = new fabric.Path(objData.path, objData);
                                }

                                if (fabricObj) {
                                    tempCanvas.add(fabricObj);
                                }
                            } catch (objErr) {
                                console.warn('创建对象失败:', objErr, objData.type);
                            }
                        });

                        tempCanvas.renderAll();

                        try {
                            const dataURL = tempCanvas.toDataURL({ format: 'png', quality: 1 });
                            console.log('✅ Fabric.js 导出成功:', fileName);
                            tempCanvas.dispose();
                            clearTimeout(timeout);
                            resolve(dataURL);
                        } catch (exportErr) {
                            console.error('导出失败:', exportErr);
                            tempCanvas.dispose();
                            clearTimeout(timeout);
                            resolve(null);
                        }
                    } else {
                        // 没有 canvasData，使用后端数据创建文本
                        console.log('📝 使用后端数据绘制文本');

                        if (data.text_positions && data.translations) {
                            data.text_positions.forEach((position, idx) => {
                                const translatedText = data.translations[idx];
                                if (!translatedText) return;

                                try {
                                    const box = position.box || position;
                                    if (!box || !Array.isArray(box)) return;

                                    const minX = Math.min(...box.map(p => p[0]));
                                    const minY = Math.min(...box.map(p => p[1]));
                                    const maxX = Math.max(...box.map(p => p[0]));
                                    const maxY = Math.max(...box.map(p => p[1]));
                                    const boxWidth = maxX - minX;
                                    const boxHeight = maxY - minY;

                                    const style = data.styles ? data.styles[idx] : {};
                                    let fontSize = style.font_size || Math.max(12, boxHeight * 0.7);
                                    const textColor = style.color ?
                                        `rgb(${style.color[0]},${style.color[1]},${style.color[2]})` : '#000000';

                                    const textObj = new fabric.Textbox(translatedText, {
                                        left: minX,
                                        top: minY,
                                        width: boxWidth,
                                        fontSize: fontSize,
                                        fill: textColor,
                                        fontFamily: 'Arial, sans-serif',
                                        textAlign: style.align || 'left'
                                    });
                                    tempCanvas.add(textObj);
                                } catch (e) {
                                    console.error('绘制文本失败:', e);
                                }
                            });
                        }

                        tempCanvas.renderAll();

                        try {
                            const dataURL = tempCanvas.toDataURL({ format: 'png', quality: 1 });
                            console.log('✅ Fabric.js 导出成功 (后端数据):', fileName);
                            tempCanvas.dispose();
                            clearTimeout(timeout);
                            resolve(dataURL);
                        } catch (exportErr) {
                            console.error('导出失败:', exportErr);
                            tempCanvas.dispose();
                            clearTimeout(timeout);
                            resolve(null);
                        }
                    }
                }, { crossOrigin: 'anonymous' });

            } catch (err) {
                console.error('Fabric.js StaticCanvas 渲染失败:', err);
                clearTimeout(timeout);
                resolve(null);
            }
        };

        bgImg.onerror = () => {
            console.error('加载背景图失败:', bgImageUrl);
            clearTimeout(timeout);
            resolve(null);
        };
    });
}

// 显示同步状态
function showSyncStatus(message, isError = false) {
    const status = document.getElementById('sync-status');
    if (status) {
        status.textContent = message;
        status.className = 'sync-status' + (isError ? ' error' : '');
        status.style.display = 'block';

        // 5秒后自动隐藏
        setTimeout(() => {
            status.style.display = 'none';
        }, 5000);
    }
}

// ========== 历史记录功能 ==========

// 切换历史记录面板显示
function toggleHistoryPanel() {
    const panel = document.getElementById('sync-history-panel');
    if (!panel) return;

    if (panel.style.display === 'none') {
        panel.style.display = 'block';
        loadSyncHistory();
    } else {
        panel.style.display = 'none';
    }
}

// 加载同步历史记录
async function loadSyncHistory() {
    const listContainer = document.getElementById('sync-history-list');
    if (!listContainer) return;

    listContainer.innerHTML = '<div class="sync-history-empty">加载中...</div>';

    try {
        const response = await fetch('/api/list-sync-history');
        const result = await response.json();

        if (!result.success || !result.history || result.history.length === 0) {
            listContainer.innerHTML = '<div class="sync-history-empty">暂无历史记录</div>';
            return;
        }

        listContainer.innerHTML = '';

        for (const item of result.history) {
            const langInfo = Object.entries(item.langs || {})
                .map(([code, count]) => `${LANG_NAMES[code] || code}: ${count}张`)
                .join(', ');

            const div = document.createElement('div');
            div.className = 'sync-history-item';
            div.innerHTML = `
                <div class="sync-history-info">
                    <div class="sync-history-name">${item.name}</div>
                    <div class="sync-history-meta">${langInfo} | ${item.sizeMB}MB</div>
                </div>
                <div class="sync-history-actions">
                    <button title="打开文件夹" onclick="openSyncFolder('${item.path.replace(/\\/g, '\\\\')}')">📁</button>
                    <button class="delete" title="删除" onclick="deleteSyncHistory('${item.name}')">🗑️</button>
                </div>
            `;
            listContainer.appendChild(div);
        }
    } catch (e) {
        console.error('加载历史记录失败:', e);
        listContainer.innerHTML = '<div class="sync-history-empty">加载失败</div>';
    }
}

// 删除同步历史记录
async function deleteSyncHistory(name) {
    if (!confirm(`确定要删除 "${name}" 吗？`)) return;

    try {
        const response = await fetch('/api/delete-sync-history', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name })
        });

        const result = await response.json();
        if (result.success) {
            loadSyncHistory(); // 刷新列表
        } else {
            alert('删除失败: ' + (result.error || '未知错误'));
        }
    } catch (e) {
        console.error('删除历史记录失败:', e);
        alert('删除失败');
    }
}

// 在资源管理器中打开文件夹
async function openSyncFolder(path) {
    try {
        await fetch('/api/open-folder', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path })
        });
    } catch (e) {
        console.error('打开文件夹失败:', e);
    }
}

// 绑定同步模态框事件
document.addEventListener('DOMContentLoaded', function () {
    // 打开同步设置按钮
    const syncSettingsBtn = document.getElementById('sync-settings-btn');
    if (syncSettingsBtn) {
        syncSettingsBtn.addEventListener('click', openSyncModal);
    }

    // 关闭同步设置按钮
    const syncCloseBtn = document.getElementById('sync-close');
    if (syncCloseBtn) {
        syncCloseBtn.addEventListener('click', closeSyncModal);
    }

    // 点击模态框背景关闭
    const syncModal = document.getElementById('syncModal');
    if (syncModal) {
        syncModal.addEventListener('click', function (e) {
            if (e.target === syncModal) {
                closeSyncModal();
            }
        });
    }

    // 一键同步全部按钮
    const syncAllBtn = document.getElementById('sync-all-btn');
    if (syncAllBtn) {
        syncAllBtn.addEventListener('click', syncAllToFolders);
    }
});

// ========== 矩形工具功能 ==========

// 添加矩形到画布
function addRectangleToCanvas() {
    if (!canvas) {
        alert('请先上传并翻译图片');
        return;
    }

    const canvasWidth = canvas.getWidth();
    const canvasHeight = canvas.getHeight();

    // 创建矩形，默认放在画布中心
    const rect = new fabric.Rect({
        left: canvasWidth / 2 - 100,
        top: canvasHeight / 2 - 50,
        width: 200,
        height: 100,
        fill: '#000000',
        stroke: '#ffffff',
        strokeWidth: 0,
        rx: 0,
        ry: 0,
        selectable: true,
        hasControls: true,
        hasBorders: true,
        // 标记为用户添加的矩形
        isUserRect: true,
        // 🔑 禁止非均匀缩放，保持圆角比例
        lockUniScaling: false,
        // 🔑 存储原始圆角值，用于缩放时保持一致
        _originalRx: 0,
        _originalRy: 0
    });

    // 🔑 监听缩放事件，保持圆角不变形
    rect.on('scaling', function () {
        // 保持 rx/ry 不随缩放变化
        const originalRx = this._originalRx || 0;
        const originalRy = this._originalRy || 0;
        this.set('rx', originalRx);
        this.set('ry', originalRy);
    });

    // 🔑 缩放结束后，将缩放应用到宽高，并重置缩放比例
    rect.on('modified', function () {
        if (this.scaleX !== 1 || this.scaleY !== 1) {
            const newWidth = this.width * this.scaleX;
            const newHeight = this.height * this.scaleY;
            this.set({
                width: newWidth,
                height: newHeight,
                scaleX: 1,
                scaleY: 1
            });
            this.setCoords();
        }
    });

    // 🔑 临时禁用自动渲染，防止闪烁
    const originalRenderOnAddRemove = canvas.renderOnAddRemove;
    canvas.renderOnAddRemove = false;

    canvas.add(rect);

    // 🔑 将矩形置于底层（背景之上，文字之下）
    canvas.sendToBack(rect);

    // 🔑 恢复自动渲染
    canvas.renderOnAddRemove = originalRenderOnAddRemove;

    // 🔑 使用 requestAnimationFrame 确保平滑渲染
    requestAnimationFrame(() => {
        canvas.setActiveObject(rect);
        canvas.renderAll();

        // 保存状态（异步执行避免阻塞）
        setTimeout(() => {
            if (history && typeof history.saveState === 'function') {
                history.saveState();
            }
        }, 0);
    });

    console.log('✅ 添加矩形到画布（置于文字底层）');
}

// 显示/隐藏矩形属性面板
function showRectPropertiesPanel(show, rect = null) {
    const workflowSteps = document.getElementById('workflow-steps');
    const rectPanel = document.getElementById('rect-properties-panel');

    if (show && rect) {
        // 隐藏步骤，显示矩形面板
        if (workflowSteps) workflowSteps.style.display = 'none';
        if (rectPanel) {
            rectPanel.style.display = 'flex';
            // 更新控件值
            document.getElementById('rect-fill-color').value = rect.fill || '#000000';
            document.getElementById('rect-stroke-color').value = rect.stroke || '#ffffff';
            document.getElementById('rect-stroke-width').value = rect.strokeWidth || 0;
            document.getElementById('rect-stroke-width-val').textContent = rect.strokeWidth || 0;
            document.getElementById('rect-corner-radius').value = rect.rx || 0;
            document.getElementById('rect-corner-radius-val').textContent = rect.rx || 0;
        }
    } else {
        // 显示步骤，隐藏矩形面板
        if (workflowSteps) workflowSteps.style.display = 'flex';
        if (rectPanel) rectPanel.style.display = 'none';
    }
}

// 更新选中矩形的填充色
function updateSelectedRectFill(e) {
    const activeObj = canvas?.getActiveObject();
    if (activeObj && activeObj.type === 'rect') {
        activeObj.set('fill', e.target.value);
        canvas.renderAll();
    }
}

// 更新选中矩形的描边色
function updateSelectedRectStroke(e) {
    const activeObj = canvas?.getActiveObject();
    if (activeObj && activeObj.type === 'rect') {
        activeObj.set('stroke', e.target.value);
        canvas.renderAll();
    }
}

// 更新选中矩形的描边宽度
function updateSelectedRectStrokeWidth(e) {
    const val = parseInt(e.target.value);
    document.getElementById('rect-stroke-width-val').textContent = val;
    const activeObj = canvas?.getActiveObject();
    if (activeObj && activeObj.type === 'rect') {
        activeObj.set('strokeWidth', val);
        canvas.renderAll();
    }
}

// 更新选中矩形的圆角
function updateSelectedRectCornerRadius(e) {
    const val = parseInt(e.target.value);
    document.getElementById('rect-corner-radius-val').textContent = val;
    const activeObj = canvas?.getActiveObject();
    if (activeObj && activeObj.type === 'rect') {
        activeObj.set('rx', val);
        activeObj.set('ry', val);
        // 🔑 同时保存原始值，用于缩放时保持一致
        activeObj._originalRx = val;
        activeObj._originalRy = val;
        canvas.renderAll();
    }
}

// 🔑 设置当前活动的工作流步骤 (1, 2, 3)
function setActiveStep(stepNum) {
    const steps = document.querySelectorAll('.workflow-steps .step');
    steps.forEach((step, index) => {
        if (index + 1 === stepNum) {
            step.classList.add('active');
        } else {
            step.classList.remove('active');
        }
    });
}

// 监听画布选择事件以显示/隐藏矩形面板
function setupRectSelectionListener() {
    if (!canvas) return;

    canvas.on('selection:created', function (e) {
        const obj = e.selected?.[0];
        if (obj && obj.type === 'rect') {
            showRectPropertiesPanel(true, obj);
        } else {
            showRectPropertiesPanel(false);
        }
    });

    canvas.on('selection:updated', function (e) {
        const obj = e.selected?.[0];
        if (obj && obj.type === 'rect') {
            showRectPropertiesPanel(true, obj);
        } else {
            showRectPropertiesPanel(false);
        }
    });

    canvas.on('selection:cleared', function () {
        showRectPropertiesPanel(false);
    });

    console.log('✅ 矩形选择监听器已设置');
}

// ========== 快捷同步功能 (右侧面板) ==========

// 显示快捷同步按钮（翻译完成后调用）
function showQuickSyncSection() {
    const section = document.getElementById('quick-sync-section');
    if (section) {
        section.style.display = 'block';
    }
}

// 快捷一键同步 (复用 syncAllToFolders)
async function quickSyncAll() {
    const quickBtn = document.getElementById('quick-sync-all-btn');
    if (!quickBtn) return;

    // 检查是否有配置路径
    const translatedLangs = appState.translations ? Object.keys(appState.translations) : [];
    let hasAnyPath = false;
    for (const langCode of translatedLangs) {
        if (syncPaths[langCode] && syncPaths[langCode].trim()) {
            hasAnyPath = true;
            break;
        }
    }

    if (!hasAnyPath) {
        // 没有配置路径，打开同步设置弹窗
        const modal = document.getElementById('syncModal');
        if (modal) {
            modal.classList.add('active');
            renderSyncPathInputs();
        }
        alert('请先配置同步路径！');
        return;
    }

    // 有路径，直接调用同步
    await syncAllToFolders();

    // 刷新快捷历史
    loadQuickHistory();
}

// 加载快捷历史记录
async function loadQuickHistory() {
    const listContainer = document.getElementById('quick-history-list');
    if (!listContainer) return;

    listContainer.innerHTML = '<div style="font-size: 11px; color: var(--text-muted); text-align: center;">加载中...</div>';

    try {
        const response = await fetch('/api/list-sync-history');
        const result = await response.json();

        if (!result.success || !result.history || result.history.length === 0) {
            listContainer.innerHTML = '<div style="font-size: 11px; color: var(--text-muted); text-align: center;">暂无历史记录</div>';
            return;
        }

        listContainer.innerHTML = '';

        // 只显示最近5条
        const recentHistory = result.history.slice(0, 5);

        for (const item of recentHistory) {
            const langCount = Object.keys(item.langs || {}).length;
            const totalImages = Object.values(item.langs || {}).reduce((a, b) => a + b, 0);

            const div = document.createElement('div');
            div.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding: 4px 0; border-bottom: 1px solid rgba(255,255,255,0.05); font-size: 11px;';
            div.innerHTML = `
                <div style="flex: 1; min-width: 0;">
                    <div style="color: var(--text-secondary);">${item.name}</div>
                    <div style="color: var(--text-muted); font-size: 10px;">${langCount}种语言, ${totalImages}张图</div>
                </div>
                <div style="display: flex; gap: 3px; flex-shrink: 0;">
                    <button class="style-btn" title="打开文件夹" style="padding: 2px 6px; font-size: 10px;" onclick="openSyncFolder('${item.path.replace(/\\/g, '\\\\')}')">📁</button>
                    <button class="style-btn danger" title="删除" style="padding: 2px 6px; font-size: 10px;" onclick="deleteSyncHistory('${item.name}'); loadQuickHistory();">🗑️</button>
                </div>
            `;
            listContainer.appendChild(div);
        }
    } catch (e) {
        console.error('加载快捷历史失败:', e);
        listContainer.innerHTML = '<div style="font-size: 11px; color: var(--text-muted); text-align: center;">加载失败</div>';
    }
}

// 一键清除所有历史记录
async function clearAllSyncHistory() {
    if (!confirm('确定要删除所有同步历史记录吗？此操作不可恢复！')) return;

    try {
        const response = await fetch('/api/list-sync-history');
        const result = await response.json();

        if (!result.success || !result.history) {
            alert('没有历史记录可删除');
            return;
        }

        let deleted = 0;
        for (const item of result.history) {
            try {
                await fetch('/api/delete-sync-history', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: item.name })
                });
                deleted++;
            } catch (e) {
                console.error('删除失败:', item.name, e);
            }
        }

        alert(`已清除 ${deleted} 条历史记录！`);
        loadQuickHistory();
        loadSyncHistory(); // 同时刷新弹窗里的历史

    } catch (e) {
        console.error('清除历史失败:', e);
        alert('清除失败: ' + e.message);
    }
}

// 🔑 从历史记录恢复到画布
async function restoreFromHistory(historyName) {
    if (!confirm(`确定要恢复历史记录 "${historyName}" 吗？\n\n当前画布内容将被替换。`)) {
        return;
    }

    console.log('📂 正在恢复历史记录:', historyName);

    try {
        const response = await fetch('/api/get-history-images', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: historyName })
        });

        const result = await response.json();

        if (!result.success) {
            alert('恢复失败: ' + (result.error || '未知错误'));
            return;
        }

        const historyImages = result.images; // {langCode: [{filename, imageData}, ...]}

        if (!historyImages || Object.keys(historyImages).length === 0) {
            alert('该历史记录中没有图片');
            return;
        }

        // 清空当前状态
        appState.images = [];
        appState.currentIndex = -1;
        appState.translations = {};

        // 🔑 记录当前正在编辑的历史记录名称
        appState.currentHistoryName = historyName;

        // 获取所有语言
        const langCodes = Object.keys(historyImages);
        const firstLang = langCodes[0];
        const firstLangImages = historyImages[firstLang];

        // 初始化翻译状态
        for (const langCode of langCodes) {
            const langName = LANG_NAMES[langCode] || langCode;
            appState.translations[langCode] = {
                name: langName,
                status: 'done',
                images: []
            };
        }

        // 对于每张图片，创建图片对象
        for (let i = 0; i < firstLangImages.length; i++) {
            const img = firstLangImages[i];

            // 创建原始图片对象（用filename作为标识）
            const imgObj = {
                id: Date.now() + i,
                file: { name: img.filename },
                url: img.imageData, // 使用历史图片作为预览
                status: 'done',
                result: { success: true }
            };

            appState.images.push(imgObj);

            // 为每种语言创建翻译图片记录
            for (const langCode of langCodes) {
                const langImages = historyImages[langCode];
                const langImg = langImages.find(li => li.filename === img.filename) || langImages[i];

                if (langImg) {
                    const translationItem = {
                        originalImg: imgObj,
                        file: { name: img.filename },
                        status: 'done',
                        result: {
                            success: true,
                            restored_url: langImg.imageData
                        }
                    };

                    appState.translations[langCode].images.push(translationItem);
                }
            }
        }

        // 更新UI
        appState.currentIndex = 0;
        appState.selectedLang = firstLang;

        renderThumbnails();
        renderLangTabs(langCodes.map(code => ({ code, name: LANG_NAMES[code] || code })));
        renderDownloadButtons();
        showQuickSyncSection();

        // 🔑 加载第一张图片到画布
        if (appState.translations[firstLang] && appState.translations[firstLang].images[0]) {
            const firstImgObj = appState.translations[firstLang].images[0];
            loadRestoredImageToCanvas(firstImgObj.result.restored_url);
        }

        // 刷新历史列表
        loadQuickHistory();

        alert(`✅ 已恢复历史记录 "${historyName}"\n共 ${langCodes.length} 种语言, ${firstLangImages.length} 张图片`);

    } catch (e) {
        console.error('恢复历史记录失败:', e);
        alert('恢复失败: ' + e.message);
    }
}

// 🔑 将恢复的图片加载到画布（仅图片，无编辑状态）
function loadRestoredImageToCanvas(imageDataUrl) {
    if (!canvas || !imageDataUrl) return;

    canvas.clear();

    fabric.Image.fromURL(imageDataUrl, function (img) {
        if (!img) {
            console.error('加载恢复的图片失败');
            return;
        }

        const canvasWidth = canvas.getWidth();
        const canvasHeight = canvas.getHeight();

        // 计算缩放
        const scaleX = canvasWidth / img.width;
        const scaleY = canvasHeight / img.height;
        const scale = Math.min(scaleX, scaleY, 1);

        img.set({
            left: (canvasWidth - img.width * scale) / 2,
            top: (canvasHeight - img.height * scale) / 2,
            scaleX: scale,
            scaleY: scale,
            selectable: false,
            evented: false
        });

        canvas.setBackgroundImage(img, canvas.renderAll.bind(canvas));
        console.log('✅ 恢复的图片已加载到画布');
    }, { crossOrigin: 'anonymous' });
}

// 🔑 加载完整的canvas状态（包括文字对象、样式等）
function loadRestoredCanvasState(canvasData, fallbackImageUrl) {
    if (!canvas) return;

    canvas.clear();

    try {
        console.log('📋 开始恢复canvas状态...');

        // 🔑 先加载背景图片（使用保存的历史图片，而不是可能失效的临时URL）
        fabric.Image.fromURL(fallbackImageUrl, function (bgImg) {
            if (bgImg) {
                const canvasWidth = canvas.getWidth();
                const canvasHeight = canvas.getHeight();
                const scaleX = canvasWidth / bgImg.width;
                const scaleY = canvasHeight / bgImg.height;
                const scale = Math.min(scaleX, scaleY, 1);

                bgImg.set({
                    left: 0,
                    top: 0,
                    scaleX: scale,
                    scaleY: scale,
                    selectable: false,
                    evented: false
                });

                canvas.setBackgroundImage(bgImg, function () {
                    // 背景图片加载完成后，加载文字对象
                    if (canvasData && canvasData.objects && canvasData.objects.length > 0) {
                        fabric.util.enlivenObjects(canvasData.objects, function (objects) {
                            objects.forEach(function (obj) {
                                canvas.add(obj);
                            });
                            canvas.renderAll();
                            console.log(`✅ 已恢复 ${objects.length} 个编辑对象`);
                        });
                    } else {
                        canvas.renderAll();
                        console.log('✅ 背景图片已加载（无编辑对象）');
                    }
                });
            } else {
                console.error('加载背景图片失败');
                // 尝试直接加载canvasData
                canvas.loadFromJSON(canvasData, function () {
                    canvas.renderAll();
                    console.log('✅ 已恢复完整的canvas编辑状态（直接加载）');
                });
            }
        }, { crossOrigin: 'anonymous' });

    } catch (e) {
        console.error('加载canvas状态失败，回退到图片模式:', e);
        if (fallbackImageUrl) {
            loadRestoredImageToCanvas(fallbackImageUrl);
        }
    }
}

// 🔑 修改自动保存函数，支持覆盖现有历史记录，保存canvas状态
async function saveCurrentToHistory() {
    if (!appState.translations || Object.keys(appState.translations).length === 0) {
        console.log('没有翻译内容可保存');
        return;
    }

    const allImages = [];
    const langCodes = Object.keys(appState.translations);

    for (const langCode of langCodes) {
        const langData = appState.translations[langCode];
        if (!langData || !langData.images) continue;

        const doneImages = langData.images.filter(img => img.status === 'done');

        for (let i = 0; i < doneImages.length; i++) {
            const imgObj = doneImages[i];
            const fileMeta = imgObj.originalImg ? imgObj.originalImg.file : imgObj.file;
            const filename = fileMeta ? fileMeta.name : `image_${i + 1}.png`;

            try {
                const imageData = await exportImageOffscreen(imgObj);
                if (imageData) {
                    allImages.push({
                        langCode: langCode,
                        filename: filename,
                        imageData: imageData
                    });
                }
            } catch (e) {
                console.warn('导出图片失败:', filename, e);
            }
        }
    }

    if (allImages.length === 0) {
        console.log('没有图片需要保存');
        return;
    }

    // 🔑 如果正在编辑历史记录，覆盖它
    if (appState.currentHistoryName) {
        console.log('📝 覆盖现有历史记录:', appState.currentHistoryName);

        const response = await fetch('/api/update-history', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: appState.currentHistoryName,
                images: allImages
            })
        });

        const result = await response.json();
        if (result.success) {
            console.log('✅ 历史记录已更新:', appState.currentHistoryName);
        } else {
            console.warn('更新历史记录失败:', result.error);
        }
    } else {
        // 新建历史记录
        const response = await fetch('/api/export-to-cache', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ images: allImages })
        });

        const result = await response.json();
        if (result.success) {
            console.log('✅ 新历史记录已创建:', result.cachePath);
        } else {
            console.warn('创建历史记录失败:', result.error);
        }
    }

    loadQuickHistory();
}

// ========== 🖌️ 画笔工具模块 ==========
(function initBrushTool() {
    // 等待 DOM 加载完成
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', setupBrushTool);
    } else {
        setupBrushTool();
    }

    function setupBrushTool() {
        const brushBtn = document.getElementById('brush-btn');
        const brushPanel = document.getElementById('brush-panel');
        const brushPanelClose = document.getElementById('brush-panel-close');
        const brushColor = document.getElementById('brush-color');
        const brushColorHex = document.getElementById('brush-color-hex');
        const brushSize = document.getElementById('brush-size');
        const brushSizeValue = document.getElementById('brush-size-value');
        const brushStatus = document.getElementById('brush-status');
        const eyedropperBtn = document.getElementById('eyedropper-btn');
        const brushSizePresets = document.querySelectorAll('.brush-size-preset');

        if (!brushBtn) {
            console.warn('画笔工具按钮未找到');
            return;
        }

        let isDrawingModeActive = false;
        let isEyedropperMode = false;

        // 🔑 切换画笔模式 - 简化逻辑：单击开关
        brushBtn.addEventListener('click', function (e) {
            e.stopPropagation();

            if (!isDrawingModeActive) {
                // 开启绘图模式
                brushPanel.style.display = 'block';
                enableDrawingMode();
            } else {
                // 关闭绘图模式
                brushPanel.style.display = 'none';
                disableDrawingMode();
            }
        });

        // 关闭按钮 - 关闭面板和绘图模式
        if (brushPanelClose) {
            brushPanelClose.addEventListener('click', function () {
                brushPanel.style.display = 'none';
                disableDrawingMode();
            });
        }

        // 点击面板外部：只隐藏面板，不关闭绘图模式
        document.addEventListener('click', function (e) {
            if (isDrawingModeActive &&
                brushPanel.style.display !== 'none' &&
                !brushPanel.contains(e.target) &&
                !brushBtn.contains(e.target)) {
                brushPanel.style.display = 'none';
            }
        });

        // 🔑 创建圆形画笔光标
        let brushCursor = null;
        function createBrushCursor() {
            if (brushCursor) return;

            brushCursor = document.createElement('div');
            brushCursor.id = 'brush-cursor';
            brushCursor.style.cssText = `
                position: fixed;
                pointer-events: none;
                border: 2px solid rgba(10, 132, 255, 0.8);
                border-radius: 50%;
                z-index: 9999;
                display: none;
                transform: translate(-50%, -50%);
                box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.5);
            `;
            document.body.appendChild(brushCursor);
        }

        // 更新光标大小
        function updateBrushCursor(size) {
            if (!brushCursor) createBrushCursor();
            brushCursor.style.width = size + 'px';
            brushCursor.style.height = size + 'px';
        }

        // 显示/隐藏光标
        function showBrushCursor(show) {
            if (!brushCursor) createBrushCursor();
            brushCursor.style.display = show ? 'block' : 'none';
        }

        // 移动光标
        function moveBrushCursor(x, y) {
            if (!brushCursor) return;
            brushCursor.style.left = x + 'px';
            brushCursor.style.top = y + 'px';
        }

        // 🔑 Alt + 右键调整画笔大小
        let isResizingBrush = false;
        let resizeStartX = 0;
        let resizeStartSize = 10;

        document.addEventListener('mousedown', function (e) {
            if (!isDrawingModeActive) return;

            // Alt + 右键 = 调整画笔大小
            if (e.altKey && e.button === 2) {
                e.preventDefault();
                isResizingBrush = true;
                resizeStartX = e.clientX;
                resizeStartSize = parseInt(brushSize.value);

                // 隐藏右键菜单
                document.addEventListener('contextmenu', preventContextMenu);

                updateStatus('drawing', '🔄 拖动调整画笔大小');
            }
        });

        // 🔑 工具模式: 'select' | 'brush' | 'eraser' | 'eyedropper'
        let currentToolMode = 'select';
        let isEraserMode = false;

        // 🔑 PS风格快捷键: V=选择, B=画笔, E=橡皮擦, X=吸色
        document.addEventListener('keydown', function (e) {
            // 如果在输入框中，忽略快捷键
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
            if (!canvas) return;

            const key = e.key.toLowerCase();

            // V = 选择模式 (Select)
            if (key === 'v') {
                e.preventDefault();
                switchToSelectMode();
                console.log('🖱️ 切换到选择模式 (V)');
            }

            // B = 画笔模式 (Brush)
            if (key === 'b') {
                e.preventDefault();
                switchToBrushMode();
                console.log('🖌️ 切换到画笔模式 (B)');
            }

            // E = 橡皮擦模式 (Eraser)
            if (key === 'e') {
                e.preventDefault();
                switchToEraserMode();
                console.log('🧹 切换到橡皮擦模式 (E)');
            }

            // X = 按住进入吸色模式 (eXtract color / eyedropper)
            // 🔧 橡皮擦模式下不允许吸色
            if (key === 'x' && !isEyedropperMode && !isEraserMode) {
                e.preventDefault();
                enterEyedropperMode();
                console.log('💧 按住X进入吸色模式');
            }
        });

        // 🔑 松开X键退出吸色模式
        document.addEventListener('keyup', function (e) {
            if (e.key.toLowerCase() === 'x' && isEyedropperMode) {
                exitEyedropperMode();
                console.log('❌ 松开X退出吸色模式');
            }
        });

        // 🔑 切换到选择模式
        function switchToSelectMode() {
            currentToolMode = 'select';
            isEraserMode = false;
            disableDrawingMode();
            brushPanel.style.display = 'none';

            showBrushCursor(false);
            const canvasContainer = document.getElementById('fabricCanvasContainer');
            if (canvasContainer) {
                canvasContainer.style.cursor = '';
            }

            // 🔑 恢复画布选择和对象可选择性
            if (canvas) {
                canvas.selection = true;
                canvas.getObjects().forEach(obj => {
                    if (obj.type === 'path') {
                        // path对象保持不可选择
                        obj.set({
                            selectable: false,
                            evented: false,
                            hoverCursor: 'default'
                        });
                    } else if (obj.type !== 'image') {
                        // 文字、矩形等恢复可选择
                        obj.set({
                            selectable: true,
                            evented: true
                        });
                    }
                });
                canvas.renderAll();
            }

            brushBtn.classList.remove('active');
            updateStatus('default', '🖱️ 选择模式 | V=选择 B=画笔 E=橡皮擦');
        }

        // 🔑 切换到画笔模式
        function switchToBrushMode() {
            currentToolMode = 'brush';
            isEraserMode = false;
            isEyedropperMode = false;
            brushPanel.style.display = 'block';
            enableDrawingMode();

            // 设置画笔颜色（非橡皮擦）
            if (canvas && canvas.freeDrawingBrush) {
                canvas.freeDrawingBrush.color = brushColor.value;
            }

            // 🔑 显示圆形光标
            createBrushCursor();
            updateBrushCursor(parseInt(brushSize.value));
            showBrushCursor(true);

            // 恢复画笔光标蓝色边框
            if (brushCursor) {
                brushCursor.style.borderColor = '#0A84FF';
            }

            // 隐藏默认光标
            const canvasContainer = document.getElementById('fabricCanvasContainer');
            if (canvasContainer) {
                canvasContainer.style.cursor = 'none';
            }
        }

        // 🔑 切换到橡皮擦模式 - 纯删除模式，不画任何东西
        function switchToEraserMode() {
            currentToolMode = 'eraser';
            isEraserMode = true;
            isEyedropperMode = false;
            isDrawingModeActive = false; // 🔑 关键：禁用绘图，橡皮擦只删除不画

            if (!canvas) return;

            // 🧹 禁用自由绘图模式
            canvas.isDrawingMode = false;

            // 🔑 设置 path 对象可被点击删除
            canvas.selection = false;
            canvas.getObjects().forEach(obj => {
                if (obj.type === 'path') {
                    obj.set({
                        selectable: false,
                        evented: true, // 允许被点击/触碰以触发删除
                        hoverCursor: 'pointer'
                    });
                } else if (obj.type !== 'image') {
                    obj.set({
                        selectable: false,
                        evented: false
                    });
                }
            });
            canvas.renderAll();

            // 隐藏画笔面板（橡皮擦不需要调整颜色/粗细）
            brushPanel.style.display = 'none';

            // 🔑 显示橡皮擦光标（红色圆圈）
            createBrushCursor();
            updateBrushCursor(20); // 固定大小的橡皮擦光标
            showBrushCursor(true);

            if (brushCursor) {
                brushCursor.style.borderColor = '#FF3B30';
                brushCursor.style.backgroundColor = 'rgba(255, 59, 48, 0.15)';
            }

            const canvasContainer = document.getElementById('fabricCanvasContainer');
            if (canvasContainer) {
                canvasContainer.style.cursor = 'none';
            }

            brushBtn.classList.remove('active');
            updateStatus('drawing', '🧹 橡皮擦模式：点击或拖动删除笔画 | B=画笔 V=选择');
        }

        // 🔑 进入吸色模式 - 带放大镜
        let magnifier = null;
        let magnifierCanvas = null;
        let magnifierColorPreview = null;
        let currentHoverColor = '#000000';

        function createMagnifier() {
            if (magnifier) return;

            magnifier = document.createElement('div');
            magnifier.className = 'eyedropper-magnifier';

            magnifierCanvas = document.createElement('canvas');
            magnifierCanvas.width = 240;  // 放大2倍
            magnifierCanvas.height = 240;
            magnifier.appendChild(magnifierCanvas);

            magnifierColorPreview = document.createElement('div');
            magnifierColorPreview.className = 'eyedropper-color-preview';
            magnifierColorPreview.textContent = '#000000';
            magnifier.appendChild(magnifierColorPreview);

            document.body.appendChild(magnifier);
        }

        function updateMagnifier(clientX, clientY) {
            if (!magnifier || !canvas) return;

            const canvasContainer = document.getElementById('fabricCanvasContainer');
            if (!canvasContainer) return;

            const rect = canvasContainer.getBoundingClientRect();
            const x = clientX - rect.left;
            const y = clientY - rect.top;

            // 获取源画布
            const sourceCanvas = canvas.getElement();
            const sourceCtx = sourceCanvas.getContext('2d');

            // 获取中心点颜色
            if (x >= 0 && y >= 0 && x < sourceCanvas.width && y < sourceCanvas.height) {
                const pixel = sourceCtx.getImageData(x, y, 1, 1).data;
                currentHoverColor = rgbToHex(pixel[0], pixel[1], pixel[2]);
                magnifierColorPreview.textContent = currentHoverColor.toUpperCase();
                magnifierColorPreview.style.borderTopColor = currentHoverColor;
            }

            // 绘制放大的图像
            const ctx = magnifierCanvas.getContext('2d');
            ctx.imageSmoothingEnabled = false;  // 像素化放大
            ctx.clearRect(0, 0, 240, 240);

            // 截取源画布的一部分并放大
            const sampleSize = 60;  // 采样60x60像素
            const scale = 4;  // 放大4倍

            ctx.drawImage(
                sourceCanvas,
                x - sampleSize / 2, y - sampleSize / 2, sampleSize, sampleSize,
                0, 0, 240, 240
            );

            // 放大镜跟随鼠标，偏移一定距离
            magnifier.style.left = (clientX + 30) + 'px';
            magnifier.style.top = (clientY - 60) + 'px';
            magnifier.style.display = 'block';
        }

        function hideMagnifier() {
            if (magnifier) {
                magnifier.style.display = 'none';
            }
        }

        function enterEyedropperMode() {
            isEyedropperMode = true;
            if (canvas) canvas.isDrawingMode = false;
            showBrushCursor(false);

            const canvasContainer = document.getElementById('fabricCanvasContainer');
            if (canvasContainer) {
                canvasContainer.style.cursor = 'crosshair';
            }

            // 创建并显示放大镜
            createMagnifier();

            updateStatus('eyedropper', '💧 吸色模式 - 点击画布吸取颜色');
        }

        // 吸色模式下点击画布吸取颜色
        function eyedropperClick(e) {
            if (!isEyedropperMode || !canvas) return;

            const canvasContainer = document.getElementById('fabricCanvasContainer');
            if (!canvasContainer) return;

            const rect = canvasContainer.getBoundingClientRect();
            const pointer = {
                x: e.clientX - rect.left,
                y: e.clientY - rect.top
            };

            const canvasEl = canvas.getElement();
            const ctx = canvasEl.getContext('2d');
            const pixel = ctx.getImageData(pointer.x, pointer.y, 1, 1).data;

            const hexColor = rgbToHex(pixel[0], pixel[1], pixel[2]);

            // 更新颜色
            brushColor.value = hexColor;
            brushColorHex.textContent = hexColor.toUpperCase();

            if (canvas.freeDrawingBrush) {
                canvas.freeDrawingBrush.color = hexColor;
            }

            // 🔧 不自动退出吸色模式，只更新状态
            updateStatus('eyedropper', `🎨 已吸取 ${hexColor.toUpperCase()} | 继续吸色或松开X键退出`);
            console.log('💧 吸取颜色:', hexColor);
        }

        function exitEyedropperMode() {
            isEyedropperMode = false;

            // 隐藏放大镜
            hideMagnifier();

            // 返回画笔模式
            if (canvas) {
                canvas.isDrawingMode = true;
                isDrawingModeActive = true;
            }
            showBrushCursor(true);

            const canvasContainer = document.getElementById('fabricCanvasContainer');
            if (canvasContainer) {
                canvasContainer.style.cursor = 'none';
            }

            currentToolMode = 'brush';
            updateStatus('drawing', '🖌️ 绘图中 | V=选择 B=画笔 E=橡皮擦 X=吸色');
        }

        document.addEventListener('mousemove', function (e) {
            // 更新光标位置
            if (isDrawingModeActive && brushCursor && !isEyedropperMode) {
                moveBrushCursor(e.clientX, e.clientY);
            }

            // 🔍 吸色模式下更新放大镜
            if (isEyedropperMode) {
                updateMagnifier(e.clientX, e.clientY);
            }

            // Alt+右键调整大小
            if (isResizingBrush) {
                const deltaX = e.clientX - resizeStartX;
                let newSize = Math.round(resizeStartSize + deltaX / 2);
                newSize = Math.max(1, Math.min(50, newSize));

                brushSize.value = newSize;
                brushSizeValue.textContent = newSize + 'px';

                if (canvas && canvas.freeDrawingBrush) {
                    canvas.freeDrawingBrush.width = newSize;
                }

                updateBrushCursor(newSize);

                // 更新预设按钮状态
                brushSizePresets.forEach(btn => {
                    btn.classList.remove('active');
                    if (parseInt(btn.dataset.size) === newSize) {
                        btn.classList.add('active');
                    }
                });
            }
        });

        document.addEventListener('mouseup', function (e) {
            if (isResizingBrush) {
                isResizingBrush = false;
                document.removeEventListener('contextmenu', preventContextMenu);
                updateStatus('drawing', '🖌️ 绘图模式已启用');
            }
        });

        function preventContextMenu(e) {
            e.preventDefault();
        }

        // 画布区域鼠标事件
        function setupCanvasMouseEvents() {
            const canvasContainer = document.getElementById('fabricCanvasContainer');
            if (!canvasContainer) return;

            canvasContainer.addEventListener('mouseenter', function () {
                // 🔧 画笔模式或橡皮擦模式都显示光标
                if ((isDrawingModeActive || isEraserMode) && !isEyedropperMode) {
                    showBrushCursor(true);
                    canvasContainer.style.cursor = 'none';
                }
            });

            canvasContainer.addEventListener('mouseleave', function () {
                showBrushCursor(false);
                canvasContainer.style.cursor = '';
            });

            canvasContainer.addEventListener('mousemove', function (e) {
                // 🔧 画笔模式或橡皮擦模式都跟随光标
                if ((isDrawingModeActive || isEraserMode) && !isEyedropperMode) {
                    moveBrushCursor(e.clientX, e.clientY);
                }
            });

            // 禁止画布区域的右键菜单（绘图模式时）
            canvasContainer.addEventListener('contextmenu', function (e) {
                if (isDrawingModeActive) {
                    e.preventDefault();
                }
            });
        }

        // 🔑 启用绘图模式
        function enableDrawingMode() {
            if (!canvas) {
                console.warn('画布未初始化');
                return;
            }

            isDrawingModeActive = true;
            canvas.isDrawingMode = true;

            // 配置画笔
            canvas.freeDrawingBrush.color = brushColor.value;
            canvas.freeDrawingBrush.width = parseInt(brushSize.value);
            canvas.freeDrawingBrush.globalCompositeOperation = 'source-over'; // 🔑 恢复正常混合模式
            canvas.freeDrawingBrush.decimate = 2; // 平滑度

            // 创建并显示圆形光标
            createBrushCursor();
            updateBrushCursor(parseInt(brushSize.value));

            // 隐藏默认光标
            const canvasContainer = document.getElementById('fabricCanvasContainer');
            if (canvasContainer) {
                canvasContainer.style.cursor = 'none';
            }

            brushBtn.classList.add('active');
            updateStatus('drawing', '🖌️ 绘图中 | X键吸色 | Alt+右键调整大小');

            console.log('🖌️ 绘图模式已启用');
        }

        // 🔑 禁用绘图模式
        function disableDrawingMode() {
            if (!canvas) return;

            isDrawingModeActive = false;
            isEyedropperMode = false;
            canvas.isDrawingMode = false;

            // 隐藏圆形光标
            showBrushCursor(false);

            brushBtn.classList.remove('active');
            updateStatus('default', '点击画布开始绘制');

            // 恢复默认光标
            const canvasContainer = document.getElementById('fabricCanvasContainer');
            if (canvasContainer) {
                canvasContainer.classList.remove('eyedropper-mode');
                canvasContainer.style.cursor = '';
            }

            console.log('🖌️ 绘图模式已禁用');
        }

        // 初始化画布鼠标事件
        setTimeout(setupCanvasMouseEvents, 1000);

        // 🔑 颜色选择
        if (brushColor) {
            brushColor.addEventListener('input', function () {
                if (brushColorHex) {
                    brushColorHex.textContent = this.value.toUpperCase();
                }
                if (canvas && canvas.freeDrawingBrush) {
                    canvas.freeDrawingBrush.color = this.value;
                }
            });
        }

        // 🔑 粗细调整
        if (brushSize) {
            brushSize.addEventListener('input', function () {
                const size = parseInt(this.value);
                if (brushSizeValue) {
                    brushSizeValue.textContent = size + 'px';
                }
                if (canvas && canvas.freeDrawingBrush) {
                    canvas.freeDrawingBrush.width = size;
                }

                // 🔑 同步更新圆形光标大小
                updateBrushCursor(size);

                // 更新预设按钮状态
                brushSizePresets.forEach(btn => {
                    btn.classList.remove('active');
                    if (parseInt(btn.dataset.size) === size) {
                        btn.classList.add('active');
                    }
                });
            });
        }

        // 🔑 粗细预设按钮
        brushSizePresets.forEach(btn => {
            btn.addEventListener('click', function () {
                const size = parseInt(this.dataset.size);
                brushSize.value = size;
                brushSizeValue.textContent = size + 'px';

                if (canvas && canvas.freeDrawingBrush) {
                    canvas.freeDrawingBrush.width = size;
                }

                // 🔑 同步更新圆形光标大小
                updateBrushCursor(size);

                brushSizePresets.forEach(b => b.classList.remove('active'));
                this.classList.add('active');
            });
        });

        if (eyedropperBtn) {
            eyedropperBtn.addEventListener('click', function () {
                if (!canvas) return;

                isEyedropperMode = !isEyedropperMode;

                const canvasContainer = document.getElementById('fabricCanvasContainer');

                if (isEyedropperMode) {
                    canvas.isDrawingMode = false;
                    updateStatus('eyedropper', '💧 吸色模式 - 点击画布吸取颜色');

                    // 隐藏圆形画笔光标，显示十字光标
                    showBrushCursor(false);
                    if (canvasContainer) {
                        canvasContainer.classList.add('eyedropper-mode');
                        canvasContainer.style.cursor = 'crosshair';
                    }

                    this.classList.add('active');
                } else {
                    if (isDrawingModeActive) {
                        canvas.isDrawingMode = true;
                        updateStatus('drawing', '🖌️ 绘图模式 | Alt+右键拖动调整大小');

                        // 恢复圆形画笔光标
                        showBrushCursor(true);
                        if (canvasContainer) {
                            canvasContainer.style.cursor = 'none';
                        }
                    }

                    if (canvasContainer) {
                        canvasContainer.classList.remove('eyedropper-mode');
                    }

                    this.classList.remove('active');
                }
            });
        }

        // 🔑 画布点击吸色
        function handleCanvasClick(e) {
            if (!isEyedropperMode || !canvas) return;

            // 获取点击位置的颜色
            const pointer = canvas.getPointer(e.e);
            const ctx = canvas.getContext('2d');
            const pixel = ctx.getImageData(pointer.x, pointer.y, 1, 1).data;

            const hexColor = rgbToHex(pixel[0], pixel[1], pixel[2]);

            // 更新颜色
            brushColor.value = hexColor;
            brushColorHex.textContent = hexColor.toUpperCase();

            if (canvas.freeDrawingBrush) {
                canvas.freeDrawingBrush.color = hexColor;
            }

            // 退出吸色模式
            isEyedropperMode = false;
            canvas.isDrawingMode = true;
            updateStatus('drawing', `🎨 已吸取颜色 ${hexColor.toUpperCase()}`);

            const canvasContainer = document.getElementById('fabricCanvasContainer');
            if (canvasContainer) {
                canvasContainer.classList.remove('eyedropper-mode');
            }

            eyedropperBtn.classList.remove('active');

            console.log('💧 吸取颜色:', hexColor);
        }

        // RGB 转 Hex
        function rgbToHex(r, g, b) {
            return '#' + [r, g, b].map(x => {
                const hex = x.toString(16);
                return hex.length === 1 ? '0' + hex : hex;
            }).join('');
        }

        // 更新状态提示
        function updateStatus(type, text) {
            if (!brushStatus) return;
            brushStatus.textContent = text;
            brushStatus.className = 'brush-status';
            if (type !== 'default') {
                brushStatus.classList.add(type);
            }
        }

        // 🔑 监听画布创建，绑定事件
        const originalInitCanvas = window.initCanvas;
        window.initCanvas = function () {
            if (originalInitCanvas) {
                originalInitCanvas.apply(this, arguments);
            }
            bindCanvasEvents();
        };

        function bindCanvasEvents() {
            if (!canvas) {
                // 等待画布初始化
                setTimeout(bindCanvasEvents, 500);
                return;
            }

            // 吸色点击事件（支持X键进入吸色模式后点击）
            let isEraserDragging = false;
            let eraserDeletedCount = 0;

            canvas.on('mouse:down', function (e) {
                if (isEyedropperMode) {
                    eyedropperClick(e.e);
                    return;
                }

                // 🧹 橡皮擦模式：开始拖动删除
                if (isEraserMode) {
                    isEraserDragging = true;
                    eraserDeletedCount = 0;

                    // 如果直接点击到 path，立即删除
                    if (e.target && e.target.type === 'path') {
                        canvas.remove(e.target);
                        eraserDeletedCount++;
                        canvas.renderAll();
                        console.log('🧹 橡皮擦点击删除笔画');
                    }
                }
            });

            // 🧹 橡皮擦拖动删除：鼠标移动时检测触碰的 path
            canvas.on('mouse:move', function (e) {
                if (!isEraserMode || !isEraserDragging) return;

                if (e.target && e.target.type === 'path') {
                    canvas.remove(e.target);
                    eraserDeletedCount++;
                    canvas.renderAll();
                    console.log('🧹 橡皮擦拖动删除笔画');
                }
            });

            // 🧹 橡皮擦拖动结束：保存历史
            canvas.on('mouse:up', function () {
                if (isEraserMode && isEraserDragging) {
                    isEraserDragging = false;

                    if (eraserDeletedCount > 0) {
                        // 保存历史
                        if (typeof history !== 'undefined' && history.saveState) {
                            history.saveState();
                        }
                        updateStatus('drawing', `🧹 已删除 ${eraserDeletedCount} 个笔画 | 继续擦除或按V返回`);
                        console.log(`🧹 橡皮擦共删除 ${eraserDeletedCount} 个笔画`);
                    }
                    eraserDeletedCount = 0;
                }
            });

            // 🔑 笔画完成后：设为不可选择，移到底部，保存历史
            canvas.on('path:created', function (e) {
                const path = e.path;
                if (path) {
                    // 🖌️ 设置画笔路径为不可选择
                    path.set({
                        selectable: false,
                        evented: false,
                        hoverCursor: 'default'
                    });

                    // 🖌️ 移动到底部（背景图之上，文字之下）
                    canvas.sendToBack(path);
                    // 确保背景图在最底部
                    const bgImage = canvas.getObjects().find(obj => obj.type === 'image');
                    if (bgImage) {
                        canvas.sendToBack(bgImage);
                    }

                    canvas.renderAll();
                }

                console.log('🖌️ 笔画完成，保存历史状态');
                if (typeof history !== 'undefined' && history.saveState) {
                    history.saveState();
                }
            });

            console.log('🖌️ 画笔工具事件已绑定到画布');
        }

        // 尝试立即绑定（如果画布已存在）
        if (typeof canvas !== 'undefined' && canvas) {
            bindCanvasEvents();
        }

        console.log('🖌️ 画笔工具模块已初始化');
    }
})();

// ========== ✨ 智能涂抹笔模块 ==========
(function initSmartInpaintTool() {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', setupSmartInpaintTool);
    } else {
        setupSmartInpaintTool();
    }

    function setupSmartInpaintTool() {
        const smartInpaintBtn = document.getElementById('smart-inpaint-btn');
        if (!smartInpaintBtn) {
            console.warn('✨ 智能涂抹笔按钮未找到');
            return;
        }

        // 🔧 使用全局状态，确保跨图片切换时保持一致
        window._smartInpaint = window._smartInpaint || {
            isActive: false,
            paths: [],
            boundCanvas: null
        };

        let inpaintCursor = null;
        const INPAINT_BRUSH_SIZE = 30;

        // 创建涂抹光标
        function createInpaintCursor() {
            if (inpaintCursor) return;
            inpaintCursor = document.createElement('div');
            inpaintCursor.id = 'inpaint-cursor';
            inpaintCursor.style.cssText = `
                position: fixed;
                pointer-events: none;
                width: ${INPAINT_BRUSH_SIZE}px;
                height: ${INPAINT_BRUSH_SIZE}px;
                border: 2px solid rgba(255, 100, 100, 0.9);
                background: rgba(255, 0, 0, 0.2);
                border-radius: 50%;
                z-index: 9999;
                display: none;
                transform: translate(-50%, -50%);
            `;
            document.body.appendChild(inpaintCursor);
        }

        function showInpaintCursor(show) {
            if (!inpaintCursor) createInpaintCursor();
            inpaintCursor.style.display = show ? 'block' : 'none';
        }

        function moveInpaintCursor(x, y) {
            if (!inpaintCursor) return;
            inpaintCursor.style.left = x + 'px';
            inpaintCursor.style.top = y + 'px';
        }

        // 切换到智能涂抹模式
        function switchToSmartInpaintMode() {
            if (!canvas) {
                alert('请先上传并翻译图片');
                return;
            }

            window._smartInpaint.isActive = true;
            window._smartInpaint.paths = [];

            // 启用自由绘图模式
            canvas.isDrawingMode = true;
            canvas.selection = false;

            // 配置画笔为红色半透明
            canvas.freeDrawingBrush.color = 'rgba(255, 0, 0, 0.5)';
            canvas.freeDrawingBrush.width = INPAINT_BRUSH_SIZE;

            // 禁用其他对象交互
            canvas.getObjects().forEach(obj => {
                if (obj.type !== 'image') {
                    obj.set({ selectable: false, evented: false });
                }
            });

            // 显示光标
            createInpaintCursor();
            showInpaintCursor(true);

            // 隐藏默认光标
            const canvasContainer = document.getElementById('fabricCanvasContainer');
            if (canvasContainer) {
                canvasContainer.style.cursor = 'none';
            }

            smartInpaintBtn.classList.add('active');
            console.log('✨ 进入智能涂抹模式');

            // 显示提示
            const statusEl = document.getElementById('brush-status');
            if (statusEl) {
                statusEl.textContent = '✨ 涂抹要修复的区域，松开鼠标自动处理';
                statusEl.style.color = '#FF6B6B';
            }
        }

        // 退出智能涂抹模式
        function exitSmartInpaintMode() {
            window._smartInpaint.isActive = false;

            // 🔑 清除所有未处理的涂抹路径
            if (canvas && window._smartInpaint.paths.length > 0) {
                window._smartInpaint.paths.forEach(p => {
                    try { canvas.remove(p); } catch (e) { }
                });
                window._smartInpaint.paths = [];
            }

            // 🔑 清除延迟处理定时器
            if (window._inpaintTimer) {
                clearTimeout(window._inpaintTimer);
                window._inpaintTimer = null;
            }

            if (canvas) {
                canvas.isDrawingMode = false;
                canvas.selection = true;

                // 恢复对象交互（排除所有 path 类型）
                canvas.getObjects().forEach(obj => {
                    if (obj.type !== 'image' && obj.type !== 'path') {
                        obj.set({ selectable: true, evented: true });
                    }
                });
                canvas.renderAll();
            }

            showInpaintCursor(false);
            smartInpaintBtn.classList.remove('active');

            const canvasContainer = document.getElementById('fabricCanvasContainer');
            if (canvasContainer) {
                canvasContainer.style.cursor = '';
            }

            // 🔑 恢复状态提示
            const statusEl = document.getElementById('brush-status');
            if (statusEl) {
                statusEl.textContent = '';
                statusEl.style.color = '';
            }

            console.log('✨ 退出智能涂抹模式');
        }

        // 🔑 暴露全局退出函数，供图片切换时调用
        window.exitSmartInpaintMode = exitSmartInpaintMode;

        // 生成遮罩并调用 API
        async function processInpaint() {
            if (!canvas || window._smartInpaint.paths.length === 0) return;

            console.log('✨ 开始生成遮罩并调用 AI...');

            // 显示加载提示
            const loadingOverlay = document.getElementById('loadingOverlay');
            const loadingText = document.getElementById('loadingText');
            if (loadingOverlay) {
                loadingOverlay.classList.add('active');
                if (loadingText) loadingText.textContent = '✨ AI 正在修复涂抹区域...';
            }

            try {
                // 1. 获取当前背景图的 base64
                const bgImage = canvas.backgroundImage;
                if (!bgImage) {
                    throw new Error('没有背景图片');
                }

                // 创建临时画布获取背景
                const tempCanvas = document.createElement('canvas');
                tempCanvas.width = canvas.getWidth();
                tempCanvas.height = canvas.getHeight();
                const tempCtx = tempCanvas.getContext('2d');

                // 绘制背景
                tempCtx.drawImage(bgImage._element, 0, 0, tempCanvas.width, tempCanvas.height);
                const imageBase64 = tempCanvas.toDataURL('image/png');

                // 2. 生成遮罩图 (黑底白色涂抹区域)
                const maskCanvas = document.createElement('canvas');
                maskCanvas.width = canvas.getWidth();
                maskCanvas.height = canvas.getHeight();
                const maskCtx = maskCanvas.getContext('2d');

                // 黑色背景
                maskCtx.fillStyle = '#000000';
                maskCtx.fillRect(0, 0, maskCanvas.width, maskCanvas.height);

                // 绘制白色遮罩路径
                maskCtx.strokeStyle = '#FFFFFF';
                maskCtx.lineCap = 'round';
                maskCtx.lineJoin = 'round';
                maskCtx.lineWidth = INPAINT_BRUSH_SIZE;

                window._smartInpaint.paths.forEach(pathObj => {
                    if (pathObj.path) {
                        const pathData = pathObj.path;
                        maskCtx.beginPath();
                        pathData.forEach((cmd, i) => {
                            if (cmd[0] === 'M') {
                                maskCtx.moveTo(cmd[1], cmd[2]);
                            } else if (cmd[0] === 'Q') {
                                maskCtx.quadraticCurveTo(cmd[1], cmd[2], cmd[3], cmd[4]);
                            } else if (cmd[0] === 'L') {
                                maskCtx.lineTo(cmd[1], cmd[2]);
                            }
                        });
                        maskCtx.stroke();
                    }
                });

                const maskBase64 = maskCanvas.toDataURL('image/png');

                // 3. 调用后端 API
                const response = await fetch('/api/smart_inpaint', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        image: imageBase64,
                        mask: maskBase64
                    })
                });

                const result = await response.json();

                if (result.success && result.result_image) {
                    // 4. 应用修复结果到画布背景
                    fabric.Image.fromURL(result.result_image, function (img) {
                        img.set({
                            originX: 'left',
                            originY: 'top',
                            left: 0,
                            top: 0,
                            scaleX: canvas.getWidth() / img.width,
                            scaleY: canvas.getHeight() / img.height
                        });

                        canvas.setBackgroundImage(img, canvas.renderAll.bind(canvas));

                        // 删除涂抹路径
                        window._smartInpaint.paths.forEach(p => canvas.remove(p));
                        window._smartInpaint.paths = [];

                        canvas.renderAll();

                        // 🔑 关键修复：保存修复后的背景图到 appState，确保切换图片后不丢失
                        if (appState.currentLang && appState.currentIndex >= 0 && appState.translations) {
                            const currentImgObj = appState.translations[appState.currentLang].images[appState.currentIndex];
                            if (currentImgObj && currentImgObj.result) {
                                // 保存新的背景图 URL
                                currentImgObj.result.inpainted_url = result.result_image;
                                console.log('✅ 已保存修复后的背景图到 appState');
                            }
                        }

                        // 同步当前画布状态
                        if (typeof syncCurrentCanvasToState === 'function') {
                            syncCurrentCanvasToState();
                        }

                        // 保存历史
                        if (typeof history !== 'undefined' && history.saveState) {
                            history.saveState();
                        }

                        console.log('✅ 智能涂抹修复完成');
                    }, { crossOrigin: 'anonymous' });

                } else {
                    throw new Error(result.error || 'AI 修复失败');
                }

            } catch (err) {
                console.error('❌ 智能涂抹失败:', err);
                alert('智能涂抹失败: ' + err.message);

                // 删除失败的涂抹路径
                window._smartInpaint.paths.forEach(p => canvas.remove(p));
                window._smartInpaint.paths = [];
                canvas.renderAll();
            } finally {
                // 隐藏加载
                if (loadingOverlay) {
                    loadingOverlay.classList.remove('active');
                }
            }
        }

        // 按钮点击事件
        smartInpaintBtn.addEventListener('click', function () {
            if (window._smartInpaint.isActive) {
                exitSmartInpaintMode();
            } else {
                switchToSmartInpaintMode();
            }
        });

        // 快捷键 W
        document.addEventListener('keydown', function (e) {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

            if (e.key.toLowerCase() === 'w') {
                e.preventDefault();
                if (window._smartInpaint.isActive) {
                    exitSmartInpaintMode();
                } else {
                    switchToSmartInpaintMode();
                }
            }

            // V 或 Escape 退出
            if ((e.key.toLowerCase() === 'v' || e.key === 'Escape') && window._smartInpaint.isActive) {
                exitSmartInpaintMode();
            }
        });

        // 鼠标移动跟踪光标
        document.addEventListener('mousemove', function (e) {
            if (window._smartInpaint.isActive) {
                moveInpaintCursor(e.clientX, e.clientY);
            }
        });

        // 画布区域鼠标事件
        function bindCanvasEvents() {
            if (!canvas) {
                setTimeout(bindCanvasEvents, 500);
                return;
            }

            // 🔧 检查是否已经绑定到当前 canvas 实例
            if (window._smartInpaint.boundCanvas === canvas) {
                console.log('✨ 智能涂抹笔事件已绑定到当前画布，跳过');
                return;
            }

            // 标记当前 canvas 实例
            window._smartInpaint.boundCanvas = canvas;

            // 路径创建完成后收集并处理
            canvas.on('path:created', function (e) {
                if (!window._smartInpaint.isActive) return;

                const path = e.path;
                if (path) {
                    // 🔑 标记为智能涂抹路径，用于排除序列化
                    path.set({
                        selectable: false,
                        evented: false,
                        stroke: 'rgba(255, 0, 0, 0.5)',
                        fill: null,
                        isInpaintPath: true  // 🔑 关键标记
                    });

                    window._smartInpaint.paths.push(path);
                    canvas.renderAll();

                    console.log('✨ 收集涂抹路径，共', window._smartInpaint.paths.length, '条');

                    // 延迟处理，允许连续涂抹
                    clearTimeout(window._inpaintTimer);
                    window._inpaintTimer = setTimeout(() => {
                        if (window._smartInpaint.paths.length > 0 && window._smartInpaint.isActive) {
                            processInpaint();
                        }
                    }, 800); // 800ms 无操作后自动处理
                }
            });

            console.log('✨ 智能涂抹笔事件已绑定到新画布');
        }

        // 🔧 暴露全局重新绑定函数，供图片切换时调用
        window.rebindSmartInpaint = function () {
            window._smartInpaint.boundCanvas = null; // 清除绑定标记
            bindCanvasEvents();
        };

        // 尝试绑定
        if (typeof canvas !== 'undefined' && canvas) {
            bindCanvasEvents();
        } else {
            setTimeout(bindCanvasEvents, 1000);
        }

        // 🔧 监听画布变化，自动重新绑定（每秒检查一次）
        setInterval(function () {
            if (typeof canvas === 'undefined' || !canvas) return;

            // 检查 canvas 实例变化，需要重新绑定事件
            if (window._smartInpaint.boundCanvas !== canvas) {
                console.log('✨ 检测到画布实例变化，重新绑定事件');
                bindCanvasEvents();
            }

            // 🔧 关键修复：检查智能涂抹模式状态一致性
            // 如果 isActive 为 true 但 canvas 状态不对（被其他操作重置了），重新应用设置
            if (window._smartInpaint.isActive) {
                if (!canvas.isDrawingMode ||
                    canvas.freeDrawingBrush.color !== 'rgba(255, 0, 0, 0.5)' ||
                    canvas.freeDrawingBrush.width !== INPAINT_BRUSH_SIZE) {

                    console.log('✨ 检测到智能涂抹状态被重置，重新应用设置');
                    canvas.isDrawingMode = true;
                    canvas.selection = false;
                    canvas.freeDrawingBrush.color = 'rgba(255, 0, 0, 0.5)';
                    canvas.freeDrawingBrush.width = INPAINT_BRUSH_SIZE;

                    // 重新显示光标
                    showInpaintCursor(true);
                    const canvasContainer = document.getElementById('fabricCanvasContainer');
                    if (canvasContainer) {
                        canvasContainer.style.cursor = 'none';
                    }
                }
            }
        }, 500); // 改为每500ms检查一次，更快响应

        console.log('✨ 智能涂抹笔模块已初始化');
    }
})();
