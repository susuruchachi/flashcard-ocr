import json
import base64
import cv2
import numpy as np
from paddleocr import PaddleOCR
from PIL import Image
import io
from http.server import BaseHTTPRequestHandler
import traceback

# PaddleOCR 初期化（言語自動判定）
ocr = PaddleOCR(use_angle_cls=True, lang='en')

class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        """POST リクエストで画像を受け取り、OCR 処理を実行"""
        
        try:
            # リクエスト本体を読む
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length)
            data = json.loads(body.decode())
            
            # Base64 画像データをデコード
            image_data = data.get('image', '')
            if image_data.startswith('data:image'):
                image_data = image_data.split(',')[1]
            
            image_bytes = base64.b64decode(image_data)
            image = Image.open(io.BytesIO(image_bytes))
            image_cv = cv2.cvtColor(np.array(image), cv2.COLOR_RGB2BGR)
            
            # レイアウト認識 + OCR 処理
            pairs = process_flashcard(image_cv)
            
            # レスポンス
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            
            response = json.dumps({'success': True, 'pairs': pairs})
            self.wfile.write(response.encode())
            
        except Exception as e:
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            
            error_response = json.dumps({
                'success': False,
                'error': str(e),
                'traceback': traceback.format_exc()
            })
            self.wfile.write(error_response.encode())
    
    def do_OPTIONS(self):
        """CORS プリフライト対応"""
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()


def process_flashcard(image_cv):
    """
    単語帳画像を処理して、単語と説明のペアを抽出
    """
    
    # グレースケール化
    gray = cv2.cvtColor(image_cv, cv2.COLOR_BGR2GRAY)
    
    # 二値化
    _, binary = cv2.threshold(gray, 150, 255, cv2.THRESH_BINARY)
    
    # 左右のカラムを検出
    try:
        split_point = detect_column_split(binary, image_cv.shape[1])
        
        if split_point and 0.3 * image_cv.shape[1] < split_point < 0.7 * image_cv.shape[1]:
            # 左右に分割
            left_image = image_cv[:, :split_point]
            right_image = image_cv[:, split_point:]
            
            # 各カラムで OCR
            left_text_result = ocr.ocr(left_image, cls=True)
            right_text_result = ocr.ocr(right_image, cls=True)
            
            # テキストと位置情報を抽出
            left_texts = extract_texts_with_position(left_text_result)
            right_texts = extract_texts_with_position(right_text_result)
            
            # テキストペアを作成
            pairs = match_word_explanation(left_texts, right_texts)
            
        else:
            # カラム分割失敗時は全体でOCR
            full_result = ocr.ocr(image_cv, cls=True)
            pairs = simple_extract(full_result)
    
    except Exception as e:
        # エラー時は全体でOCR
        full_result = ocr.ocr(image_cv, cls=True)
        pairs = simple_extract(full_result)
    
    return pairs


def detect_column_split(binary, width):
    """
    左右のカラムの分割点を検出
    """
    
    # 垂直方向の白ピクセルを数える
    vertical_projection = np.sum(binary == 255, axis=0)
    
    # スムージング
    kernel_size = max(5, width // 50)
    if kernel_size % 2 == 0:
        kernel_size += 1
    vertical_projection = cv2.blur(
        vertical_projection.astype(np.float32).reshape(-1, 1),
        (kernel_size, 1)
    ).flatten()
    
    # 最小値を探す（カラム間の空白）
    min_point = np.argmin(vertical_projection[int(width*0.2):int(width*0.8)]) + int(width*0.2)
    
    return min_point if vertical_projection[min_point] < np.mean(vertical_projection) * 0.5 else None


def extract_texts_with_position(ocr_result):
    """
    OCR 結果からテキストと位置情報を抽出
    """
    texts = []
    
    if ocr_result:
        for line in ocr_result:
            for word_info in line:
                bbox, (text, confidence) = word_info
                # bbox から y 座標を取得
                y_coords = [point[1] for point in bbox]
                y_center = sum(y_coords) / len(y_coords)
                
                texts.append({
                    'text': text,
                    'confidence': confidence,
                    'y_position': y_center
                })
    
    return texts


def match_word_explanation(left_texts, right_texts):
    """
    左カラム（単語）と右カラム（説明）をマッチング
    """
    pairs = []
    
    for left_item in left_texts:
        word = left_item['text'].strip()
        word_confidence = left_item['confidence']
        y_pos = left_item['y_position']
        
        # 同じ高さにある説明を探す
        best_match = None
        best_distance = float('inf')
        
        for right_item in right_texts:
            explanation = right_item['text'].strip()
            y_right = right_item['y_position']
            distance = abs(y_pos - y_right)
            
            if distance < best_distance:
                best_distance = distance
                best_match = explanation
        
        if best_match and word and len(word) < 50:
            # 信頼度フィルター
            if word_confidence > 0.5:
                pairs.append({
                    'word': word,
                    'explanation': best_match[:200],  # 200文字まで
                    'confidence': round(word_confidence * 100)
                })
    
    return pairs


def simple_extract(ocr_result):
    """
    カラム分割失敗時のフォールバック
    """
    pairs = []
    lines = []
    
    if ocr_result:
        for line in ocr_result:
            for word_info in line:
                _, (text, confidence) = word_info
                if text.strip():
                    lines.append({
                        'text': text.strip(),
                        'confidence': confidence
                    })
    
    # 簡易的に単語と説明をペアリング
    i = 0
    while i < len(lines):
        word_item = lines[i]
        word = word_item['text']
        
        # 単語の判定（短い + 英字）
        if len(word) < 50 and any(c.isalpha() for c in word) and word_item['confidence'] > 0.5:
            explanation = ''
            i += 1
            
            # 次の単語が来るまで説明を集める
            while i < len(lines):
                next_text = lines[i]['text']
                
                # 次の単語らしき行に到達
                if (len(next_text) < 50 and 
                    any(c.isalpha() for c in next_text) and 
                    not any(c.isdigit() for c in next_text)):
                    break
                
                explanation += (' ' if explanation else '') + next_text
                i += 1
            
            if explanation:
                pairs.append({
                    'word': word,
                    'explanation': explanation[:200],
                    'confidence': round(word_item['confidence'] * 100)
                })
        else:
            i += 1
    
    return pairs
