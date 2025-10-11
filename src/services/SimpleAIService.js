const OpenAI = require('openai');
const fs = require('fs');

class SimpleAIService {
  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  async analyzeFoodImage(imagePath) {
    try {
      // 檢查API Key是否配置
      if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY === 'your_openai_api_key_here') {
        throw new Error('OpenAI API Key 未配置，請在 .env 文件中設置 OPENAI_API_KEY');
      }

      // 檢查圖片文件是否存在
      if (!fs.existsSync(imagePath)) {
        throw new Error('圖片文件不存在');
      }

      // 讀取圖片文件
      const imageBuffer = fs.readFileSync(imagePath);
      const base64Image = imageBuffer.toString('base64');

      // 使用OpenAI Vision API進行食物識別
      const completion = await this.openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `請分析這張圖片中的食物。如果圖片中沒有食物（比如是人、風景、其他物品等），請明確說明"這不是食物圖片"。如果確實是食物，請提供：

1. 食物名稱（中文）
2. 識別信心度（0-100%）
3. 份量估算（例如：150g、1碗、1片等）
4. 營養成分分析（每100g的營養價值）：
   - 熱量（卡路里）
   - 蛋白質（g）
   - 脂肪（g）
   - 碳水化合物（g）

請以JSON格式回答，格式如下：
{
  "isFood": true/false,
  "foodName": "食物名稱",
  "confidence": "信心度%",
  "servingSize": "份量",
  "nutrition": {
    "calories": 熱量,
    "protein": 蛋白質,
    "fat": 脂肪,
    "carbs": 碳水化合物
  },
  "description": "食物描述"
}`
              },
              {
                type: "image_url",
                image_url: {
                  url: `data:image/jpeg;base64,${base64Image}`
                }
              }
            ]
          }
        ],
        max_tokens: 1000,
        temperature: 0.3
      });

      const response = completion.choices[0].message.content;
      
      // 嘗試解析JSON響應
      let analysisResult;
      try {
        // 提取JSON部分
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          analysisResult = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error('無法解析AI響應');
        }
      } catch (parseError) {
        console.error('AI響應解析錯誤:', parseError);
        throw new Error('AI響應格式錯誤');
      }

      // 驗證響應格式
      if (!analysisResult.isFood) {
        return {
          success: false,
          error: '這不是食物圖片，請拍攝食物進行識別'
        };
      }

      return {
        success: true,
        data: {
          foodName: analysisResult.foodName || '未知食物',
          confidence: analysisResult.confidence || 'N/A',
          nutrition: analysisResult.nutrition || {
            calories: 0,
            protein: 0,
            fat: 0,
            carbs: 0
          },
          servingSize: analysisResult.servingSize || 'N/A',
          description: analysisResult.description || ''
        }
      };
    } catch (error) {
      console.error('AI服務錯誤:', error);
      return {
        success: false,
        error: error.message || 'AI分析失敗'
      };
    }
  }
}

module.exports = new SimpleAIService();
