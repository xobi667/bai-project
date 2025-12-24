from flask import Flask, render_template, request, jsonify, send_from_directory
import requests
import base64
import os
import uuid
import json
import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from datetime import datetime
import random
import hashlib
import io
import time
import logging
import shutil
import sys

# 修改为清华镜像
os.environ['HF_ENDPOINT'] = 'https://mirrors.tuna.tsinghua.edu.cn/hugging-face'
os.environ['HF_HOME'] = './models'  # 设置模型缓存目录

# 🔑 PyInstaller 打包兼容：获取正确的基础路径
def get_base_path():
    """获取应用的基础路径，兼容开发环境和打包后的EXE"""
    if getattr(sys, 'frozen', False):
        # 打包后的EXE环境
        return sys._MEIPASS
    else:
        # 开发环境
        return os.path.dirname(os.path.abspath(__file__))

BASE_PATH = get_base_path()

# 配置上传和输出文件夹
# 这些文件夹需要在当前工作目录创建（而不是在打包目录）
WORK_DIR = os.getcwd() if getattr(sys, 'frozen', False) else os.path.dirname(os.path.abspath(__file__))
UPLOAD_FOLDER = os.path.join(WORK_DIR, 'uploads')
OUTPUT_FOLDER = os.path.join(WORK_DIR, 'outputs')
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(OUTPUT_FOLDER, exist_ok=True)

# 🔑 Flask 初始化时指定模板和静态文件的路径
app = Flask(__name__, 
            template_folder=os.path.join(BASE_PATH, 'templates'),
            static_folder=os.path.join(BASE_PATH, 'static'))
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['OUTPUT_FOLDER'] = OUTPUT_FOLDER

# 添加全局会话数据存储
session_data = {}

# 日志配置 (logging已在顶部导入)
logging.basicConfig(level=logging.INFO, 
                   format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class Translator:
    def __init__(self, source_lang="zh", target_lang="en"):
        self.source_lang = source_lang
        self.target_lang = target_lang
        self.url = "https://translate.googleapis.com/translate_a/single"
        
    def translate(self, texts):
        translated_texts = []
        for text in texts:
            try:
                if not text.strip():
                    translated_texts.append(text)
                    continue
                
                # 使用 Google 翻译网页 API
                params = {
                    'client': 'gtx',
                    'sl': self.source_lang,  # source language
                    'tl': self.target_lang,  # target language
                    'dt': 't',               # return type: translation
                    'q': text                # text to translate
                }
                
                response = requests.get(self.url, params=params)
                if response.status_code == 200:
                    # Google 翻译返回的是嵌套列表，我们需要提取翻译文本
                    result = response.json()
                    translated_text = ''.join([item[0] for item in result[0]])
                    translated_texts.append(translated_text)
                    print(f"翻译成功: {text} -> {translated_text}")
                else:
                    print(f"翻译失败: {text}")
                    translated_texts.append(text)
                    
            except Exception as e:
                print(f"翻译出错: {str(e)}")
                translated_texts.append(text)
                
        return translated_texts

@app.route('/')
def index():
    # 确保所有目录存在（在工作目录下）
    os.makedirs(os.path.join(WORK_DIR, 'static', 'uploads'), exist_ok=True)
    os.makedirs(os.path.join(WORK_DIR, 'static', 'output'), exist_ok=True)
    return render_template('test.html')

# 🔑 PyInstaller 兼容：服务 static/uploads 文件夹下的文件
@app.route('/static/uploads/<path:filename>')
def serve_uploads(filename):
    uploads_dir = os.path.join(WORK_DIR, 'static', 'uploads')
    return send_from_directory(uploads_dir, filename)

# 🔑 PyInstaller 兼容：服务 static/output 文件夹下的文件  
@app.route('/static/output/<path:filename>')
def serve_output(filename):
    output_dir = os.path.join(WORK_DIR, 'static', 'output')
    return send_from_directory(output_dir, filename)

@app.route('/ocr', methods=['POST'])
def ocr():
    try:
        if 'image' not in request.files:
            return jsonify({'error': '没有上传图片'})
            
        image_file = request.files['image']
        source_lang = request.form.get('source_lang', 'all')
        
        # 保存上传的图片
        filename = str(uuid.uuid4()) + os.path.splitext(image_file.filename)[1]
        filepath = os.path.join(UPLOAD_FOLDER, filename)
        image_file.save(filepath)
        
        # 读取图片并转为 base64
        with open(filepath, 'rb') as f:
            base64_data = base64.b64encode(f.read()).decode()
        
        # 发送到 Umi-OCR
        response = requests.post(
            "http://127.0.0.1:1224/api/ocr",
            json={"base64": base64_data}
        )
        
        result = response.json()
        
        # 根据选择的语言过滤结果
        if result['code'] == 100 and source_lang != 'all':
            filtered_data = []
            for item in result['data']:
                text = item['text'].strip()
                if source_lang == 'zh':
                    # 中文模式：只保留包含中文的文本
                    if any('\u4e00' <= c <= '\u9fff' for c in text):
                        filtered_data.append(item)
                elif source_lang == 'en':
                    # 英文模式：保留包含英文字母的文本，可以包含数字和标点
                    if any(c.isalpha() for c in text) and not any('\u4e00' <= c <= '\u9fff' for c in text):
                        filtered_data.append(item)
            
            print(f"过滤前数量: {len(result['data'])}")
            print(f"过滤后数量: {len(filtered_data)}")
            print(f"过滤后文本: {[item['text'] for item in filtered_data]}")
            
            result['data'] = filtered_data
            
        return jsonify(result)
        
    except Exception as e:
        print(f"处理失败: {str(e)}")
        return jsonify({'error': str(e)})

@app.route('/remove_text', methods=['POST'])
def remove_text():
    try:
        if 'image' not in request.files:
            return jsonify({'success': False, 'error': '没有上传图片'})
            
        image_file = request.files['image']
        boxes = request.form.get('boxes', '[]')
        
        # 保存上传的图片
        filename = str(uuid.uuid4()) + os.path.splitext(image_file.filename)[1]
        filepath = os.path.join(UPLOAD_FOLDER, filename)
        mask_path = os.path.join(UPLOAD_FOLDER, f'mask_{filename}')
        output_path = os.path.join(OUTPUT_FOLDER, f'removed_{filename}')
        image_file.save(filepath)
        
        # 读取图片和框选数据
        image = cv2.imread(filepath)
        if image is None:
            raise Exception("无法读取图片")
            
        # --- 精准蒙版生成逻辑 (视频精髓：边缘检测+自适应阈值) ---
        mask = np.zeros(image.shape[:2], dtype=np.uint8)
        boxes_data = json.loads(boxes)
        
        # 保存调试用的蒙版
        debug_dir = os.path.join('static', 'debug')
        os.makedirs(debug_dir, exist_ok=True)
        
        for box_item in boxes_data:
            # 1. 提取框选区域 (ROI)
            points = np.array(box_item['box']).astype(np.int32)
            x, y, w, h = cv2.boundingRect(points)
            
            # 边界检查
            y_start, y_end = max(0, y), min(image.shape[0], y+h)
            x_start, x_end = max(0, x), min(image.shape[1], x+w)
            
            roi = image[y_start:y_end, x_start:x_end]
            if roi.size == 0: continue
            
            # --- 核心修改：适配Diffusion/PowerPaint模型 ---
            # 之前用的 Canny 边缘检测会导致生成的 Mask 是破碎的笔画
            # 这对 Diffusion 模型是灾难（它会试图保留笔画间的缝隙，导致效果像涂抹）
            # PowerPaint 需要一个完整的“空洞”来重新生成背景
            # 所以这里直接填充整个文本框！
            
            
            cv2.fillPoly(mask, [points], 255)
            
            # 膨胀Mask以覆盖边缘锯齿和残留 (5x5 kernel)
            kernel = np.ones((5, 5), np.uint8)
            mask = cv2.dilate(mask, kernel, iterations=1)

            # (原Canny逻辑已移除以提升PowerPaint效果)
        
        # 保存调试蒙版
        debug_mask_path = os.path.join(debug_dir, f'debug_mask_{filename}.png')
        cv2.imwrite(debug_mask_path, mask)
        print(f"调试蒙版已保存: {debug_mask_path}")
        
        # 保存掩码图片
        cv2.imwrite(mask_path, mask)
        
        # 读取图片和掩码为 base64
        with open(filepath, 'rb') as img_file, open(mask_path, 'rb') as mask_file:
            img_base64 = base64.b64encode(img_file.read()).decode()
            mask_base64 = base64.b64encode(mask_file.read()).decode()
            
            # 准备 JSON 数据请求 IOPaint (适应PowerPaint)
            data = {
                'image': f'data:image/png;base64,{img_base64}',
                'mask': f'data:image/png;base64,{mask_base64}',
                'sd_steps': 40, # 稍微增加步数提升质量
                'prompt': '',   # PowerPaint去除模式通常不需prompt
                'negative_prompt': 'text, watermark, writing, letters, signature', # 负面提示词确保不去生成文字
            }
            
            response = requests.post(
                "http://127.0.0.1:8080/api/v1/inpaint",
                json=data,
                headers={'Content-Type': 'application/json'},
                timeout=600 # 增加超时到10分钟，适应CPU跑大模型
            )
            
        if response.status_code == 200:
            # 获取修复后的图像数据
            nparr = np.frombuffer(response.content, np.uint8)
            inpainted_img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            
            # --- 高斯模糊融合处理 (视频最后一步技巧) ---
            # 只对有蒙版的区域边缘进行微弱的高斯模糊，让效果更自然
            mask_dilated = cv2.dilate(mask, np.ones((5,5), np.uint8), iterations=1)
            blurred_img = cv2.GaussianBlur(inpainted_img, (3, 3), 0)
            
            # 使用膨胀后的蒙版作为权重，将模糊后的边缘融合回原图
            # 这能有效消除局部修复导致的接缝感
            mask_3c = cv2.cvtColor(mask_dilated, cv2.COLOR_GRAY2BGR) / 255.0
            final_img = (inpainted_img * (1 - mask_3c * 0.3) + blurred_img * (mask_3c * 0.3)).astype(np.uint8)
            
            cv2.imwrite(output_path, final_img)
            
            # 清理临时文件
            try:
                if os.path.exists(mask_path): os.remove(mask_path)
                if os.path.exists(filepath): os.remove(filepath)
            except: pass
            
            return jsonify({
                'success': True,
                'result_url': f'/output/{os.path.basename(output_path)}'
            })
        else:
            raise Exception(f"IOPaint 错误: 状态码 {response.status_code}")
            
    except Exception as e:
        print(f"处理失败: {str(e)}")
        return jsonify({'success': False, 'error': str(e)})

@app.route('/output/<filename>')
def output_file(filename):
    return send_from_directory(OUTPUT_FOLDER, filename)

@app.route('/save_training_data', methods=['POST'])
def save_training_data():
    try:
        data = request.json
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        
        # 创建训练数据目录
        training_dir = os.path.join('training_data', timestamp)
        os.makedirs(training_dir, exist_ok=True)
        
        # 保存原始图片
        original_img = data.get('original_image')
        if original_img:
            original_path = os.path.join(training_dir, 'original.png')
            with open(original_path, 'wb') as f:
                f.write(base64.b64decode(original_img.split(',')[1]))
        
        # 保存文字标注信息
        annotations = data.get('annotations', [])
        annotation_path = os.path.join(training_dir, 'annotations.json')
        with open(annotation_path, 'w', encoding='utf-8') as f:
            json.dump(annotations, f, ensure_ascii=False, indent=2)
        
        # 保存处理后的图片
        result_img = data.get('result_image')
        if result_img:
            result_path = os.path.join(training_dir, 'result.png')
            with open(result_path, 'wb') as f:
                f.write(base64.b64decode(result_img.split(',')[1]))
        
        return jsonify({
            'success': True,
            'message': '训练数据保存成功',
            'data': {
                'timestamp': timestamp,
                'path': training_dir
            }
        })
        
    except Exception as e:
        print(f"保存训练数据失败: {str(e)}")
        return jsonify({
            'success': False,
            'error': str(e)
        })

@app.route('/translate', methods=['POST'])
def translate():
    try:
        text = request.json.get('text', '')
        source_lang = request.json.get('source_lang', 'en')
        target_lang = request.json.get('target_lang', 'zh')
        
        # 使用百度翻译 API
        url = "https://fanyi-api.baidu.com/api/trans/vip/translate"
        appid = '20250212002271737'
        secret = 'Zk4vAc0eADjXtdWkE37l'
        salt = str(random.randint(32768, 65536))
        
        # 准备翻译请求
        params = {
            'q': text,
            'from': source_lang,
            'to': target_lang,
            'appid': appid,
            'salt': salt
        }
        
        # 计算签名
        sign = appid + text + salt + secret
        params['sign'] = hashlib.md5(sign.encode()).hexdigest()
        
        response = requests.get(url, params=params)
        result = response.json()
        
        if 'trans_result' in result:
            return jsonify({
                'success': True,
                'translated_text': result['trans_result'][0]['dst']
            })
        else:
            raise Exception(f"翻译失败: {result.get('error_msg', '未知错误')}")
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        })

def extract_text_style(image, box):
    """提取文本样式，确保颜色与原文一致"""
    try:
        # 计算边界框
        # 计算边界框 - 扩大范围以包含背景（用于颜色分析）
        padding = 5
        x_min = max(0, int(min([p[0] for p in box])) - padding)
        y_min = max(0, int(min([p[1] for p in box])) - padding)
        x_max = min(image.shape[1], int(max([p[0] for p in box])) + padding)
        y_max = min(image.shape[0], int(max([p[1] for p in box])) + padding)
        
        if x_max <= x_min or y_max <= y_min:
            raise ValueError("无效的文本区域")
        
        # 提取文本区域
        text_region = image[y_min:y_max, x_min:x_max]
        if text_region.size == 0:
            raise ValueError("文本区域为空")
        
        # 保存文本区域用于调试
        debug_dir = "static/debug"
        os.makedirs(debug_dir, exist_ok=True)
        debug_path = os.path.join(debug_dir, f"text_region_{int(time.time())}_{x_min}_{y_min}.png")
        cv2.imwrite(debug_path, text_region)
        print(f"已保存文本区域到 {debug_path} 用于调试")
        
        # 转换为RGB用于更准确的颜色分析
        if len(text_region.shape) == 2:  # 灰度图像
            text_region = cv2.cvtColor(text_region, cv2.COLOR_GRAY2RGB)
        elif text_region.shape[2] == 3:  # BGR图像
            rgb_region = cv2.cvtColor(text_region, cv2.COLOR_BGR2RGB)
        else:
            rgb_region = text_region
        
        # 1. 使用更精确的颜色提取算法
        
        # 1. 智能颜色分析 - 使用K-Means聚类 (K=2)
        # 假设文本框内主要由文字颜色和背景颜色组成
        # 并且背景颜色通常出现在边缘
        
        # 定义 gray 变量，供后续逻辑使用
        if len(rgb_region.shape) == 3:
            gray = cv2.cvtColor(rgb_region, cv2.COLOR_RGB2GRAY)
        else:
            gray = rgb_region.copy()

        # 修复逻辑依赖：生成 mask_dilated 和 bg_pixels，防止后续逻辑崩溃
        _, binary_mask = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
        mask_dilated = cv2.dilate(binary_mask, np.ones((3,3), np.uint8), iterations=1)
        bg_mask = mask_dilated == 0
        bg_pixels = rgb_region[bg_mask]

        pixels = rgb_region.reshape(-1, 3).astype(np.float32)
        
        # 提取边缘像素用于背景估计
        h, w = rgb_region.shape[:2]
        border_mask = np.zeros((h, w), dtype=bool)
        if h > 2 and w > 2:
            border_mask[0, :] = True
            border_mask[-1, :] = True
            border_mask[:, 0] = True
            border_mask[:, -1] = True
        
        border_pixels = rgb_region[border_mask].reshape(-1, 3).astype(np.float32)
        if len(border_pixels) > 0:
            bg_estimate = np.mean(border_pixels, axis=0)
        else:
            bg_estimate = np.mean(pixels, axis=0)
            
        # K-Means 聚类
        try:
            criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 10, 1.0)
            flags = cv2.KMEANS_RANDOM_CENTERS
            compactness, labels, centers = cv2.kmeans(pixels, 2, None, criteria, 10, flags)
            
            color1 = centers[0]
            color2 = centers[1]
            
            # 判断哪个是背景 (距离边缘颜色更近的)
            dist1 = np.linalg.norm(color1 - bg_estimate)
            dist2 = np.linalg.norm(color2 - bg_estimate)
            
            if dist1 > dist2:
                text_color = color1
                bg_color = color2
            else:
                text_color = color2
                bg_color = color1
                
        except Exception as e:
            print(f"K-Means失败, 回退到简单统计: {e}")
            text_color = np.array([0, 0, 0])
            bg_color = np.array([255, 255, 255])


        
        # 如果以上所有方法都失败，使用默认颜色
        if text_color is None:
            text_color = np.array([0, 0, 0])  # 默认黑色
        
        # 确保颜色是有效的RGB值
        text_color = np.clip(text_color, 0, 255).astype(np.uint8)
        
        # 🔑 修复：检查与背景的对比度，防止文字不可见
        # 使用边缘背景估计作为参考
        bg_reference = bg_estimate if 'bg_estimate' in locals() else np.array([255, 255, 255])
        
        # 计算亮度对比
        text_gray = 0.299 * text_color[0] + 0.587 * text_color[1] + 0.114 * text_color[2]
        bg_gray = 0.299 * bg_reference[0] + 0.587 * bg_reference[1] + 0.114 * bg_reference[2]
        
        if abs(text_gray - bg_gray) < 40:
            print(f"⚠️ 文字颜色对比度不足 ({abs(text_gray - bg_gray):.1f})，强制调整")
            if bg_gray > 128:
                text_color = np.array([0, 0, 0], dtype=np.uint8) # 亮背景 -> 黑色文字
            else:
                text_color = np.array([255, 255, 255], dtype=np.uint8) # 暗背景 -> 白色文字
        
        # 记录提取的颜色
        print(f"提取的文本颜色RGB: {text_color}")
        
        # 检测背景色
        bg_color = None
        if len(bg_pixels) > 10:
            # 使用K-means找出最主要的背景色
            pixels = bg_pixels.reshape(-1, 3).astype(np.float32)
            criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 200, 0.1)
            k = min(3, len(pixels) // 50 + 1)
            _, labels, centers = cv2.kmeans(pixels, k, None, criteria, 10, cv2.KMEANS_RANDOM_CENTERS)
            
            # 获取最大聚类的颜色
            hist = np.bincount(labels.flatten())
            bg_color = centers[np.argmax(hist)]
            
            # 检查背景色是否接近白色或透明
            bg_brightness = np.mean(bg_color)
            if bg_brightness > 240:  # 如果背景接近白色，则视为透明
                bg_color = None
        
        # 估计字体大小 - 使用更精确的计算方式
        font_size = max(int((y_max - y_min) * 0.85), 12)  # 提高比例到85%，确保文字大小更接近原文
        
        # 检测字体是否为粗体 - 使用更精确的算法
        stroke_width = 0
        edge_density = 0
        
        if gray.size > 0:
            # 使用梯度图像分析线条粗细
            sobelx = cv2.Sobel(gray, cv2.CV_64F, 1, 0, ksize=3)
            sobely = cv2.Sobel(gray, cv2.CV_64F, 0, 1, ksize=3)
            gradient_magnitude = np.sqrt(sobelx**2 + sobely**2)
            
            # 归一化梯度
            if np.max(gradient_magnitude) > 0:
                gradient_magnitude = 255 * gradient_magnitude / np.max(gradient_magnitude)
            
            # 计算边缘密度
            edge_pixels = np.sum(gradient_magnitude > 50)
            total_pixels = gray.size
            if total_pixels > 0:
                edge_density = edge_pixels / total_pixels
            
            # 估计笔画宽度
            _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
            dist_transform = cv2.distanceTransform(binary, cv2.DIST_L2, 5)
            if np.max(dist_transform) > 0:
                stroke_width = int(np.mean(dist_transform[dist_transform > 0]) * 2)  # 估计笔画宽度
        
        # 基于边缘密度和笔画宽度判断是否为粗体
        is_bold = edge_density > 0.15 or stroke_width > 2
        
        # 检测字体是否为斜体 - 改进算法
        h_proj = np.sum(mask_dilated, axis=1) if mask_dilated.size > 0 else np.array([])
        is_italic = False
        if len(h_proj) > 10:
            # 计算上半部分和下半部分的水平投影差异
            mid = len(h_proj) // 2
            upper_sum = np.sum(h_proj[:mid])
            lower_sum = np.sum(h_proj[mid:])
            # 如果上半部分明显小于下半部分，可能是斜体
            is_italic = upper_sum < lower_sum * 0.7
        
        # 尝试检测文本对齐方式
        h_dist = np.sum(mask_dilated, axis=0) if mask_dilated.size > 0 else np.array([])
        left_sum = np.sum(h_dist[:len(h_dist)//3]) if len(h_dist) > 0 else 0
        middle_sum = np.sum(h_dist[len(h_dist)//3:2*len(h_dist)//3]) if len(h_dist) > 0 else 0
        right_sum = np.sum(h_dist[2*len(h_dist)//3:]) if len(h_dist) > 0 else 0
        
        # 确定对齐方式
        text_align = 'center'
        if left_sum > middle_sum * 1.5 and left_sum > right_sum * 1.5:
            text_align = 'left'
        elif right_sum > middle_sum * 1.5 and right_sum > left_sum * 1.5:
            text_align = 'right'
        
        # 将RGB转为BGR格式，并确保颜色值为整数
        text_color_rgb = tuple(int(c) for c in text_color)
        text_color_bgr = (text_color_rgb[2], text_color_rgb[1], text_color_rgb[0])
        
        # 构建背景色的RGB和BGR表示
        bg_color_rgb = None
        bg_color_bgr = None
        if bg_color is not None:
            bg_color_rgb = tuple(int(c) for c in bg_color)
            bg_color_bgr = (bg_color_rgb[2], bg_color_rgb[1], bg_color_rgb[0])
        
        print(f"文本风格提取 - 颜色RGB: {text_color_rgb}, 字体大小: {font_size}, 粗体: {is_bold}, 斜体: {is_italic}, 对齐: {text_align}")
        
        # 返回完整的样式信息
        return {
            'color': text_color_rgb,
            'color_bgr': text_color_bgr,
            'bg_color': bg_color_rgb,  # 可能为None
            'bg_color_bgr': bg_color_bgr,  # 可能为None
            'font_size': font_size,
            'is_bold': is_bold,
            'is_italic': is_italic,
            'align': text_align,
            'width': int(x_max - x_min),
            'height': int(y_max - y_min),
            'stroke_width': stroke_width
        }
        
    except Exception as e:
        print(f"提取样式失败: {str(e)}")
        import traceback
        traceback.print_exc()
        # 返回默认样式
        return {
            'color': (0, 0, 0),  # 默认黑色
            'color_bgr': (0, 0, 0),
            'bg_color': None,
            'bg_color_bgr': None,
            'font_size': 20,
            'is_bold': False,
            'is_italic': False,
            'align': 'center',
            'width': 100,
            'height': 30,
            'stroke_width': 0
        }

def draw_styled_text(image, original_box, translated_text, original_text, style):
    """在图像上绘制样式化文本，确保与原文样式一致"""
    try:
        # 获取样式信息
        color = style.get('color', (0, 0, 0))
        font_size = style.get('font_size', 20)
        is_bold = style.get('is_bold', False)
        is_italic = style.get('is_italic', False)
        
        # 计算文本区域
        x_min = min([p[0] for p in original_box])
        y_min = min([p[1] for p in original_box])
        x_max = max([p[0] for p in original_box])
        y_max = max([p[1] for p in original_box])
        
        # 创建PIL图像用于绘制
        pil_image = Image.fromarray(cv2.cvtColor(image, cv2.COLOR_BGR2RGB))
        draw = ImageDraw.Draw(pil_image)
        
        # 选择合适的字体
        font_path = "fonts/NotoSansSC-Regular.otf"  # 默认字体
        
        # 根据目标语言选择合适的字体
        if any(ord(c) > 127 for c in translated_text):  # 非ASCII字符
            if any('\u0E00' <= c <= '\u0E7F' for c in translated_text):  # 泰语
                font_path = "fonts/NotoSansThai-Regular.ttf"
            elif any('\u0400' <= c <= '\u04FF' for c in translated_text):  # 俄语
                font_path = "fonts/NotoSans-Regular.ttf"
            elif any('\u1E00' <= c <= '\u1EFF' for c in translated_text):  # 越南语
                font_path = "fonts/NotoSans-Regular.ttf"
        
        # 根据是否粗体选择字体
        if is_bold:
            font_path = font_path.replace("Regular", "Bold")
        
        # 确保字体文件存在
        if not os.path.exists(font_path):
            print(f"字体文件不存在: {font_path}，使用默认字体")
            # 使用系统默认字体
            if os.name == 'nt':  # Windows
                font_path = "C:/Windows/Fonts/simhei.ttf"
            else:  # Linux/Mac
                font_path = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
        
        # 找到最佳字体大小
        width = x_max - x_min
        height = y_max - y_min
        optimal_size = find_optimal_font_size(font_path, translated_text, width, height, original_text)
        
        # 加载字体
        try:
            font = ImageFont.truetype(font_path, optimal_size)
        except Exception as e:
            print(f"加载字体失败: {e}，使用默认字体")
            # 使用PIL默认字体
            font = ImageFont.load_default()
        
        # 测量文本尺寸
        try:
            bbox = draw.textbbox((0, 0), translated_text, font=font)
            text_width = bbox[2] - bbox[0]
            text_height = bbox[3] - bbox[1]
        except:
            # 旧版PIL兼容
            text_width, text_height = draw.textsize(translated_text, font=font)
        
        # 计算文本位置 - 居中对齐
        x = x_min + (width - text_width) / 2
        y = y_min + (height - text_height) / 2
        
        # 绘制文本
        draw.text((x, y), translated_text, fill=color, font=font)
        
        # 转回OpenCV格式
        result = cv2.cvtColor(np.array(pil_image), cv2.COLOR_RGB2BGR)
        return result
    except Exception as e:
        print(f"绘制文本失败: {str(e)}")
        import traceback
        traceback.print_exc()
        return image  # 返回原始图像

def find_optimal_font_size(font_path, text, max_width, max_height, original_text=None):
    """使用二分查找找到最佳字体大小，确保文字大小与原文匹配"""
    if not font_path or not os.path.exists(font_path):
        return 24  # 默认大小
        
    # 初始尺寸范围
    min_size = 8
    max_size = 200
    optimal_size = min_size
    best_fit_score = float('inf')  # 最小差异
    
    # 目标填充率 - 根据文本框大小动态调整
    if max_width > 300 or max_height > 100:  # 大文本框
        target_ratio = 0.8  # 大文本框填充率更高
    elif max_width < 100 or max_height < 30:  # 小文本框
        target_ratio = 0.6  # 小文本框填充率更低
    else:
        target_ratio = 0.7  # 中等文本框
    
    # 考虑翻译文本与原文的长度比例
    length_ratio = 1.0
    if original_text:
        # 计算更精确的长度比例
        orig_chars = len(original_text)
        trans_chars = len(text)
        
        # 不同语言的字符宽度比例调整
        if any('\u0E00' <= c <= '\u0E7F' for c in text):  # 泰语
            trans_chars *= 1.2  # 泰语字符通常更宽
        elif any('\u0400' <= c <= '\u04FF' for c in text):  # 俄语
            trans_chars *= 0.9  # 俄语字符宽度适中
        elif any('\u1E00' <= c <= '\u1EFF' for c in text):  # 越南语
            trans_chars *= 1.1  # 越南语带音调符号
            
        # 如果翻译文本比原文长很多，需要更小的字体
        length_ratio = min(1.0, orig_chars / max(1, trans_chars))
    
    # 创建临时Image绘图对象
    temp_img = Image.new('RGBA', (1, 1))
    draw = ImageDraw.Draw(temp_img)
    
    # 二分查找
    for _ in range(15):  # 增加迭代次数以获得更精确的结果
        mid_size = (min_size + max_size) // 2
        
        try:
            # 加载特定大小的字体
            font = ImageFont.truetype(font_path, mid_size)
            
            # 测量文本尺寸
            try:
                bbox = draw.textbbox((0, 0), text, font=font)
                text_width = bbox[2] - bbox[0]
                text_height = bbox[3] - bbox[1]
            except:
                text_width, text_height = draw.textsize(text, font=font)
            
            # 计算填充比例
            width_ratio = text_width / max_width
            height_ratio = text_height / max_height
            max_ratio = max(width_ratio, height_ratio)
            
            # 检查文本是否适合边界
            if max_ratio <= 0.95:  # 允许更大的填充率
                # 计算与目标比例的差异
                ratio_diff = abs(max_ratio - target_ratio)
                
                # 如果这个大小更接近目标比例，更新最佳大小
                if ratio_diff < best_fit_score:
                    best_fit_score = ratio_diff
                    optimal_size = mid_size
                
                # 继续尝试更大的字体
                min_size = mid_size
            else:
                # 文本太大，尝试更小的字体
                max_size = mid_size
        except Exception as e:
            print(f"字体大小测试失败: {e}")
            max_size = mid_size
    
    # 应用长度比例调整，但限制调整幅度
    adjusted_size = int(optimal_size * (length_ratio * 0.7 + 0.3))  # 混合原始大小和调整后大小
    
    # 确保字体大小在合理范围内
    final_size = max(10, min(adjusted_size, 120))
    
    print(f"原始文本: '{original_text}', 翻译文本: '{text}', 最佳字体大小: {final_size}px")
    return final_size

def extract_dominant_color(image, points):
    """从文本区域提取主要颜色"""
    try:
        # 计算区域边界
        x, y, w, h = cv2.boundingRect(np.array(points))
        
        # 提取区域
        region = image[y:y+h, x:x+w]
        
        # 创建掩码
        mask = np.zeros((h, w), dtype=np.uint8)
        adjusted_points = np.array(points) - np.array([x, y])
        cv2.fillPoly(mask, [adjusted_points], 255)
        
        # 获取掩码区域内的像素
        pixels = region[mask == 255].reshape(-1, 3)
        
        if len(pixels) == 0:
            return (0, 0, 0)
            
        # 使用K-means聚类找到主要颜色
        from sklearn.cluster import KMeans
        
        # 确定聚类数量
        k = min(3, len(pixels))
        if k == 0:
            return (0, 0, 0)
            
        kmeans = KMeans(n_clusters=k, random_state=0, n_init=10).fit(pixels)
        
        # 获取每个集群的大小
        labels, counts = np.unique(kmeans.labels_, return_counts=True)
        
        # 获取最大集群的颜色
        dominant_color = kmeans.cluster_centers_[np.argmax(counts)]
        
        # 检查颜色亮度
        brightness = np.mean(dominant_color)
        
        # 如果颜色太亮或太暗，使用对比色
        if brightness > 200:  # 太亮
            return (0, 0, 0)  # 黑色
        elif brightness < 50:  # 太暗
            return (255, 255, 255)  # 白色
        else:
            return tuple(int(c) for c in dominant_color)
    except Exception as e:
        print(f"颜色提取失败: {e}")
        return (0, 0, 0)  # 默认黑色

@app.route('/direct')
def direct_test_page():
    """提供极简版测试页面"""
    return render_template('test_direct.html')

@app.route('/process_image', methods=['POST'])
def process_image():
    """处理图片并返回翻译数据"""
    try:
        # 记录请求信息
        print("收到上传请求")
        print(f"表单数据: {request.form}")
        print(f"文件: {request.files}")
        
        # 获取上传的图片和参数
        image_file = request.files.get('image')
        source_lang = request.form.get('source_lang', 'auto')
        target_lang = request.form.get('target_lang', 'en')
        bg_model = request.form.get('bg_model', 'opencv')  # opencv 或 iop
        solid_bg_mode = request.form.get('solid_bg_mode', 'false') == 'true'  # 纯色背景模式
        
        print(f"背景处理模型: {bg_model}, 纯色背景模式: {solid_bg_mode}")
        
        if not image_file:
            print("错误: 未上传图片")
            return jsonify({'success': False, 'error': '未上传图片'})
        
        # 确保上传目录存在
        upload_dir = os.path.join('static', 'uploads')
        os.makedirs(upload_dir, exist_ok=True)
        
        # 保存上传的图片 - 使用UUID确保唯一性，避免批量处理时文件被覆盖
        unique_id = str(uuid.uuid4())[:8]  # 使用UUID的前8位
        timestamp = int(time.time())
        filename = f'{timestamp}_{unique_id}_original.jpg'
        image_path = os.path.join(upload_dir, filename)
        print(f"保存图片到: {image_path}")
        image_file.save(image_path)
        
        # OCR识别文字位置 - 根据选择的语言决定识别什么类型的文字
        print(f"开始OCR识别 - 源语言: {source_lang}")
        text_positions = ocr_image(image_path, source_lang)
        if not text_positions:
            print("错误: 未检测到文本")
            return jsonify({'success': False, 'error': '未检测到文本'})
        
        # 保存不含文字的图片 - 使用同样的unique_id
        inpainted_path = os.path.join(upload_dir, f'{timestamp}_{unique_id}_inpainted.jpg')
        
        # 确保目录存在
        os.makedirs(os.path.dirname(inpainted_path), exist_ok=True)
        
        # 🔑 纯色背景模式：提取边框颜色并用纯色矩形覆盖
        if solid_bg_mode:
            print("使用纯色背景模式（不使用OpenCV涂抹）")
            try:
                img = cv2.imread(image_path)
                if img is None:
                    raise Exception("无法读取原始图像")
                
                for pos in text_positions:
                    # 获取文本框坐标
                    box = pos['box']
                    pts = np.array(box).astype(np.int32)
                    
                    # 计算边界矩形
                    x_min = max(0, int(np.min(pts[:, 0])))
                    y_min = max(0, int(np.min(pts[:, 1])))
                    x_max = min(img.shape[1], int(np.max(pts[:, 0])))
                    y_max = min(img.shape[0], int(np.max(pts[:, 1])))
                    
                    if x_max <= x_min or y_max <= y_min:
                        continue
                    
                    # 🔑 提取边框颜色：从矩形边缘的四个角附近采样
                    sample_points = []
                    margin = 3  # 向外扩展采样区域
                    
                    # 左边缘采样
                    for y in range(max(0, y_min - margin), min(img.shape[0], y_max + margin)):
                        if x_min > margin:
                            sample_points.append(img[y, x_min - margin])
                    
                    # 右边缘采样
                    for y in range(max(0, y_min - margin), min(img.shape[0], y_max + margin)):
                        if x_max + margin < img.shape[1]:
                            sample_points.append(img[y, x_max + margin])
                    
                    # 上边缘采样
                    for x in range(max(0, x_min - margin), min(img.shape[1], x_max + margin)):
                        if y_min > margin:
                            sample_points.append(img[y_min - margin, x])
                    
                    # 下边缘采样
                    for x in range(max(0, x_min - margin), min(img.shape[1], x_max + margin)):
                        if y_max + margin < img.shape[0]:
                            sample_points.append(img[y_max + margin, x])
                    
                    # 计算平均颜色
                    if sample_points:
                        avg_color = np.mean(sample_points, axis=0).astype(np.uint8)
                    else:
                        # 如果无法采样，尝试从四个角直接采样
                        corners = [
                            (max(0, x_min - 1), max(0, y_min - 1)),
                            (min(img.shape[1]-1, x_max), max(0, y_min - 1)),
                            (max(0, x_min - 1), min(img.shape[0]-1, y_max)),
                            (min(img.shape[1]-1, x_max), min(img.shape[0]-1, y_max))
                        ]
                        corner_colors = [img[cy, cx] for cx, cy in corners if 0 <= cx < img.shape[1] and 0 <= cy < img.shape[0]]
                        if corner_colors:
                            avg_color = np.mean(corner_colors, axis=0).astype(np.uint8)
                        else:
                            avg_color = np.array([0, 0, 0], dtype=np.uint8)  # 黑色作为后备
                    
                    # 🔑 用纯色矩形覆盖文字区域
                    # 稍微扩大一点覆盖范围确保完全覆盖文字
                    expand = 2
                    x1 = max(0, x_min - expand)
                    y1 = max(0, y_min - expand)
                    x2 = min(img.shape[1], x_max + expand)
                    y2 = min(img.shape[0], y_max + expand)
                    
                    # 填充矩形
                    cv2.rectangle(img, (x1, y1), (x2, y2), avg_color.tolist(), -1)
                    print(f"纯色填充: ({x1},{y1})-({x2},{y2}) 颜色: {avg_color.tolist()}")
                
                # 保存结果
                cv2.imwrite(inpainted_path, img)
                print(f"纯色背景模式成功，保存到: {inpainted_path}")
                
            except Exception as e:
                print(f"纯色背景模式失败: {str(e)}")
                import traceback
                traceback.print_exc()
                # 失败时复制原图
                shutil.copy(image_path, inpainted_path)
        else:
            # 去除文字 - 传入bg_model参数控制使用IOP还是OpenCV
            print(f"开始去除文字 (使用: {bg_model})")
            remove_success = remove_text(image_path, text_positions, inpainted_path, bg_model)
            
            # 如果移除文字失败，使用原始图像并打印错误信息
            if not remove_success or not os.path.exists(inpainted_path):
                print("使用OpenCV进行图像修复")
                try:
                    # 读取原始图像
                    img = cv2.imread(image_path)
                    if img is None:
                        raise Exception("无法读取原始图像")
                        
                    # 创建掩码
                    mask = np.zeros(img.shape[:2], dtype=np.uint8)
                    for pos in text_positions:
                        points = np.array(pos['box']).astype(np.int32)
                        cv2.fillPoly(mask, [points], 255)
                    
                    # 扩大掩码区域确保更好的修复效果
                    # 增大膨胀力度，防止文字边缘残留
                    kernel = np.ones((9,9), np.uint8)
                    mask = cv2.dilate(mask, kernel, iterations=2)
                    
                    # 使用OnpenCV的inpaint函数修复图像
                    # 升级：改用 NS (Navier-Stokes) 算法，它比 Telea 更平滑
                    # 升级：半径从 5 增加到 20，以处理更大的字体
                    print("使用增强版 OpenCV Inpaint (NS, r=20)")
                    inpainted = cv2.inpaint(img, mask, 20, cv2.INPAINT_NS)
                    
                    # 保存修复后的图像
                    cv2.imwrite(inpainted_path, inpainted)
                    print(f"使用OpenCV成功修复图像并保存到: {inpainted_path}")
                except Exception as e:
                    print(f"使用OpenCV修复失败: {str(e)}")
                    # 如果OpenCV也失败，复制原始图像
                    shutil.copy(image_path, inpainted_path)
                    print(f"复制原始图像到: {inpainted_path}")
        
        # 提取文本内容并翻译
        texts = [pos['text'] for pos in text_positions]
        
        # 处理多语言输入
        if source_lang == 'auto':
            # 自动检测语言
            has_cn = any(has_chinese(text) for text in texts)
            if has_cn:
                source_lang = 'zh'
            else:
                source_lang = 'en'
        
        print(f"翻译文本 (从 {source_lang} 到 {target_lang})")
        print(f"待翻译文本: {texts}")
        
        # 进行翻译 - 使用改进的翻译函数
        translated_texts = translate_texts(texts, source_lang, target_lang)
        print(f"翻译结果: {translated_texts}")
        
        # 加载图像以提取样式
        image = cv2.imread(image_path)
        if image is None:
            raise Exception("无法读取图像以提取样式")
            
        # 保存文字位置和样式信息
        text_data = []
        
        # 为每个文本区域提取精确的样式，并构造前端需要的数据结构
        for i, (pos, trans_text) in enumerate(zip(text_positions, translated_texts)):
            try:
                # 提取文本样式 - 使用改进的样式提取函数
                style = extract_text_style(image, pos['box'])
                
                # 构建RGB颜色字符串
                color_str = f"rgb({style['color'][0]}, {style['color'][1]}, {style['color'][2]})"
                
                # 构建背景色字符串(如果有)
                bg_color_str = None
                if style.get('bg_color'):
                    bg_color_str = f"rgba({style['bg_color'][0]}, {style['bg_color'][1]}, {style['bg_color'][2]}, 0.85)"
                
                # 将样式属性转换为JSON可序列化格式
                json_safe_style = {
                    'color': color_str,
                    'bg_color': bg_color_str,  
                    'is_bold': 1 if style['is_bold'] else 0,  # 将布尔值转换为整数
                    'is_italic': 1 if style['is_italic'] else 0,  # 将布尔值转换为整数
                    'font_size': int(style['font_size']),
                    'width': int(style['width']),
                    'height': int(style['height']),
                    'align': style['align']  # 文本对齐方式
                }
                
                # 准备文本位置数据
                text_data.append({
                    'box': pos['box'],  # 原始文本框位置
                    'text': pos['text'],  # 原始文本内容
                    'style': json_safe_style  # 完整样式信息
                })
                
                print(f"文本 #{i}: '{pos['text']}' → '{trans_text}', 样式: {json_safe_style}")
                
            except Exception as e:
                print(f"处理文本 #{i} 样式失败: {str(e)}")
                # 使用默认样式
                text_data.append({
                    'box': pos['box'],
                    'text': pos['text'],
                    'style': {
                        'color': 'rgb(0, 0, 0)',
                        'bg_color': None,
                        'is_bold': 0,
                        'is_italic': 0,
                        'font_size': 20,
                        'width': 100,
                        'height': 30,
                        'align': 'center'
                    }
                })
        
        # 构建响应数据 - 使用完整的唯一文件名
        response = {
            'success': True,
            'original_url': f'/static/uploads/{timestamp}_{unique_id}_original.jpg',
            'inpainted_url': f'/static/uploads/{timestamp}_{unique_id}_inpainted.jpg',
            'text_positions': text_data,
            'translations': translated_texts
        }
        
        print("处理成功，返回结果")
        return jsonify(response)
    
    except Exception as e:
        print(f"处理图像失败: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)})

@app.route('/update_style', methods=['POST'])
def update_style():
    try:
        data = request.json
        if not data or 'image_url' not in data or 'style' not in data:
            return jsonify({'success': False, 'error': '无效的请求数据'})
        
        # 获取图片URL和样式设置
        image_url = data['image_url']
        style = data['style']
        
        # 提取图片文件名
        filename = os.path.basename(image_url.split('?')[0])  # 去掉可能的查询参数
        image_path = os.path.join(OUTPUT_FOLDER, filename)
        
        if not os.path.exists(image_path):
            return jsonify({'success': False, 'error': '图片不存在'})
        
        # 查找最新的翻译数据
        data_files = [f for f in os.listdir(OUTPUT_FOLDER) if f.endswith('.json') and f.startswith('text_data_')]
        data_files.sort(key=lambda x: os.path.getmtime(os.path.join(OUTPUT_FOLDER, x)), reverse=True)
        
        if not data_files:
            return jsonify({'success': False, 'error': '找不到翻译数据'})
            
        # 读取最新的翻译数据
        data_path = os.path.join(OUTPUT_FOLDER, data_files[0])
        with open(data_path, 'r', encoding='utf-8') as f:
            translation_data = json.load(f)
        
        # 更新样式数据
        for item in translation_data:
            # 更新样式
            for key, value in style.items():
                item['style'][key] = value
        
        # 保存更新后的翻译数据
        updated_data_path = os.path.join(OUTPUT_FOLDER, f"text_data_{uuid.uuid4()}.json")
        with open(updated_data_path, 'w', encoding='utf-8') as f:
            json.dump(translation_data, f, ensure_ascii=False, indent=2)
        
        return jsonify({
            'success': True,
            'message': '样式已更新',
            'data_file': os.path.basename(updated_data_path)
        })
            
    except Exception as e:
        print(f"更新样式失败: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)})

@app.route('/update_translation', methods=['POST'])
def update_translation():
    try:
        data = request.json
        index = data.get('index')
        new_text = data.get('text')
        
        if index is None or new_text is None:
            return jsonify({'success': False, 'error': '缺少参数'})
        
        # 查找最新的翻译数据
        data_files = [f for f in os.listdir(OUTPUT_FOLDER) if f.endswith('.json') and f.startswith('text_data_')]
        data_files.sort(key=lambda x: os.path.getmtime(os.path.join(OUTPUT_FOLDER, x)), reverse=True)
        
        if not data_files:
            return jsonify({'success': False, 'error': '找不到翻译数据'})
            
        # 读取最新的翻译数据
        data_path = os.path.join(OUTPUT_FOLDER, data_files[0])
        with open(data_path, 'r', encoding='utf-8') as f:
            translation_data = json.load(f)
        
        if index >= len(translation_data):
            return jsonify({'success': False, 'error': '索引超出范围'})
        
        # 更新翻译文本
        translation_data[index]['translated_text'] = new_text
        
        # 保存更新后的翻译数据
        updated_data_path = os.path.join(OUTPUT_FOLDER, f"text_data_{uuid.uuid4()}.json")
        with open(updated_data_path, 'w', encoding='utf-8') as f:
            json.dump(translation_data, f, ensure_ascii=False, indent=2)
        
        return jsonify({
            'success': True,
            'message': '文本已更新',
            'data_file': os.path.basename(updated_data_path)
        })
        
    except Exception as e:
        print(f"更新翻译失败: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)})

@app.route('/translate_image', methods=['POST'])
def translate_image():
    try:
        data = request.json
        source_lang = data.get('source_lang', 'zh')
        target_lang = data.get('target_lang', 'en')
        
        # 确保session_id存在
        session_id = request.cookies.get('session_id')
        if not session_id or session_id not in session_data:
            return jsonify({'success': False, 'error': '会话已过期，请重新上传图片'})
        
        session_info = session_data[session_id]
        image_path = session_info.get('image_path')
        
        if not image_path or not os.path.exists(image_path):
            return jsonify({'success': False, 'error': '图片不存在，请重新上传'})
        
        # 1. 调用UmiOCR识别文字
        ocr_results = ocr_image(image_path, source_lang)
        if not ocr_results:
            return jsonify({'success': False, 'error': '未识别到文字'})
        
        # 2. 提取需要翻译的文本和位置
        texts_to_translate = []
        text_positions = []
        styles = []
        
        for result in ocr_results:
            text = result.get('text', '').strip()
            if not text:
                continue
                
            # 根据语言过滤
            if (source_lang == 'zh' and has_chinese(text)) or \
               (source_lang == 'en' and not has_chinese(text)):
                texts_to_translate.append(text)
                text_positions.append(result.get('box', []))
                # 提取样式
                style = extract_text_style(cv2.imread(image_path), result.get('box', []))
                styles.append(style)
        
        if not texts_to_translate:
            return jsonify({'success': False, 'error': '未找到需要翻译的文字'})
        
        # 3. 翻译文本
        translated_texts = translate_texts(texts_to_translate, source_lang, target_lang)
        
        # 4. 使用IOPaint去除原始文字 (在后台进行，但前端只显示原图和翻译结果)
        removed_text_path = os.path.join(app.config['OUTPUT_FOLDER'], f"removed_{session_id}.jpg")
        remove_success = remove_text(image_path, text_positions, removed_text_path)
        
        # 检查IOPaint处理是否成功
        if not remove_success:
            return jsonify({'success': False, 'error': 'IOPaint文字去除失败，请确保IOPaint服务器正常运行'})
        
        # 将去除文字的图片路径保存在会话中，供Canvas使用但不在界面显示
        session_info['removed_text_path'] = removed_text_path
        
        # 5. 准备返回数据
        translation_data = []
        for i, (box, translated_text) in enumerate(zip(text_positions, translated_texts)):
            translation_data.append({
                'box': box,
                'original_text': texts_to_translate[i],
                'translated_text': translated_texts[i],
                'style': styles[i]
            })
            
        session_info['translation_data'] = translation_data
        session_data[session_id] = session_info
        
        return jsonify({
            'success': True,
            'original_image_url': f'/uploads/{os.path.basename(image_path)}',
            'background_image_url': f'/output/removed_{session_id}.jpg',
            'translation_data': translation_data
        })
        
    except Exception as e:
        print(f"翻译失败: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)})

# 添加缺失的函数
def has_chinese(text):
    """检查文本是否包含中文字符"""
    for char in text:
        if '\u4e00' <= char <= '\u9fff':
            return True
    return False

def translate_texts(texts, source_lang, target_lang):
    """翻译文本列表"""
    translator = Translator(source_lang, target_lang)
    return translator.translate(texts)

def ocr_image(image_path, source_lang='auto'):
    """识别图像中的文字，根据源语言进行过滤"""
    try:
        # 读取图片并转为base64
        with open(image_path, 'rb') as f:
            base64_data = base64.b64encode(f.read()).decode()
        
        # 调用UmiOCR进行文字识别
        response = requests.post(
            "http://127.0.0.1:1224/api/ocr",
            json={"base64": base64_data}
        )
        
        if response.status_code != 200:
            print(f"OCR识别失败，状态码: {response.status_code}")
            return []
        
        result = response.json()
        
        if result.get('code') != 100 or 'data' not in result:
            print(f"OCR识别失败，返回结果: {result}")
            return []
        
        # 根据源语言过滤结果
        if source_lang != 'auto':
            filtered_data = []
            for item in result['data']:
                text = item['text'].strip()
                if not text:  # 跳过空文本
                    continue
                    
                if source_lang == 'zh':
                    # 中文模式：保留包含中文的文本
                    if any('\u4e00' <= c <= '\u9fff' for c in text):
                        filtered_data.append(item)
                elif source_lang == 'en':
                    # 英文模式：保留包含英文的文本，排除包含中文的
                    if any(c.isalpha() for c in text) and not any('\u4e00' <= c <= '\u9fff' for c in text):
                        filtered_data.append(item)
                elif source_lang == 'th':
                    # 泰文模式：保留包含泰文字符的文本
                    thai_chars = any(0x0E00 <= ord(c) <= 0x0E7F for c in text)
                    if thai_chars:
                        filtered_data.append(item)
                elif source_lang == 'ru':
                    # 俄文模式：保留包含西里尔字符的文本
                    cyrillic_chars = any(0x0400 <= ord(c) <= 0x04FF for c in text)
                    if cyrillic_chars:
                        filtered_data.append(item)
                elif source_lang == 'vi':
                    # 越南文模式：保留包含越南文特有字符的文本
                    vietnamese_chars = any(c in 'ăâêôơưđáàảãạắằẳẵặấầẩẫậếềểễệốồổỗộớờởỡợứừửữự' for c in text.lower())
                    if vietnamese_chars or (any(c.isalpha() for c in text) and not any('\u4e00' <= c <= '\u9fff' for c in text)):
                        filtered_data.append(item)
                else:
                    # 其他语言，添加所有非空文本
                    filtered_data.append(item)
            
            print(f"源语言: {source_lang}, 过滤前: {len(result['data'])}, 过滤后: {len(filtered_data)}")
            result['data'] = filtered_data
        
        # 处理识别结果
        positions = []
        for item in result['data']:
            if not item['box'] or len(item['box']) < 4:
                continue
                
            text = item['text'].strip()
            if not text:  # 跳过空文本
                continue
            
            # 获取每个文字框的位置
            box = item['box']
            if len(box) == 4:  # 四点坐标
                positions.append({
                    'box': box,
                    'text': text
                })
        
        print(f"OCR识别到 {len(positions)} 个文本块")
        return positions
        
    except Exception as e:
        print(f"OCR识别错误: {str(e)}")
        import traceback
        traceback.print_exc()
        return []

def remove_text(image_path, text_positions, output_path, bg_model='opencv'):
    """移除文本，根据bg_model决定使用IOPaint API还是OpenCV"""
    try:
        # 读取图像
        image = cv2.imread(image_path)
        if image is None:
            print(f"无法读取图像: {image_path}")
            return False
        
        # 创建掩码
        mask = np.zeros(image.shape[:2], dtype=np.uint8)
        
        # 在OCR边界框内检测实际文字笔画
        for box in text_positions:
            try:
                # 确保box是一个有效的点列表
                if isinstance(box, dict) and 'box' in box:
                    box = box['box']
                
                # 确保点的格式正确
                if len(box) == 1 and isinstance(box[0], list):
                    box = box[0]
                
                if len(box) < 3:
                    continue
                
                # 计算边界矩形
                pts = np.array(box).astype(np.int32)
                x_min = max(0, int(np.min(pts[:, 0])))
                y_min = max(0, int(np.min(pts[:, 1])))
                x_max = min(image.shape[1], int(np.max(pts[:, 0])))
                y_max = min(image.shape[0], int(np.max(pts[:, 1])))
                
                if x_max <= x_min or y_max <= y_min:
                    continue
                
                # 裁剪文本区域
                roi = image[y_min:y_max, x_min:x_max]
                h, w = roi.shape[:2]
                
                # === 核心修改：适配PowerPaint模型 ===
                # PowerPaint 等扩散模型需要完整的填充区域，而不是细碎的文字笔画
                # 直接填充整个OCR检测框 (Polygon)
                
                
                cv2.fillPoly(mask, [pts], 255)

                # 膨胀Mask以覆盖边缘锯齿和残留 (5x5 kernel)
                kernel = np.ones((5, 5), np.uint8)
                mask = cv2.dilate(mask, kernel, iterations=1)
                
            except Exception as e:
                print(f"绘制掩码失败: {str(e)}")
                continue
        
        # 确保输出目录存在
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        
        # 保存原始图像的副本作为备份
        backup_path = output_path + ".backup.jpg"
        cv2.imwrite(backup_path, image)
        
        # 保存掩码用于检查
        mask_path = output_path + ".mask.jpg"
        cv2.imwrite(mask_path, mask)
        print(f"掩码已保存到: {mask_path}")
        
        # 根据bg_model决定使用哪种方法
        if bg_model == 'opencv':
            print("使用OpenCV进行背景处理（跳过IOP）")
            return False  # 返回False让调用方使用OpenCV fallback
        
        print(f"使用IOP AI进行背景处理")
        
        # 尝试使用IOPaint API（优选方案） - 进行多次擦除以提高质量
        try:
            # 保存掩码为临时文件
            cv2.imwrite(mask_path, mask)
            
            # 读取图像和掩码为base64
            with open(image_path, 'rb') as f:
                base64_data = base64.b64encode(f.read()).decode()
                
            with open(mask_path, 'rb') as f:
                mask_base64 = base64.b64encode(f.read()).decode()
            
            # 调用IOPaint API - 使用正确的服务器地址和端口
            iop_server = "http://127.0.0.1:8080"
            
            print(f"正在调用IOPaint API: {iop_server}/api/v1/inpaint")
            
            # 增加重试机制和多次擦除
            # 修复：max_retries至少为1，否则循环不会执行
            max_retries = 1  # 至少尝试一次IOPaint API调用
            retry_delay = 0  
            inpaint_passes = 1  # LaMa只需一次，多次反而模糊
            
            current_image_data = base64_data  # 初始图像数据
            inpaint_success = False
            
            # 多次擦除循环
            for inpaint_pass in range(inpaint_passes):
                print(f"执行文本擦除 Pass {inpaint_pass + 1}/{inpaint_passes}")
                
                # 每次擦除的重试循环
                for retry in range(max_retries):
                    try:
                        response = requests.post(
                            f"{iop_server}/api/v1/inpaint",  
                            json={
                                "image": current_image_data,  # 使用当前图像数据
                                "mask": mask_base64,
                                "sd_steps": 30, # 提速
                                # "model": "lama",  # 移除硬编码，使用当前PowerPaint
                                # "device": "cuda",  
                                "hd_strategy_crop_margin": 128,  # 高清策略裁剪边距
                                "hd_strategy_crop_trigger_size": 1280,  # 高清策略触发尺寸
                                "hd_strategy": "crop", # 高清策略使用裁剪
                                "prompt": "",  # PowerPaint context aware
                                "negative_prompt": "text, watermark, writing, letters, signature",  # 负面提示词
                                "use_croper": False,  # 不使用裁剪器
                                "croper_x": 0,
                                "croper_y": 0,
                                "croper_height": 512,
                                "croper_width": 512,
                                "use_inpaint_model": False,
                                "use_hdstrategy": True
                            },
                            timeout=600  # 关键修改：增加超时时间以等待大模型处理
                        )
                        
                        print(f"IOPaint API响应状态码: {response.status_code}")
                        
                        if response.status_code == 200:
                            try:
                                # 检查响应内容类型
                                content_type = response.headers.get('Content-Type', '')
                                print(f"响应内容类型: {content_type}")
                                
                                # 保存当前pass的结果
                                pass_output_path = f"{output_path}.pass{inpaint_pass+1}.jpg"
                                
                                # 尝试直接保存响应内容作为图像
                                with open(pass_output_path, 'wb') as f:
                                    f.write(response.content)
                                print(f"保存Pass {inpaint_pass+1}响应内容到: {pass_output_path}")
                                
                                # 验证保存的文件是否为有效图像
                                test_img = cv2.imread(pass_output_path)
                                if test_img is not None and test_img.size > 0:
                                    print(f"Pass {inpaint_pass+1}成功保存有效图像")
                                    
                                    # 如果不是最后一次擦除，更新当前图像数据用于下一次擦除
                                    if inpaint_pass < inpaint_passes - 1:
                                        with open(pass_output_path, 'rb') as f:
                                            current_image_data = base64.b64encode(f.read()).decode()
                                    else:
                                        # 最后一次擦除，应用高斯融合后保存
                                        inpainted = cv2.imread(pass_output_path)
                                        if inpainted is not None:
                                            # === 高斯模糊融合 (视频最后一步技巧) ===
                                            # 对修复区域边缘进行微弱模糊，消除接缝感
                                            mask_dilated = cv2.dilate(mask, np.ones((7,7), np.uint8), iterations=1)
                                            blurred = cv2.GaussianBlur(inpainted, (5, 5), 0)
                                            
                                            # 创建3通道蒙版用于混合
                                            mask_3c = cv2.cvtColor(mask_dilated, cv2.COLOR_GRAY2BGR) / 255.0
                                            # 在蒙版区域用30%的模糊图融合，消除边缘硬切感
                                            final = (inpainted * (1 - mask_3c * 0.3) + blurred * (mask_3c * 0.3)).astype(np.uint8)
                                            
                                            cv2.imwrite(output_path, final)
                                            print(f"最终擦除结果(含高斯融合)已保存到: {output_path}")
                                        else:
                                            shutil.copy(pass_output_path, output_path)
                                            print(f"最终擦除结果已保存到: {output_path}")
                                    
                                    inpaint_success = True
                                    break  # 当前pass成功，中断重试循环
                                else:
                                    print(f"Pass {inpaint_pass+1}保存的文件不是有效图像或为空")
                                    
                                    # 如果不是最后一次重试，则继续
                                    if retry < max_retries - 1:
                                        print(f"将在{retry_delay}秒后重试...")
                                        time.sleep(retry_delay)
                                        continue
                            except Exception as e:
                                print(f"处理IOPaint API响应时出错: {str(e)}")
                                print(f"响应内容前100字符: {str(response.content)[:100]}")
                                
                                if retry < max_retries - 1:
                                    print(f"将在{retry_delay}秒后重试...")
                                    time.sleep(retry_delay)
                                    continue
                        
                        else:
                            print(f"IOPaint API返回错误: {response.status_code}")
                            print(f"错误详情: {response.text[:500]}...")
                            if retry < max_retries - 1:
                                print(f"将在{retry_delay}秒后重试...")
                                time.sleep(retry_delay)
                                continue
                        
                        # 如果到达这里，说明当前重试失败
                        break
                        
                    except requests.exceptions.ConnectionError:
                        print(f"无法连接到IOPaint服务器 {iop_server}，请确保服务器正在运行")
                        if retry < max_retries - 1:
                            print(f"将在{retry_delay}秒后重试...")
                            time.sleep(retry_delay)
                        else:
                            break
                    except requests.exceptions.Timeout:
                        print(f"IOPaint API请求超时，服务器可能处理较慢或负载过高")
                        if retry < max_retries - 1:
                            print(f"将在{retry_delay}秒后重试...")
                            time.sleep(retry_delay)
                        else:
                            break
                    except Exception as e:
                        print(f"IOPaint API调用失败: {str(e)}")
                        if retry < max_retries - 1:
                            print(f"将在{retry_delay}秒后重试...")
                            time.sleep(retry_delay)
                        else:
                            break
                
                # 如果当前pass失败，不继续进行后续pass
                if not inpaint_success:
                    print(f"Pass {inpaint_pass+1}擦除失败，中断后续擦除")
                    break
            
            # 返回最终结果
            if inpaint_success:
                # 删除临时掩码文件
                if os.path.exists(mask_path):
                    os.remove(mask_path)
                return True
        
        except Exception as e:
            print(f"IOPaint API调用过程中出错: {str(e)}")
            import traceback
            traceback.print_exc()
        
        # 如果IOPaint API调用失败，尝试使用OpenCV进行Inpainting
        print("IOPaint API调用失败，尝试使用OpenCV进行修复")
        
        try:
            # 使用OpenCV的inpaint函数
            result = cv2.inpaint(image, mask, 3, cv2.INPAINT_TELEA)  # 使用TELEA算法，radius=3
            
            # === 高斯模糊融合 (视频最后一步技巧) ===
            mask_dilated = cv2.dilate(mask, np.ones((7,7), np.uint8), iterations=1)
            blurred = cv2.GaussianBlur(result, (5, 5), 0)
            mask_3c = cv2.cvtColor(mask_dilated, cv2.COLOR_GRAY2BGR) / 255.0
            final = (result * (1 - mask_3c * 0.3) + blurred * (mask_3c * 0.3)).astype(np.uint8)
            
            cv2.imwrite(output_path, final)
            print(f"使用OpenCV成功修复图像(含高斯融合)并保存到: {output_path}")
            return True
        except Exception as e:
            print(f"OpenCV修复失败: {str(e)}")
            
            # 使用原始图像作为后备措施
            try:
                # 复制原始图像作为输出
                shutil.copy(image_path, output_path)
                print(f"使用原始图像作为应急输出: {output_path}")
                return False
            except:
                print(f"复制原始图像失败")
                return False
    except Exception as e:
        print(f"去除文字失败: {str(e)}")
        import traceback
        traceback.print_exc()
        
        # 使用原始图像作为应急措施
        try:
            # 如果inpaint失败但我们有原始图像，则复制原始图像作为结果
            shutil.copy(image_path, output_path)
            print(f"使用原始图像作为后备: {output_path}")
            return True
        except:
            print(f"复制原始图像失败，无法生成结果")
            return False

@app.route('/update_all_text', methods=['POST'])
def update_all_text():
    try:
        data = request.json.get('data', [])
        
        if not data:
            return jsonify({'success': False, 'error': '没有文本数据'})
            
        # 获取数据对应的图片
        # 先尝试从最新翻译结果获取图片
        output_files = [f for f in os.listdir(OUTPUT_FOLDER) if f.endswith(('.png', '.jpg', '.jpeg'))]
        output_files.sort(key=lambda x: os.path.getmtime(os.path.join(OUTPUT_FOLDER, x)), reverse=True)
        
        if not output_files:
            return jsonify({'success': False, 'error': '没有可用的输出图片'})
            
        # 使用最新的图片作为基础
        latest_file = output_files[0]
        
        # 获取对应的掩码图片（已经去除原文字的图片）
        inpainted_files = [f for f in os.listdir(OUTPUT_FOLDER) if f.startswith('inpainted_')]
        inpainted_files.sort(key=lambda x: os.path.getmtime(os.path.join(OUTPUT_FOLDER, x)), reverse=True)
        
        if inpainted_files:
            # 使用最新的已去除文字的图片
            base_image_path = os.path.join(OUTPUT_FOLDER, inpainted_files[0])
            print(f"使用已处理的移除文本图像: {base_image_path}")
        else:
            # 如果找不到掩码处理后的图片，直接使用原图
            base_image_path = os.path.join(OUTPUT_FOLDER, latest_file)
            print(f"使用原始图像: {base_image_path}")
        
        # 生成新的输出文件名（仅用于保存数据）
        data_filename = f"text_data_{uuid.uuid4()}.json"
        data_path = os.path.join(OUTPUT_FOLDER, data_filename)
        
        # 保存翻译数据到JSON文件
        with open(data_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        
        return jsonify({
            'success': True,
            'message': '文本数据已更新',
            'data_file': data_filename
        })
        
    except Exception as e:
        print(f"更新文本数据失败: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)})

@app.route('/test')
def test_page():
    """提供简化版测试页面"""
    return render_template('test_simple.html')

@app.route('/api/clear-cache', methods=['POST'])
def clear_cache():
    """清除 static 文件夹中的临时图片（uploads, debug, outputs）"""
    try:
        base_dir = os.path.join(os.path.dirname(__file__), 'static')
        folders_to_clear = ['uploads', 'debug', 'outputs']
        deleted_count = 0
        
        for folder in folders_to_clear:
            folder_path = os.path.join(base_dir, folder)
            if os.path.exists(folder_path):
                for filename in os.listdir(folder_path):
                    file_path = os.path.join(folder_path, filename)
                    try:
                        if os.path.isfile(file_path) and (filename.endswith('.jpg') or filename.endswith('.png') or filename.endswith('.jpeg')):
                            os.remove(file_path)
                            deleted_count += 1
                            print(f"已删除: {file_path}")
                    except Exception as e:
                        print(f"删除文件失败 {filename}: {e}")
        
        return jsonify({
            'success': True,
            'deleted': deleted_count,
            'message': f'已清除 {deleted_count} 个缓存文件'
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

# ========== 同步到文件夹功能模块 (增强版：缓存优先架构) ==========

# 同步缓存目录
SYNC_CACHE_FOLDER = os.path.join(WORK_DIR, 'sync_cache')
os.makedirs(SYNC_CACHE_FOLDER, exist_ok=True)

@app.route('/api/sync-to-folder', methods=['POST'])
def sync_to_folder():
    """将单张图片同步到指定文件夹（支持递归查找替换）"""
    try:
        data = request.get_json()
        target_path = data.get('target_path', '').strip()
        filename = data.get('filename', '').strip()
        image_data = data.get('image_data', '')
        
        if not target_path or not filename or not image_data:
            return jsonify({'success': False, 'error': '缺少必要参数'})
        
        # 安全检查
        if '..' in target_path or '..' in filename:
            return jsonify({'success': False, 'error': '路径包含非法字符'})
        
        if not os.path.isdir(target_path):
            return jsonify({'success': False, 'error': f'路径不存在: {target_path}'})
        
        # 🔍 智能搜索：深度优先搜索同名文件，实现精准替换
        dest_file = os.path.join(target_path, filename)
        found_existing = False
        
        for root, dirs, files in os.walk(target_path):
            if filename in files:
                dest_file = os.path.join(root, filename)
                found_existing = True
                print(f"🔍 找到已存在的文件，执行精准替换: {dest_file}")
                break
        
        if not found_existing:
            print(f"ℹ️ 未在子目录找到同名文件，将保存至根目录: {dest_file}")
        
        # 解码 Base64 图片数据
        try:
            if ',' in image_data:
                image_data = image_data.split(',')[1]
            image_bytes = base64.b64decode(image_data)
        except Exception as e:
            return jsonify({'success': False, 'error': f'Base64解码失败: {str(e)}'})
        
        # 写入文件
        with open(dest_file, 'wb') as f:
            f.write(image_bytes)
        
        print(f"✅ 同步成功: {dest_file}")
        return jsonify({'success': True, 'path': dest_file})
        
    except Exception as e:
        print(f"❌ 同步失败: {str(e)}")
        return jsonify({'success': False, 'error': str(e)})

@app.route('/api/validate-path', methods=['POST'])
def validate_path():
    """验证路径是否存在且可写"""
    try:
        data = request.get_json()
        path = data.get('path', '').strip()
        
        if not path:
            return jsonify({'valid': False, 'error': '路径为空'})
        
        if not os.path.exists(path):
            return jsonify({'valid': False, 'error': '路径不存在'})
        
        if not os.path.isdir(path):
            return jsonify({'valid': False, 'error': '不是有效的文件夹'})
        
        # 尝试写入测试文件检查权限
        test_file = os.path.join(path, '.xobi_write_test')
        try:
            with open(test_file, 'w') as f:
                f.write('test')
            os.remove(test_file)
        except:
            return jsonify({'valid': False, 'error': '没有写入权限'})
        
        return jsonify({'valid': True, 'path': path})
        
    except Exception as e:
        return jsonify({'valid': False, 'error': str(e)})

@app.route('/api/select-folder', methods=['POST'])
def select_folder():
    """打开原生对话框选择文件夹"""
    try:
        import tkinter as tk
        from tkinter import filedialog
        
        root = tk.Tk()
        root.withdraw()
        root.attributes("-topmost", True)
        
        folder_selected = filedialog.askdirectory(title="选择同步目标文件夹")
        root.destroy()
        
        if folder_selected:
            folder_selected = folder_selected.replace('/', os.sep)
            return jsonify({'success': True, 'path': folder_selected})
        else:
            return jsonify({'success': False, 'message': '未选择文件夹'})
            
    except Exception as e:
        print(f"❌ 打开文件夹选择框失败: {str(e)}")
        return jsonify({'success': False, 'error': str(e)})

@app.route('/api/export-to-cache', methods=['POST'])
def export_to_cache():
    """
    批量将翻译结果导出到缓存文件夹（快速！）
    前端传入: { images: [{langCode, filename, imageData}, ...] }
    返回: { success, cachePath, counts: {langCode: count} }
    """
    try:
        data = request.get_json()
        images = data.get('images', [])
        
        if not images:
            return jsonify({'success': False, 'error': '没有图片数据'})
        
        # 创建带时间戳的缓存目录
        timestamp = datetime.now().strftime('%Y-%m-%d_%H-%M-%S')
        cache_path = os.path.join(SYNC_CACHE_FOLDER, timestamp)
        os.makedirs(cache_path, exist_ok=True)
        
        counts = {}
        
        for item in images:
            lang_code = item.get('langCode', 'unknown')
            filename = item.get('filename', 'image.png')
            image_data = item.get('imageData', '')
            
            if not image_data:
                continue
            
            # 为每种语言创建子目录
            lang_folder = os.path.join(cache_path, lang_code)
            os.makedirs(lang_folder, exist_ok=True)
            
            # 解码并保存图片
            try:
                if ',' in image_data:
                    image_data = image_data.split(',')[1]
                image_bytes = base64.b64decode(image_data)
                
                dest_file = os.path.join(lang_folder, filename)
                with open(dest_file, 'wb') as f:
                    f.write(image_bytes)
                
                counts[lang_code] = counts.get(lang_code, 0) + 1
            except Exception as e:
                print(f"⚠️ 导出失败 {filename}: {e}")
        
        print(f"✅ 导出到缓存完成: {cache_path}, 统计: {counts}")
        return jsonify({
            'success': True,
            'cachePath': cache_path,
            'counts': counts
        })
        
    except Exception as e:
        print(f"❌ 导出到缓存失败: {str(e)}")
        return jsonify({'success': False, 'error': str(e)})

@app.route('/api/sync-from-cache', methods=['POST'])
def sync_from_cache():
    """
    从缓存目录同步到目标文件夹（快速替换！）
    前端传入: { cachePath, langPaths: {langCode: targetPath} }
    返回: { success, results: {langCode: {success, fail}} }
    """
    try:
        data = request.get_json()
        cache_path = data.get('cachePath', '')
        lang_paths = data.get('langPaths', {})
        
        if not cache_path or not os.path.isdir(cache_path):
            return jsonify({'success': False, 'error': '缓存路径无效'})
        
        if not lang_paths:
            return jsonify({'success': False, 'error': '未配置目标路径'})
        
        results = {}
        
        for lang_code, target_path in lang_paths.items():
            if not target_path or not os.path.isdir(target_path):
                results[lang_code] = {'success': 0, 'fail': 0, 'error': '目标路径无效'}
                continue
            
            lang_cache_folder = os.path.join(cache_path, lang_code)
            if not os.path.isdir(lang_cache_folder):
                results[lang_code] = {'success': 0, 'fail': 0, 'error': '缓存中无此语言'}
                continue
            
            success_count = 0
            fail_count = 0
            
            for filename in os.listdir(lang_cache_folder):
                src_file = os.path.join(lang_cache_folder, filename)
                if not os.path.isfile(src_file):
                    continue
                
                # 智能搜索目标位置
                dest_file = os.path.join(target_path, filename)
                for root, dirs, files in os.walk(target_path):
                    if filename in files:
                        dest_file = os.path.join(root, filename)
                        break
                
                try:
                    shutil.copy2(src_file, dest_file)
                    success_count += 1
                    print(f"✅ 替换: {filename} → {dest_file}")
                except Exception as e:
                    fail_count += 1
                    print(f"❌ 替换失败 {filename}: {e}")
            
            results[lang_code] = {'success': success_count, 'fail': fail_count}
        
        return jsonify({'success': True, 'results': results})
        
    except Exception as e:
        print(f"❌ 从缓存同步失败: {str(e)}")
        return jsonify({'success': False, 'error': str(e)})

@app.route('/api/list-sync-history', methods=['GET'])
def list_sync_history():
    """列出所有同步历史记录"""
    try:
        history = []
        if os.path.isdir(SYNC_CACHE_FOLDER):
            for folder_name in sorted(os.listdir(SYNC_CACHE_FOLDER), reverse=True):
                folder_path = os.path.join(SYNC_CACHE_FOLDER, folder_name)
                if os.path.isdir(folder_path):
                    # 统计每个语言文件夹的文件数
                    langs = {}
                    total_size = 0
                    for lang_folder in os.listdir(folder_path):
                        lang_path = os.path.join(folder_path, lang_folder)
                        if os.path.isdir(lang_path):
                            files = [f for f in os.listdir(lang_path) if os.path.isfile(os.path.join(lang_path, f))]
                            langs[lang_folder] = len(files)
                            for f in files:
                                total_size += os.path.getsize(os.path.join(lang_path, f))
                    
                    history.append({
                        'name': folder_name,
                        'path': folder_path,
                        'langs': langs,
                        'sizeMB': round(total_size / 1024 / 1024, 2)
                    })
        
        return jsonify({'success': True, 'history': history})
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

@app.route('/api/delete-sync-history', methods=['POST'])
def delete_sync_history():
    """删除指定的同步历史记录"""
    try:
        data = request.get_json()
        folder_name = data.get('name', '')
        
        if not folder_name:
            return jsonify({'success': False, 'error': '未指定文件夹名'})
        
        folder_path = os.path.join(SYNC_CACHE_FOLDER, folder_name)
        
        # 安全检查
        if not folder_path.startswith(SYNC_CACHE_FOLDER):
            return jsonify({'success': False, 'error': '非法路径'})
        
        if os.path.isdir(folder_path):
            shutil.rmtree(folder_path)
            print(f"🗑️ 已删除同步历史: {folder_path}")
            return jsonify({'success': True})
        else:
            return jsonify({'success': False, 'error': '文件夹不存在'})
            
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

@app.route('/api/get-history-images', methods=['POST'])
def get_history_images():
    """获取指定历史记录中的所有图片和canvas状态（用于恢复到画布）"""
    try:
        data = request.get_json()
        folder_name = data.get('name', '')
        
        if not folder_name:
            return jsonify({'success': False, 'error': '未指定文件夹名'})
        
        folder_path = os.path.join(SYNC_CACHE_FOLDER, folder_name)
        
        if not os.path.isdir(folder_path):
            return jsonify({'success': False, 'error': '历史记录不存在'})
        
        result = {}
        
        # 遍历每个语言文件夹
        for lang_folder in os.listdir(folder_path):
            lang_path = os.path.join(folder_path, lang_folder)
            if not os.path.isdir(lang_path):
                continue
            
            images = []
            for filename in os.listdir(lang_path):
                file_path = os.path.join(lang_path, filename)
                # 只处理图片文件
                if os.path.isfile(file_path) and filename.lower().endswith(('.png', '.jpg', '.jpeg')):
                    # 读取图片并转为base64
                    with open(file_path, 'rb') as f:
                        image_data = base64.b64encode(f.read()).decode()
                    
                    images.append({
                        'filename': filename,
                        'imageData': f'data:image/png;base64,{image_data}'
                    })
            
            if images:
                result[lang_folder] = images
        
        print(f"📂 加载历史记录: {folder_name}, 语言数: {len(result)}")
        return jsonify({'success': True, 'name': folder_name, 'images': result})
        
    except Exception as e:
        print(f"❌ 获取历史图片失败: {str(e)}")
        return jsonify({'success': False, 'error': str(e)})

@app.route('/api/update-history', methods=['POST'])
def update_history():
    """更新指定的历史记录（覆盖现有内容）"""
    try:
        data = request.get_json()
        folder_name = data.get('name', '')
        images = data.get('images', [])
        
        if not folder_name:
            return jsonify({'success': False, 'error': '未指定文件夹名'})
        
        folder_path = os.path.join(SYNC_CACHE_FOLDER, folder_name)
        
        # 安全检查
        if not folder_path.startswith(SYNC_CACHE_FOLDER):
            return jsonify({'success': False, 'error': '非法路径'})
        
        if not os.path.isdir(folder_path):
            return jsonify({'success': False, 'error': '历史记录不存在'})
        
        # 清空现有内容
        for lang_folder in os.listdir(folder_path):
            lang_path = os.path.join(folder_path, lang_folder)
            if os.path.isdir(lang_path):
                shutil.rmtree(lang_path)
        
        # 写入新内容
        counts = {}
        for item in images:
            lang_code = item.get('langCode', 'unknown')
            filename = item.get('filename', 'image.png')
            image_data = item.get('imageData', '')
            
            if not image_data:
                continue
            
            lang_folder = os.path.join(folder_path, lang_code)
            os.makedirs(lang_folder, exist_ok=True)
            
            try:
                if ',' in image_data:
                    image_data = image_data.split(',')[1]
                image_bytes = base64.b64decode(image_data)
                
                dest_file = os.path.join(lang_folder, filename)
                with open(dest_file, 'wb') as f:
                    f.write(image_bytes)
                
                counts[lang_code] = counts.get(lang_code, 0) + 1
            except Exception as e:
                print(f"⚠️ 更新失败 {filename}: {e}")
        
        print(f"✅ 历史记录已更新: {folder_name}, 统计: {counts}")
        return jsonify({'success': True, 'counts': counts})
        
    except Exception as e:
        print(f"❌ 更新历史记录失败: {str(e)}")
        return jsonify({'success': False, 'error': str(e)})

@app.route('/api/open-folder', methods=['POST'])
def open_folder():
    """在资源管理器中打开指定文件夹"""
    try:
        data = request.get_json()
        folder_path = data.get('path', '')
        
        if not folder_path or not os.path.isdir(folder_path):
            return jsonify({'success': False, 'error': '路径无效'})
        
        os.startfile(folder_path)
        return jsonify({'success': True})
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

if __name__ == '__main__':
    # 注意：浏览器由启动脚本（bat文件）打开，这里不再重复打开
    # 避免双击bat文件时打开两个浏览器窗口
    
    print("\n" + "="*50)
    print("   Xobi Image Translator 已启动！")
    print("   浏览器将自动打开，或手动访问:")
    print("   http://127.0.0.1:5001")
    print("="*50 + "\n")
    
    app.run(debug=True, port=5001, use_reloader=False)  # 禁用reloader避免重复启动 