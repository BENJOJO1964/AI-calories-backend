const express = require('express');
const multer = require('multer');
const cors = require('cors');
require('dotenv').config();

const app = express();

// 啟用CORS
app.use(cors({
  origin: '*',
  credentials: true
}));

// 配置multer處理圖片上傳
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  }
});

app.get('/', (req, res) => {
  res.json({ message: 'Backend is working!' });
});

app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.post('/api/food-recognition/analyze', upload.single('image'), (req, res) => {
  console.log('收到圖片上傳請求');
  
  if (!req.file) {
    return res.status(400).json({
      success: false,
      message: '請上傳圖片檔案'
    });
  }
  
  console.log('圖片大小:', req.file.size, 'bytes');
  console.log('圖片類型:', req.file.mimetype);
  
  // 模擬AI分析結果
  res.json({ 
    success: true, 
    message: '圖片上傳成功！AI正在分析...',
    foods: [{ 
      name: '測試食物', 
      confidence: 0.95,
      estimatedServing: '100g',
      nutrition: {
        calories: 150,
        protein: 10,
        carbs: 20,
        fat: 5,
        fiber: 2,
        sugar: 3,
        sodium: 200
      }
    }],
    confidence: 0.95,
    timestamp: new Date().toISOString()
  });
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

module.exports = app;
