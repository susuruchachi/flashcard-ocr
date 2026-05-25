import React, { useState, useRef, useEffect } from 'react';

export default function FlashcardOCRApp() {
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState('');
  const fileInputRef = useRef(null);
  const [apiUrl] = useState(
    process.env.REACT_APP_API_URL || 'https://your-project.vercel.app/api/ocr'
  );

  // pdf.js を初期化
  useEffect(() => {
    // pdf.js の Worker を設定
    if (window.pdfjsWorker === undefined) {
      window.pdfjsWorker = true;
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
      script.onload = () => {
        window.pdfjsLib = window.pdfjsLib || {};
        window.pdfjsLib.GlobalWorkerOptions = window.pdfjsLib.GlobalWorkerOptions || {};
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = 
          'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      };
      document.head.appendChild(script);
    }
  }, []);

  // PDF を画像に変換
  const pdfToImages = async (pdfFile) => {
    try {
      setStatusText('PDF を読み込み中...');
      
      const arrayBuffer = await pdfFile.arrayBuffer();
      const pdfjsLib = window.pdfjsLib;
      
      if (!pdfjsLib || !pdfjsLib.getDocument) {
        throw new Error('pdf.js が読み込まれていません。ページをリロードしてください。');
      }

      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      const images = [];

      for (let i = 1; i <= pdf.numPages; i++) {
        setStatusText(`PDF から画像を抽出中... (${i}/${pdf.numPages})`);
        
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 2 });
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.width = viewport.width;
        canvas.height = viewport.height;

        await page.render({ canvasContext: context, viewport }).promise;
        const imageData = canvas.toDataURL('image/png');
        images.push({
          data: imageData,
          pageNumber: i,
          fileName: `${pdfFile.name} - Page ${i}`
        });
      }

      return images;
    } catch (error) {
      console.error('PDF 読み込みエラー:', error);
      throw new Error(`PDF 処理エラー: ${error.message}`);
    }
  };

  // 画像を OCR 処理
  const processImage = async (imageData, fileName) => {
    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: imageData })
      });

      if (!response.ok) {
        throw new Error(`Server error: ${response.statusText}`);
      }

      const data = await response.json();

      if (data.success) {
        return {
          fileName: fileName,
          pairs: data.pairs || []
        };
      } else {
        throw new Error(data.error || '不明なエラー');
      }
    } catch (error) {
      console.error('OCR 処理エラー:', error);
      throw error;
    }
  };

  // ファイルをアップロード・処理
  const handleFileUpload = async (event) => {
    const files = Array.from(event.target.files);
    setLoading(true);
    setProgress(0);
    setStatusText('');
    const allResults = [];
    const allImages = [];

    try {
      // ステップ 1: ファイルを画像に変換（PDF の場合）
      let totalImages = 0;
      for (const file of files) {
        if (file.type === 'application/pdf') {
          const pdfImages = await pdfToImages(file);
          allImages.push(...pdfImages);
          totalImages += pdfImages.length;
        } else if (file.type.startsWith('image/')) {
          const reader = new FileReader();
          const imageData = await new Promise((resolve) => {
            reader.onload = (e) => resolve(e.target.result);
            reader.readAsDataURL(file);
          });
          allImages.push({
            data: imageData,
            pageNumber: 1,
            fileName: file.name
          });
          totalImages += 1;
        }
      }

      if (totalImages === 0) {
        alert('画像または PDF ファイルを選択してください');
        setLoading(false);
        return;
      }

      // ステップ 2: 各画像を OCR 処理
      for (let i = 0; i < allImages.length; i++) {
        const image = allImages[i];
        const percentComplete = Math.round(((i + 1) / allImages.length) * 100);
        setProgress(percentComplete);
        setStatusText(`OCR 処理中... (${i + 1}/${allImages.length})`);

        try {
          const result = await processImage(image.data, image.fileName);
          allResults.push(result);
        } catch (error) {
          console.error(`${image.fileName} の処理に失敗:`, error);
          allResults.push({
            fileName: image.fileName,
            pairs: [],
            error: error.message
          });
        }

        // API の負荷を軽減するため、短い遅延
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      setResults(allResults);
      setStatusText('');
    } catch (error) {
      console.error('処理エラー:', error);
      alert(`エラーが発生しました: ${error.message}`);
      setStatusText('');
    } finally {
      setLoading(false);
      setProgress(100);
    }
  };

  // ペアを更新
  const updatePair = (fileIndex, pairIndex, field, value) => {
    const newResults = [...results];
    newResults[fileIndex].pairs[pairIndex][field] = value;
    setResults(newResults);
  };

  // ペアを削除
  const deletePair = (fileIndex, pairIndex) => {
    const newResults = [...results];
    newResults[fileIndex].pairs.splice(pairIndex, 1);
    setResults(newResults);
  };

  // CSV ダウンロード
  const downloadCSV = () => {
    let csvContent = '答え,問題\n';

    results.forEach((result) => {
      result.pairs.forEach((pair) => {
        const answer = `"${pair.word.replace(/"/g, '""')}"`;
        const question = `"${pair.explanation.replace(/"/g, '""')}"`;
        csvContent += `${answer},${question}\n`;
      });
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `flashcards_${new Date().getTime()}.csv`;
    link.click();
  };

  const totalPairs = results.reduce((sum, r) => sum + r.pairs.length, 0);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-8">
      <div className="max-w-6xl mx-auto">
        {/* ヘッダー */}
        <div className="mb-12">
          <h1 className="text-4xl font-bold text-slate-900 mb-3">
            📚 単語帳 OCR コンバーター
          </h1>
          <p className="text-lg text-slate-600">
            単語帳の画像やPDFから高精度で Anki CSV を自動生成
          </p>
          <p className="text-sm text-slate-500 mt-2">
            クラウド AI で 95%以上の精度を実現
          </p>
        </div>

        {/* アップロードエリア */}
        <div
          className="bg-white rounded-lg shadow-md border-2 border-dashed border-slate-300 p-12 mb-8 text-center hover:border-blue-400 transition-all cursor-pointer"
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,.pdf"
            onChange={handleFileUpload}
            disabled={loading}
            className="hidden"
          />
          <div>
            <svg
              className="w-16 h-16 mx-auto mb-4 text-slate-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M12 4v16m8-8H4"
              />
            </svg>
            <p className="text-xl font-semibold text-slate-900 mb-2">
              {loading ? 'OCR 処理中...' : '画像またはPDFをドラッグ＆ドロップ'}
            </p>
            <p className="text-sm text-slate-500">PNG, JPG, PDF に対応</p>

            {loading && (
              <div className="mt-6 w-full max-w-xs mx-auto">
                <div className="w-full bg-slate-200 rounded-full h-2 overflow-hidden">
                  <div
                    className="bg-blue-600 h-2 transition-all duration-300"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <p className="text-sm text-slate-600 mt-2">{progress}%</p>
                {statusText && (
                  <p className="text-xs text-slate-500 mt-2">{statusText}</p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* 結果エリア */}
        {results.length > 0 && (
          <div className="space-y-8">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <p className="text-blue-900 font-semibold">
                ✅ {totalPairs} 個の単語が抽出されました
              </p>
            </div>

            {results.map((result, fileIndex) => (
              <div key={fileIndex} className="bg-white rounded-lg shadow-md p-8">
                <h2 className="text-2xl font-bold text-slate-900 mb-4">
                  {result.fileName}
                </h2>
                
                {result.error && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
                    <p className="text-red-900 text-sm">
                      ⚠️ エラー: {result.error}
                    </p>
                  </div>
                )}

                <p className="text-sm text-slate-600 mb-6">
                  {result.pairs.length} 個の単語
                </p>

                {result.pairs.length > 0 && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-100 border-b-2 border-slate-300">
                        <tr>
                          <th className="px-4 py-3 text-left font-semibold text-slate-700 w-1/4">
                            答え（単語）
                          </th>
                          <th className="px-4 py-3 text-left font-semibold text-slate-700 flex-1">
                            問題（説明）
                          </th>
                          <th className="px-4 py-3 text-center font-semibold text-slate-700 w-20">
                            信頼度
                          </th>
                          <th className="px-4 py-3 text-center w-12">削除</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.pairs.map((pair, pairIndex) => (
                          <tr
                            key={pairIndex}
                            className="border-b border-slate-200 hover:bg-slate-50 transition-colors"
                          >
                            <td className="px-4 py-3">
                              <input
                                type="text"
                                value={pair.word}
                                onChange={(e) =>
                                  updatePair(
                                    fileIndex,
                                    pairIndex,
                                    'word',
                                    e.target.value
                                  )
                                }
                                className="w-full px-2 py-1 border border-slate-300 rounded font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                              />
                            </td>
                            <td className="px-4 py-3">
                              <textarea
                                value={pair.explanation}
                                onChange={(e) =>
                                  updatePair(
                                    fileIndex,
                                    pairIndex,
                                    'explanation',
                                    e.target.value
                                  )
                                }
                                rows="2"
                                className="w-full px-2 py-1 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                              />
                            </td>
                            <td className="px-4 py-3 text-center">
                              <span className="text-xs font-semibold text-slate-600">
                                {pair.confidence}%
                              </span>
                            </td>
                            <td className="px-4 py-3 text-center">
                              <button
                                onClick={() => deletePair(fileIndex, pairIndex)}
                                className="text-red-500 hover:text-red-700 font-bold text-lg transition-colors"
                              >
                                ×
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ))}

            {/* ダウンロードボタン */}
            <div className="flex gap-4 justify-center">
              <button
                onClick={downloadCSV}
                className="px-8 py-4 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg shadow-md transition-all active:scale-95"
              >
                📥 CSV をダウンロード
              </button>
              <button
                onClick={() => {
                  setResults([]);
                }}
                className="px-8 py-4 bg-slate-300 hover:bg-slate-400 text-slate-900 font-bold rounded-lg shadow-md transition-all active:scale-95"
              >
                🔄 リセット
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
