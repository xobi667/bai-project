
// 🔑 版本标记 - 用于确认浏览器加载了最新代码
const APP_VERSION = '2024-12-20-v22-Rebrand';
console.log('🚀 App.js 版本:', APP_VERSION);

// 全局变量
// 全局状态管理
const appState = {
    images: [], // {id, file, url, status, result, canvasData, thumbnail}
    currentIndex: -1,
    syncLock: false  // 🔑 同步锁：防止切换语言时覆盖同步后的数据
};

let canvas = null;
let currentImage = null; // 兼容性：指向当前图片
let currentFilename = 'translated_image.png';
let selectedObject = null;
let selectedObjectsArray = null; // 用于存储多选的对象数组

// 操作历史记录 - 简化版全局栈
const history = {
    undoStack: [],
    redoStack: [],
    isPerformingAction: false,

    saveState() {
        if (this.isPerformingAction) return;
        if (!canvas) return;

        // 只保存文本对象
        const objects = canvas.getObjects().filter(obj => obj.type === 'textbox' || obj.type === 'i-text');

        if (objects.length === 0) {
            return;
        }

        // 使用完整的 toJSON 保存所有属性
        const currentState = canvas.toJSON([
            'left', 'top', 'width', 'height', 'scaleX', 'scaleY', 'angle',
            'selectable', 'hasControls', 'fontSize', 'fontFamily', 'fontWeight',
            'fontStyle', 'fill', 'stroke', 'strokeWidth', 'textAlign', 'charSpacing',
            'lineHeight', 'text', 'splitByGrapheme', 'breakWords', 'originX', 'originY',
            'borderColor', 'cornerColor', 'cornerSize', 'transparentCorners', 'padding'
        ]);

        this.undoStack.push(JSON.stringify(currentState));
        console.log(`💾 saveState: 保存状态, 栈深度=${this.undoStack.length}`);

        // 清空重做栈
        this.redoStack = [];

        // 限制历史记录大小
        if (this.undoStack.length > 30) {
            this.undoStack.shift();
        }
    },

    undo() {
        if (!canvas || this.undoStack.length === 0) {
            console.log('❌ 无法撤销：栈为空');
            return;
        }

        this.isPerformingAction = true;
        console.log('⬅️ 撤销操作');

        // 保存当前状态到重做栈
        const currentState = canvas.toJSON([
            'left', 'top', 'width', 'height', 'scaleX', 'scaleY', 'angle',
            'selectable', 'hasControls', 'fontSize', 'fontFamily', 'fontWeight',
            'fontStyle', 'fill', 'stroke', 'strokeWidth', 'textAlign', 'charSpacing',
            'lineHeight', 'text', 'splitByGrapheme', 'breakWords', 'originX', 'originY',
            'borderColor', 'cornerColor', 'cornerSize', 'transparentCorners', 'padding'
        ]);
        this.redoStack.push(JSON.stringify(currentState));

        // 恢复前一个状态
        const previousState = this.undoStack.pop();

        canvas.loadFromJSON(previousState, () => {
            canvas.renderAll();
            this.isPerformingAction = false;
            console.log('✅ 撤销完成');
        });
    },

    redo() {
        if (!canvas || this.redoStack.length === 0) {
            console.log('❌ 无法重做：栈为空');
            return;
        }

        this.isPerformingAction = true;
        console.log('➡️ 重做操作');

        // 保存当前状态到撤销栈
        const currentState = canvas.toJSON([
            'left', 'top', 'width', 'height', 'scaleX', 'scaleY', 'angle',
            'selectable', 'hasControls', 'fontSize', 'fontFamily', 'fontWeight',
            'fontStyle', 'fill', 'stroke', 'strokeWidth', 'textAlign', 'charSpacing',
            'lineHeight', 'text', 'splitByGrapheme', 'breakWords', 'originX', 'originY',
            'borderColor', 'cornerColor', 'cornerSize', 'transparentCorners', 'padding'
        ]);
        this.undoStack.push(JSON.stringify(currentState));

        // 恢复下一个状态
        const nextState = this.redoStack.pop();

        canvas.loadFromJSON(nextState, () => {
            canvas.renderAll();
            this.isPerformingAction = false;
            console.log('✅ 重做完成');
        });
    },

    // 清除历史（切换语言/图片时调用）
    clear() {
        this.undoStack = [];
        this.redoStack = [];
        console.log('🧹 历史记录已清空');
    }
};

// 页面加载完成时执行
document.addEventListener('DOMContentLoaded', function () {
    console.log('🚀 DOMContentLoaded fired - starting initialization');

    // 加载主题设置
    const savedTheme = localStorage.getItem('theme') || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);

    // 绑定主题切换按钮 (with null check)
    const themeToggleBtn = document.getElementById('themeToggle');
    if (themeToggleBtn) {
        themeToggleBtn.addEventListener('click', function () {
            const html = document.documentElement;
            const currentTheme = html.getAttribute('data-theme');
            const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
            html.setAttribute('data-theme', newTheme);
            localStorage.setItem('theme', newTheme);
        });
    } else {
        console.warn('⚠️ themeToggle button not found - skipping');
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

    // 重新添加键盘快捷键
    document.addEventListener('keydown', function (e) {
        // 如果在输入框中，不处理删除键
        const activeElement = document.activeElement;
        const isInputField = activeElement && (
            activeElement.tagName === 'INPUT' ||
            activeElement.tagName === 'TEXTAREA' ||
            activeElement.contentEditable === 'true'
        );

        // Ctrl+Z: 撤销
        if (e.ctrlKey && e.key === 'z' && !e.altKey) {
            e.preventDefault();
            history.undo();
        }

        // Ctrl+Alt+Z: 重做
        if (e.ctrlKey && e.altKey && e.key === 'z') {
            e.preventDefault();
            history.redo();
        }

        // Delete 或 Backspace: 删除选中的对象
        if ((e.key === 'Delete' || e.key === 'Backspace') && !isInputField) {
            if (canvas) {
                const activeObjects = canvas.getActiveObjects();
                if (activeObjects && activeObjects.length > 0) {
                    e.preventDefault();
                    activeObjects.forEach(obj => {
                        canvas.remove(obj);
                    });
                    canvas.discardActiveObject();
                    canvas.renderAll();
                    history.saveState();
                    console.log('🗑️ 删除了', activeObjects.length, '个对象');
                }
            }
        }
    });

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
                    borderColor: '#a855f7',
                    cornerColor: '#a855f7',
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

    // ========== 右侧面板切换逻辑 ==========
    // 显示编辑面板或下载面板
    window.showRightPanel = function (type) {
        const textEditor = document.getElementById('text-style-editor');
        const downloadPanel = document.getElementById('download-panel');

        if (type === 'edit') {
            if (textEditor) textEditor.style.display = 'block';
            if (downloadPanel) downloadPanel.style.display = 'none';
        } else {
            if (textEditor) textEditor.style.display = 'none';
            if (downloadPanel) downloadPanel.style.display = 'block';
        }
    };

    // 注意：保存按钮事件已在HTML中通过onclick="downloadImage()"绑定
    // 不再重复绑定，避免双重保存问题
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
        selectionColor: 'rgba(168, 85, 247, 0.15)', // 紫色背景
        selectionLineWidth: 1.5,
        selectionBorderColor: '#a855f7', // 紫色边框
        backgroundColor: 'transparent'
    });

    // ========== 全局样式覆盖 (彻底紫色化) ==========
    fabric.Object.prototype.set({
        borderColor: '#a855f7',
        cornerColor: '#a855f7',
        cornerSize: 10,
        transparentCorners: false,
        selectionBackgroundColor: 'rgba(168, 85, 247, 0.1)'
    });

    // 专门针对多选框的样式
    fabric.ActiveSelection.prototype.set({
        borderColor: '#a855f7',
        cornerColor: '#a855f7',
        cornerSize: 10,
        transparentCorners: false,
        selectionBackgroundColor: 'rgba(168, 85, 247, 0.1)'
    });

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

        // ========== 画布吸附 (仅上下居中) ==========
        const canvasCenterX = canvasWidth / 2;
        const canvasCenterY = canvasHeight / 2;

        let snappedX = false;
        let snappedY = false;

        // 画布垂直居中吸附 (Y轴) - 用户点名保留
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
        const padding = 10;
        // 限制左边
        if (obj.left < padding) {
            obj.set('left', padding);
        }
        // 限制顶边
        if (obj.top < padding) {
            obj.set('top', padding);
        }
        // 限制右边
        if (obj.left + objWidth > canvasWidth - padding) {
            // 如果宽度已经在限制范围内，限制位移
            if (objWidth <= canvasWidth - 2 * padding) {
                obj.set('left', canvasWidth - objWidth - padding);
            } else {
                // 如果宽度太大，靠左对齐并强制缩减宽度 (这种情况通常发生在同步长文本时)
                obj.set('left', padding);
                obj.set('width', (canvasWidth - 2 * padding) / obj.scaleX);
            }
        }
        // 限制底边
        if (obj.top + objHeight > canvasHeight - padding) {
            if (objHeight <= canvasHeight - 2 * padding) {
                obj.set('top', canvasHeight - objHeight - padding);
            } else {
                obj.set('top', padding);
            }
        }

        obj.setCoords();
    });

    // 移动结束时移除辅助线
    canvas.on('object:modified', function () {
        removeSnapLines();
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

    // 添加键盘快捷键
    document.addEventListener('keydown', function (e) {
        if (e.ctrlKey) {
            if (e.key === 'a') {
                e.preventDefault();
                if (canvas) {
                    canvas.discardActiveObject();
                    const objects = canvas.getObjects().filter(obj =>
                        obj.type === 'textbox' || obj.type === 'i-text'
                    );
                    if (objects.length > 0) {
                        const selection = new fabric.ActiveSelection(objects, { canvas: canvas });
                        canvas.setActiveObject(selection);
                        canvas.requestRenderAll();
                    }
                }
            }
        }
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

            try {
                const formData = new FormData();
                formData.append('image', img.file);
                formData.append('source_lang', document.getElementById('source-lang').value);
                formData.append('target_lang', lang.code);
                // 获取选中的背景处理模型
                const bgModelRadio = document.querySelector('input[name="bg-model"]:checked');
                formData.append('bg_model', bgModelRadio ? bgModelRadio.value : 'opencv');

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
            const pct = (completed / totalTasks) * 100;
            batchBar.style.width = `${pct}%`;
            batchText.innerText = `${completed}/${totalTasks}`;
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
    statusElem.textContent = `批量处理完成！已翻译 ${queue.length} 张图片 × ${selectedLangs.length} 种语言`;

    // 🔑 渲染下载按钮
    renderDownloadButtons();
    renderMultiLangThumbnails();
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

    // 🔑 关键修复：切换前先保存当前画布状态！
    // 但如果有同步锁，不要保存（避免覆盖同步后的数据）
    if (canvas && appState.currentLang && appState.currentIndex >= 0 && !appState.syncLock) {
        const currentLangData = appState.translations[appState.currentLang];
        if (currentLangData && currentLangData.images[appState.currentIndex]) {
            currentLangData.images[appState.currentIndex].canvasData = canvas.toJSON([
                'left', 'top', 'width', 'height', 'scaleX', 'scaleY', 'angle',
                'selectable', 'hasControls', 'originalStyle', 'padding', 'borderColor',
                'cornerColor', 'cornerSize', 'transparentCorners', 'splitByGrapheme',
                'breakWords', 'lockScalingFlip', 'fontSize', 'fontFamily', 'fontWeight',
                'fontStyle', 'fill', 'stroke', 'strokeWidth', 'textAlign', 'charSpacing', 'lineHeight'
            ]);
            console.log('✅ 切换语言前保存画布状态:', appState.currentLang, appState.currentIndex);
        }
    } else if (appState.syncLock) {
        console.log('🔒 同步锁激活，跳过保存当前画布状态');
    }

    appState.currentLang = langCode;
    appState.currentIndex = 0;

    // 🔑 切换语言时清空撤销历史（防止撤销到其他语言的状态）
    if (history && typeof history.clear === 'function') {
        history.clear();
    }

    // 重新渲染标签和缩略图
    const selectedLangs = Object.keys(appState.translations).map(code => ({
        code,
        name: appState.translations[code].name
    }));
    renderLangTabs(selectedLangs);
    renderMultiLangThumbnails();

    // 加载第一张该语言的图片
    if (appState.translations[langCode].images.length > 0) {
        // 🔑 调试：检查目标语言的 canvasData 状态
        const targetImg = appState.translations[langCode].images[0];
        console.log(`🔍 切换到 ${langCode}，目标图片 canvasData:`, {
            hasData: !!targetImg?.canvasData,
            objectsCount: targetImg?.canvasData?.objects?.length || 0,
            firstText: targetImg?.canvasData?.objects?.[0]?.text?.substring(0, 30)
        });
        loadMultiLangImageToCanvas(langCode, 0);
    }
}

// 🔑 加载多语言版本图片到画布 - 优化版
async function loadMultiLangImageToCanvas(langCode, index) {
    const langData = appState.translations[langCode];
    if (!langData || !langData.images[index]) return;

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
        // 显示所有文本框的字号
        const allFontSizes = imgObj.canvasData.objects
            .filter(o => o.type === 'textbox')
            .map(o => o.fontSize);
        console.log(`📦 canvasData 详情: fontSizes=[${allFontSizes.join(', ')}]`);

        // 🔑 先加载背景
        await loadImageToCanvas(bgImageUrl);

        // 从保存的数据中恢复文字对象
        await new Promise((resolve) => {
            const savedObjects = imgObj.canvasData.objects;

            // 清除当前所有非背景对象
            const objectsToRemove = canvas.getObjects().filter(obj => obj !== canvas.backgroundImage);
            objectsToRemove.forEach(obj => canvas.remove(obj));
            console.log(`🗑️ 已清除 ${objectsToRemove.length} 个旧对象`);

            // 从JSON恢复对象
            fabric.util.enlivenObjects(savedObjects, function (enlivenedObjects) {
                console.log(`✨ 反序列化了 ${enlivenedObjects.length} 个对象`);
                enlivenedObjects.forEach((obj, i) => {
                    console.log(`  对象${i}: fontSize=${obj.fontSize}, fill=${obj.fill}, text=${obj.text?.substring(0, 20)}`);
                    // 🔑 强制覆盖颜色样式为紫色 (以防加载的是旧数据)
                    if (obj.type === 'textbox' || obj.type === 'i-text') {
                        obj.set({
                            borderColor: '#a855f7',
                            cornerColor: '#a855f7',
                            cornerSize: 10,
                            transparentCorners: false
                        });
                    }
                    canvas.add(obj);
                });
                canvas.renderOnAddRemove = true;
                canvas.renderAll();
                console.log("✅ 画布状态恢复完成");
                resolve();
            });
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

    // 🔑 只在首次加载时保存初始状态（避免覆盖用户修改）
    if (!imgObj.canvasData) {
        saveInitialState();
        imgObj.canvasData = canvas.toJSON([
            'left', 'top', 'width', 'height', 'scaleX', 'scaleY', 'angle',
            'selectable', 'hasControls', 'originalStyle', 'padding', 'borderColor',
            'cornerColor', 'cornerSize', 'transparentCorners', 'splitByGrapheme',
            'breakWords', 'lockScalingFlip', 'fontSize', 'fontFamily', 'fontWeight',
            'fontStyle', 'fill', 'stroke', 'strokeWidth', 'textAlign', 'charSpacing', 'lineHeight'
        ]);
        console.log('✅ 初始画布状态已保存:', langCode, index);
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
                // 🔑 切换前保存当前画布状态（包含完整属性）
                // 但如果有同步锁，不要保存（避免覆盖同步后的数据）
                if (canvas && appState.currentLang && appState.currentIndex >= 0 && !appState.syncLock) {
                    const currentLangData = appState.translations[appState.currentLang];
                    if (currentLangData && currentLangData.images[appState.currentIndex]) {
                        currentLangData.images[appState.currentIndex].canvasData = canvas.toJSON([
                            'left', 'top', 'width', 'height', 'scaleX', 'scaleY', 'angle',
                            'selectable', 'hasControls', 'originalStyle', 'padding', 'borderColor',
                            'cornerColor', 'cornerSize', 'transparentCorners', 'splitByGrapheme',
                            'breakWords', 'lockScalingFlip', 'fontSize', 'fontFamily', 'fontWeight',
                            'fontStyle', 'fill', 'stroke', 'strokeWidth', 'textAlign', 'charSpacing', 'lineHeight'
                        ]);
                        console.log('✅ 保存画布状态:', appState.currentLang, appState.currentIndex);
                    }
                } else if (appState.syncLock) {
                    console.log('🔒 同步锁激活，跳过保存当前画布状态');
                }
                appState.currentIndex = index;
                // 🔑 切换图片时清空撤销历史
                if (history && typeof history.clear === 'function') {
                    history.clear();
                }
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
                        border-top: 3px solid #a855f7;
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
                    // canvasElement.style.maxWidth = 'none';
                    // canvasElement.style.maxHeight = 'none';
                }

                // 自动适应屏幕
                if (typeof fitToScreen === 'function') {
                    fitToScreen();
                } else {
                    // 如果函数还没定义，尝试模拟点击适应按钮
                    setTimeout(() => {
                        const zoomFitBtn = document.getElementById('zoomFit');
                        if (zoomFitBtn) zoomFitBtn.click();
                    }, 100);
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
            strokeWidth: 0.3, // 微弱描边增加锐度
            stroke: textObj.fill, // 使用填充色
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
        borderColor: '#a855f7',
        cornerColor: '#a855f7',
        cornerSize: 10,
        transparentCorners: false,
        selectable: true,
        editable: true,
        splitByGrapheme: true,
        breakWords: true
    });

    // ========== 🧱 边缘生成检查 ==========
    const padding = 20;
    const canvasWidth = canvas.width;
    const canvasHeight = canvas.height;
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
        borderColor: '#a855f7',
        cornerColor: '#a855f7',
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

    console.log(`开始绘制${textPositions.length}个文本框`);

    // 清除现有文本
    canvas.getObjects().forEach(obj => {
        if (obj.type === 'textbox' || obj.type === 'i-text') {
            canvas.remove(obj);
        }
    });

    // 直接绘制，使用后端提供的样式
    textPositions.forEach((item, index) => {
        let translatedText = "";

        // 获取翻译文本
        if (translations && translations[index]) {
            translatedText = translations[index];
        } else if (item.text) {
            translatedText = item.text;
        }

        if (!translatedText) {
            console.warn(`文本 #${index} 没有翻译内容`);
            return;
        }

        try {
            // 🔑 使用通用函数绘制，确保一致性
            addTextboxToCanvas(canvas, item, translatedText, index);
        } catch (e) {
            console.error(`绘制文本框 #${index} 失败:`, e);
        }
    });

    canvas.renderAll();

    // 保存初始状态到历史记录
    if (history && typeof history.saveState === 'function') {
        setTimeout(() => history.saveState(), 500);
    }
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
    const resultEmpty = document.getElementById('result-empty');
    if (originalEmpty && addedCount > 0) originalEmpty.style.display = 'none';
    // 结果区域的占位符在翻译完成后隐藏（在loadProcessedImageToCanvas中）

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
            currentImg.canvasData = canvas.toJSON();
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

            // 4. 加载结果 (如果有)
            if (nextImg.status === 'done' && nextImg.result) {
                try {
                    await loadProcessedImageToCanvas(nextImg);

                    // 🔑 自动选中第一个文本框 (优化体验)
                    if (canvas) {
                        const texts = canvas.getObjects('textbox');
                        if (texts && texts.length > 0) {
                            // 选中第一个
                            canvas.setActiveObject(texts[0]);
                            canvas.renderAll();
                        }
                    }
                } catch (e) {
                    console.error("加载已处理图片失败", e);
                }
            } else {
                // 未处理：隐藏画布，显示原图
                document.getElementById('fabricCanvasContainer').style.display = 'none';
                // 隐藏编辑面板
                const textStyleEditor = document.getElementById('text-style-editor');
                const savePanel = document.getElementById('save-panel');
                const tipCard = document.getElementById('tipCard');

                if (textStyleEditor) textStyleEditor.style.display = 'none';
                if (savePanel) savePanel.style.display = 'none';
                if (tipCard) tipCard.style.display = 'block';
            }
            resolve();
        };
        tempImg.src = nextImg.url;
    });
}

// 渲染缩略图栏
function renderThumbnails() {
    const container = document.getElementById('thumbnailArea');
    container.innerHTML = ''; // 清空

    appState.images.forEach((img, index) => {
        const div = document.createElement('div');

        // 🔑 根据状态添加class
        let className = 'thumbnail';
        if (index === appState.currentIndex) className += ' active';
        if (img.status === 'processing' || img.status === 'pending') {
            className += ' processing'; // 灰色+转圈+禁用点击
        }
        div.className = className;

        div.style.position = 'relative';

        // 🔑 只有done状态才能点击
        if (img.status === 'done') {
            div.onclick = () => switchImage(index);
            div.style.cursor = 'pointer';
        } else {
            div.onclick = null;
            div.style.cursor = 'not-allowed';
        }

        div.title = img.file.name + (img.status === 'processing' ? ' (处理中...)' : img.status === 'pending' ? ' (等待处理)' : '');

        const image = document.createElement('img');
        image.src = img.url;
        image.style.width = '100%';
        image.style.height = '100%';
        image.style.objectFit = 'cover';
        image.style.borderRadius = '10px';

        div.appendChild(image);

        // 添加删除按钮 (X icon)
        const deleteBtn = document.createElement('div');
        deleteBtn.innerHTML = '×';
        deleteBtn.style.position = 'absolute';
        deleteBtn.style.top = '4px';
        deleteBtn.style.right = '4px';
        deleteBtn.style.width = '20px';
        deleteBtn.style.height = '20px';
        deleteBtn.style.borderRadius = '50%';
        deleteBtn.style.background = 'rgba(239, 68, 68, 0.9)'; // 红色背景
        deleteBtn.style.color = 'white';
        deleteBtn.style.display = 'flex';
        deleteBtn.style.alignItems = 'center';
        deleteBtn.style.justifyContent = 'center';
        deleteBtn.style.fontSize = '16px';
        deleteBtn.style.fontWeight = 'bold';
        deleteBtn.style.cursor = 'pointer';
        deleteBtn.style.opacity = '0';
        deleteBtn.style.transition = 'opacity 0.2s';
        deleteBtn.style.zIndex = '10';
        deleteBtn.title = '删除此图片';

        // 悬停时显示删除按钮
        div.addEventListener('mouseenter', () => {
            deleteBtn.style.opacity = '1';
        });
        div.addEventListener('mouseleave', () => {
            deleteBtn.style.opacity = '0';
        });

        // 删除按钮点击事件
        deleteBtn.onclick = (e) => {
            e.stopPropagation(); // 阻止触发缩略图点击
            deleteImage(index);
        };

        div.appendChild(deleteBtn);

        // 状态角标
        const badge = document.createElement('div');
        badge.style.position = 'absolute';
        badge.style.right = '4px';
        badge.style.bottom = '4px';
        badge.style.width = '10px';
        badge.style.height = '10px';
        badge.style.borderRadius = '50%';
        badge.style.border = '2px solid white';

        if (img.status === 'done') {
            badge.style.background = '#10b981'; // Green
            div.appendChild(badge);
        } else if (img.status === 'processing') {
            badge.style.background = '#f59e0b'; // Orange
            // 添加旋转动画
            badge.style.borderRadius = '0';
            badge.style.width = '12px';
            badge.style.height = '12px';
            badge.style.border = '2px solid #f59e0b';
            badge.style.borderTopColor = 'transparent';
            badge.style.borderRadius = '50%';
            badge.style.animation = 'spin 1s linear infinite';
            div.appendChild(badge);
        } else if (img.status === 'error') {
            badge.style.background = '#ef4444'; // Red
            div.appendChild(badge);
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

// 🔑 单张下载功能 - 保存当前画布（精确导出）
async function downloadImage() {
    console.log('downloadImage() 被调用');

    if (!canvas) {
        alert('没有可下载的图片');
        console.error('canvas is null');
        return;
    }

    try {
        // 尝试获取当前图片的原始文件名
        let filename = 'image_' + Date.now() + '.png';

        // 如果在多语言模式，尝试获取原始文件名（保持原名，只改扩展名为png）
        if (appState.translations && appState.currentLang) {
            const langData = appState.translations[appState.currentLang];
            if (langData && langData.images && langData.images[appState.currentIndex]) {
                const imgObj = langData.images[appState.currentIndex];
                if (imgObj.originalImg && imgObj.originalImg.file) {
                    // 🔑 修复：保持原始文件名，只将扩展名改为 .png
                    filename = imgObj.originalImg.file.name.replace(/\.[^.]+$/, '.png');
                }
            }
        }

        // 🔑 方案：将画布内容绘制到一个2D canvas上导出
        // 这样可以避免fabric.js的multiplier问题
        const originalWidth = window.originalImageWidth || canvas.getWidth();
        const originalHeight = window.originalImageHeight || canvas.getHeight();
        const scale = originalWidth / canvas.getWidth();

        console.log('导出参数:', {
            canvasWidth: canvas.getWidth(),
            canvasHeight: canvas.getHeight(),
            originalWidth: originalWidth,
            originalHeight: originalHeight,
            scale: scale
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

        // 导出
        const dataURL = tempCanvas.toDataURL('image/png');

        const link = document.createElement('a');
        link.download = filename;
        link.href = dataURL;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        console.log('✅ 下载成功:', filename);
    } catch (e) {
        console.error('下载失败:', e);
        alert('下载失败: ' + e.message);
    }
}

// 批量下载功能 - 支持多语言模式
async function downloadAllImages() {
    console.log('downloadAllImages() 被调用');

    // 检查是否有多语言翻译数据
    const hasMultiLang = appState.translations && Object.keys(appState.translations).length > 0;
    console.log('多语言模式:', hasMultiLang, '翻译数据:', appState.translations);

    // 🔑 先保存当前画布状态
    if (canvas && appState.currentLang && appState.currentIndex >= 0) {
        const currentLangData = appState.translations[appState.currentLang];
        if (currentLangData && currentLangData.images[appState.currentIndex]) {
            currentLangData.images[appState.currentIndex].canvasData = canvas.toJSON();
            console.log('✅ 批量下载前保存画布状态:', appState.currentLang, appState.currentIndex);
        }
    }

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

    } catch (e) {
        alert("打包下载失败: " + e.message);
        console.error(e);
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

// 直接下载功能 - 不打包成ZIP，直接触发多次浏览器下载
async function downloadDirectly() {
    console.log('downloadDirectly() 被调用');

    const hasMultiLang = appState.translations && Object.keys(appState.translations).length > 0;

    // 保存当前状态
    if (canvas && appState.currentLang && appState.currentIndex >= 0) {
        const currentLangData = appState.translations[appState.currentLang];
        if (currentLangData && currentLangData.images[appState.currentIndex]) {
            currentLangData.images[appState.currentIndex].canvasData = canvas.toJSON();
        }
    }

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
    const sourceJSON = canvas.toJSON([
        'left', 'top', 'width', 'height', 'scaleX', 'scaleY', 'angle',
        'selectable', 'hasControls', 'originalStyle', 'padding', 'borderColor',
        'cornerColor', 'cornerSize', 'transparentCorners', 'splitByGrapheme',
        'breakWords', 'lockScalingFlip', 'fontSize', 'fontFamily', 'fontWeight',
        'fontStyle', 'fill', 'stroke', 'strokeWidth', 'textAlign', 'charSpacing', 'lineHeight'
    ]);

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

                            // 🔑 锚点逻辑：根据对齐方式决定扩展方向
                            if (obj.textAlign === 'right') {
                                // 右对齐：向左扩展 (保持右边缘不变)
                                obj.left -= deltaWidth;
                            } else if (obj.textAlign === 'center') {
                                // 居中对齐：向两边扩展 (保持中心不变)
                                obj.left -= deltaWidth / 2;
                            }
                            // 左对齐：向右扩展 (不需要改left)

                            // 🔑 边界约束：确保文本框渲染后不超出画布左右边界
                            const padding = 15;
                            const maxPossibleScaledWidth = canvasWidth - 2 * padding;

                            // 1. 宽度强制限制
                            if (newScaledWidth > maxPossibleScaledWidth) {
                                newScaledWidth = maxPossibleScaledWidth;
                                // 重新调整位置以适应最大宽度
                                if (obj.textAlign === 'right') {
                                    // 靠右边放
                                    obj.left = canvasWidth - padding - newScaledWidth;
                                } else if (obj.textAlign === 'center') {
                                    obj.left = (canvasWidth - newScaledWidth) / 2;
                                } else {
                                    obj.left = padding;
                                }
                            }

                            // 2. 左右边界检查与修正
                            // 左边界检查
                            if (obj.left < padding) {
                                obj.left = padding;
                            }
                            // 右边界检查
                            if (obj.left + newScaledWidth > canvasWidth - padding) {
                                obj.left = canvasWidth - padding - newScaledWidth;
                                // 二次检查左边界 (如果因为修正右边界导致左边界溢出)
                                if (obj.left < padding) {
                                    obj.left = padding;
                                    // 最后的手段：缩小宽度
                                    newScaledWidth = canvasWidth - 2 * padding;
                                }
                            }

                            obj.width = newScaledWidth / scaleX;
                            console.log(`  📐 智能扩展 (${obj.textAlign}): left=${obj.left.toFixed(1)}, width=${obj.width.toFixed(1)}`);
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
    const sourceJSON = canvas.toJSON([
        'left', 'top', 'width', 'height', 'scaleX', 'scaleY', 'angle',
        'selectable', 'hasControls', 'originalStyle', 'padding', 'borderColor',
        'cornerColor', 'cornerSize', 'transparentCorners', 'splitByGrapheme',
        'breakWords', 'lockScalingFlip', 'fontSize', 'fontFamily', 'fontWeight',
        'fontStyle', 'fill', 'stroke', 'strokeWidth', 'textAlign', 'charSpacing', 'lineHeight'
    ]);

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

                                    // 🔹 锚点调整
                                    if (obj.textAlign === 'right') {
                                        obj.left -= deltaWidth;
                                    } else if (obj.textAlign === 'center') {
                                        obj.left -= deltaWidth / 2;
                                    }

                                    // 🧱 边界约束
                                    const padding = 15;
                                    const maxPossibleScaledWidth = canvasWidth - 2 * padding;

                                    // 1. 宽度限制
                                    if (newScaledWidth > maxPossibleScaledWidth) {
                                        newScaledWidth = maxPossibleScaledWidth;
                                        if (obj.textAlign === 'right') obj.left = canvasWidth - padding - newScaledWidth;
                                        else if (obj.textAlign === 'center') obj.left = (canvasWidth - newScaledWidth) / 2;
                                        else obj.left = padding;
                                    }

                                    // 2. 只有位置溢出时才推
                                    if (obj.left < padding) obj.left = padding;
                                    if (obj.left + newScaledWidth > canvasWidth - padding) {
                                        obj.left = canvasWidth - padding - newScaledWidth;
                                        if (obj.left < padding) {
                                            obj.left = padding;
                                            newScaledWidth = canvasWidth - 2 * padding;
                                        }
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

        const btn = document.createElement('button');
        btn.className = 'action-btn secondary';
        btn.style.cssText = 'padding: 8px 12px; font-size: 12px;';
        btn.innerHTML = `📦 ${langData.name} (${doneCount}张)`;
        btn.onclick = (e) => downloadByLang(langCode, e.currentTarget);
        if (btnsDiv) btnsDiv.appendChild(btn);
    });
}

// 🔑 按语言下载 - 使用离屏渲染确保每张图正确
async function downloadByLang(langCode, btnElement) {
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

    const btn = btnElement;
    const originalText = btn.innerHTML;
    btn.innerHTML = '打包中...';
    btn.disabled = true;

    try {
        const zip = new JSZip();
        // 🔑 不再创建文件夹，直接放图片
        // const folder = zip.folder(`${langData.name}_translated`);

        for (let i = 0; i < doneImages.length; i++) {
            const imgObj = doneImages[i];
            btn.innerHTML = `导出中 ${i + 1}/${doneImages.length}`;

            try {
                // 🔑 使用离屏canvas导出，避免主canvas干扰
                const dataURL = await exportImageOffscreen(imgObj);
                if (dataURL) {
                    const base64Data = dataURL.replace(/^data:image\/(png|jpg);base64,/, "");
                    const fileName = imgObj.originalImg ? imgObj.originalImg.file.name : `image_${i}.png`;
                    // 🔑 直接在根目录添加文件，不再创建子文件夹 (用户需求)
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
                const canvasJSON = tempCanvas.toJSON();
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
                        fabric.util.enlivenObjects(imgObj.canvasData.objects, (enlivenedObjects) => {
                            enlivenedObjects.forEach(obj => {
                                tempCanvas.add(obj);
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
                        });
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

    // 保存图片逻辑
    const saveBtn = document.getElementById('save-image');
    if (saveBtn) {
        saveBtn.addEventListener('click', function () {
            if (!canvas) return;

            // 取消所有选中，确保保存时不显示选中框
            canvas.discardActiveObject();
            canvas.renderAll();

            try {
                // 使用 multiplier: 1 导出原始尺寸
                // 因为我们缩放使用的是CSS style，Fabric内部画布保持原分辨率
                const dataURL = canvas.toDataURL({
                    format: 'png',
                    quality: 1,
                    multiplier: 1
                });

                const link = document.createElement('a');
                link.download = currentFilename; // 使用原始文件名
                link.href = dataURL;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
            } catch (e) {
                console.error("保存图片失败", e);
                alert("保存图片失败: " + e.message);
            }
        });
    }
    // 注意：文件上传事件已在上方 DOMContentLoaded 中绑定 (lines 125-164)
    // 此处不再重复绑定，避免双倍上传问题

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
