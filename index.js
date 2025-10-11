const express = require('express');
const multer = require('multer');
const cors = require('cors');
const OpenAI = require('openai');
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
  res.json({ 
    message: 'Backend is working with NEW CODE!',
    version: 'root-v1',
    timestamp: new Date().toISOString()
  });
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    version: 'fixed-v2-DEPLOYED',
    hasOpenAIKey: !!process.env.OPENAI_API_KEY,
    message: 'This is the new backend code'
  });
});

app.get('/test-new-endpoint', (req, res) => {
  res.json({
    message: 'NEW ENDPOINT WORKING!',
    timestamp: new Date().toISOString(),
    version: 'test-v1'
  });
});

app.post('/api/food-recognition/analyze', upload.single('image'), async (req, res) => {
  console.log('收到圖片上傳請求 - 使用真實AI分析');
  console.log('OpenAI API Key存在:', !!process.env.OPENAI_API_KEY);
  
  if (!req.file) {
    return res.status(400).json({
      success: false,
      message: '請上傳圖片檔案'
    });
  }
  
  console.log('圖片大小:', req.file.size, 'bytes');
  console.log('圖片類型:', req.file.mimetype);
  
  try {
    // 檢查API Key
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({
        success: false,
        message: 'OpenAI API Key 未配置'
      });
    }

    // 使用真實的OpenAI Vision API進行分析
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    const base64Image = req.file.buffer.toString('base64');
    
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: [
            { 
              type: "text", 
              text: "這張圖片裡有什麼食物？請估計份量，並提供其熱量、蛋白質、脂肪、碳水化合物的估算值。請以繁體中文和JSON格式回應，包含 foodName, confidence (百分比), servingSize, nutrition { calories, protein, fat, carbs }。如果圖片中沒有食物，請明確說明。" 
            },
            {
              type: "image_url",
              image_url: {
                url: `data:image/jpeg;base64,${base64Image}`,
              },
            },
          ],
        },
      ],
      max_tokens: 500,
    });

    const content = response.choices[0].message.content;
    console.log("OpenAI Raw Response:", content);

    // 嘗試解析JSON
    const jsonMatch = content.match(/```json\n([\s\S]*?)\n```/);
    if (jsonMatch && jsonMatch[1]) {
      const parsedData = JSON.parse(jsonMatch[1]);
      
      res.json({ 
        success: true, 
        message: 'AI成功識別食物！',
        foods: [{ 
          name: parsedData.foodName, 
          confidence: parseFloat(parsedData.confidence.replace('%', '')) / 100,
          estimatedServing: parsedData.servingSize,
          nutrition: {
            calories: parsedData.nutrition.calories,
            protein: parsedData.nutrition.protein,
            carbs: parsedData.nutrition.carbs,
            fat: parsedData.nutrition.fat,
            fiber: 0,
            sugar: 0,
            sodium: 0
          }
        }],
        confidence: parseFloat(parsedData.confidence.replace('%', '')) / 100,
        timestamp: new Date().toISOString()
      });
    } else {
      if (content.includes("沒有食物") || content.includes("非食物")) {
        res.status(400).json({
          success: false,
          message: "圖片中未識別到食物，請重新拍攝或上傳食物圖片。"
        });
      } else {
        res.status(400).json({
          success: false,
          message: "AI分析失敗，請重試。"
        });
      }
    }
  } catch (error) {
    console.error('AI分析錯誤:', error);
    console.error('錯誤詳情:', error.message);
    
    res.status(500).json({
      success: false,
      message: `AI分析失敗: ${error.message}`,
      error: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// 對於 Vercel，不需要 app.listen
if (!process.env.VERCEL) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`Server running on port ${port}`);
  });
}

module.exports = app;