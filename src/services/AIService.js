const OpenAI = require('openai');
const axios = require('axios');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Google Vision API configuration
const GOOGLE_VISION_API_KEY = process.env.GOOGLE_VISION_API_KEY;
const GOOGLE_VISION_API_URL = 'https://vision.googleapis.com/v1/images:annotate';

class AIService {
  /**
   * Recognize food from image using Google Vision API
   * @param {string} imageBase64 - Base64 encoded image
   * @param {string} imageUri - Image URI (optional)
   * @returns {Promise<Object>} Recognition result
   */
  static async recognizeFoodFromImage(imageBase64, imageUri = null) {
    try {
      // Process image with sharp for optimization
      const processedImage = await this.processImage(imageBase64);
      
      // Call Google Vision API
      const visionResult = await this.callGoogleVisionAPI(processedImage);
      
      // Process results with OpenAI for food identification
      const foodAnalysis = await this.analyzeFoodWithAI(visionResult);
      
      return {
        success: true,
        foods: foodAnalysis.foods,
        confidence: foodAnalysis.confidence,
        imageUri,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      console.error('Food recognition error:', error);
      throw new Error('食物識別失敗');
    }
  }

  /**
   * Process image for optimal recognition
   * @param {string} imageBase64 - Base64 encoded image
   * @returns {Promise<string>} Processed image base64
   */
  static async processImage(imageBase64) {
    try {
      const buffer = Buffer.from(imageBase64, 'base64');
      
      // Resize and optimize image
      const processedBuffer = await sharp(buffer)
        .resize(1024, 1024, { 
          fit: 'inside',
          withoutEnlargement: true 
        })
        .jpeg({ quality: 85 })
        .toBuffer();
      
      return processedBuffer.toString('base64');
    } catch (error) {
      console.error('Image processing error:', error);
      return imageBase64; // Return original if processing fails
    }
  }

  /**
   * Call Google Vision API for image analysis
   * @param {string} imageBase64 - Processed image base64
   * @returns {Promise<Object>} Vision API result
   */
  static async callGoogleVisionAPI(imageBase64) {
    try {
      const requestBody = {
        requests: [
          {
            image: {
              content: imageBase64
            },
            features: [
              {
                type: 'LABEL_DETECTION',
                maxResults: 20
              },
              {
                type: 'OBJECT_LOCALIZATION',
                maxResults: 10
              },
              {
                type: 'TEXT_DETECTION',
                maxResults: 10
              }
            ]
          }
        ]
      };

      const response = await axios.post(
        `${GOOGLE_VISION_API_URL}?key=${GOOGLE_VISION_API_KEY}`,
        requestBody,
        {
          headers: {
            'Content-Type': 'application/json',
          },
          timeout: 10000,
        }
      );

      return response.data.responses[0];
    } catch (error) {
      console.error('Google Vision API error:', error);
      throw new Error('視覺識別服務暫時無法使用');
    }
  }

  /**
   * Analyze food using OpenAI GPT-4
   * @param {Object} visionResult - Result from Google Vision API
   * @returns {Promise<Object>} Food analysis result
   */
  static async analyzeFoodWithAI(visionResult) {
    try {
      const labels = visionResult.labelAnnotations || [];
      const objects = visionResult.localizedObjectAnnotations || [];
      const texts = visionResult.textAnnotations || [];

      // Extract relevant information
      const labelTexts = labels.map(label => label.description).join(', ');
      const objectTexts = objects.map(obj => obj.name).join(', ');
      const textContent = texts.length > 0 ? texts[0].description : '';

      const prompt = `
        請分析以下圖像識別結果，識別出食物項目並提供營養信息：
        
        標籤: ${labelTexts}
        物件: ${objectTexts}
        文字: ${textContent}
        
        請以JSON格式返回結果，包含：
        1. foods: 食物列表，每個食物包含名稱、估計份量、營養成分
        2. confidence: 整體信心度 (0-1)
        3. suggestions: 改善建議
        
        只返回JSON，不要其他文字。
      `;

      const completion = await openai.chat.completions.create({
        model: 'gpt-4',
        messages: [
          {
            role: 'system',
            content: '你是一個專業的營養師和食物識別專家。請準確識別食物並提供詳細的營養信息。'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.3,
        max_tokens: 2000,
      });

      const responseText = completion.choices[0].message.content;
      
      try {
        return JSON.parse(responseText);
      } catch (parseError) {
        console.error('JSON parse error:', parseError);
        return {
          foods: [],
          confidence: 0.5,
          suggestions: ['無法解析AI回應，請重試']
        };
      }
    } catch (error) {
      console.error('OpenAI analysis error:', error);
      throw new Error('AI分析服務暫時無法使用');
    }
  }

  /**
   * Get personalized nutrition advice using OpenAI
   * @param {Object} userProfile - User profile data
   * @param {Object} nutritionData - Current nutrition data
   * @returns {Promise<Object>} Personalized advice
   */
  static async getPersonalizedNutritionAdvice(userProfile, nutritionData) {
    try {
      const prompt = `
        基於以下用戶資料和營養數據，提供個性化的營養建議：
        
        用戶資料：
        - 年齡: ${userProfile.age || '未知'}
        - 性別: ${userProfile.gender || '未知'}
        - 身高: ${userProfile.height || '未知'} cm
        - 體重: ${userProfile.weight || '未知'} kg
        - 活動量: ${userProfile.activityLevel || '未知'}
        - 目標: ${userProfile.goal || '未知'}
        
        今日營養攝取：
        - 熱量: ${nutritionData.calories || 0} kcal (目標: ${nutritionData.targetCalories || 2000} kcal)
        - 蛋白質: ${nutritionData.protein || 0} g (目標: ${nutritionData.targetProtein || 150} g)
        - 碳水化合物: ${nutritionData.carbs || 0} g (目標: ${nutritionData.targetCarbs || 250} g)
        - 脂肪: ${nutritionData.fat || 0} g (目標: ${nutritionData.targetFat || 67} g)
        - 纖維: ${nutritionData.fiber || 0} g (目標: ${nutritionData.targetFiber || 25} g)
        
        請提供：
        1. 今日營養分析總結
        2. 3-5個具體改善建議
        3. 明日飲食建議
        4. 鼓勵性訊息
        
        請以繁體中文回應，語氣親切專業。
      `;

      const completion = await openai.chat.completions.create({
        model: 'gpt-4',
        messages: [
          {
            role: 'system',
            content: '你是一個專業的營養師，提供個性化、實用且正面的營養建議。'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.7,
        max_tokens: 1500,
      });

      return {
        success: true,
        advice: completion.choices[0].message.content,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      console.error('Nutrition advice error:', error);
      throw new Error('營養建議服務暫時無法使用');
    }
  }

  /**
   * Generate meal plan using AI
   * @param {Object} userProfile - User profile data
   * @param {Object} preferences - User preferences
   * @param {number} days - Number of days to plan
   * @returns {Promise<Object>} Generated meal plan
   */
  static async generateMealPlan(userProfile, preferences, days = 7) {
    try {
      const prompt = `
        為以下用戶生成${days}天的個性化餐食計劃：
        
        用戶資料：
        - 年齡: ${userProfile.age || 30}
        - 性別: ${userProfile.gender || 'female'}
        - 身高: ${userProfile.height || 165} cm
        - 體重: ${userProfile.weight || 60} kg
        - 活動量: ${userProfile.activityLevel || 'moderate'}
        - 目標: ${userProfile.goal || 'maintain_weight'}
        - 每日熱量目標: ${userProfile.targetCalories || 2000} kcal
        
        飲食偏好：
        - 飲食類型: ${preferences.dietType || '一般飲食'}
        - 過敏食物: ${preferences.allergies || '無'}
        - 不喜歡的食物: ${preferences.dislikes || '無'}
        - 特殊需求: ${preferences.specialNeeds || '無'}
        
        請以JSON格式返回詳細的餐食計劃，包含：
        1. 每日三餐和點心的具體食物
        2. 每餐的營養成分估算
        3. 烹調建議
        4. 購物清單
        
        請考慮台灣常見食物和飲食習慣。
      `;

      const completion = await openai.chat.completions.create({
        model: 'gpt-4',
        messages: [
          {
            role: 'system',
            content: '你是一個專業的營養師和餐食規劃師，熟悉台灣飲食文化和營養需求。'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.6,
        max_tokens: 3000,
      });

      const responseText = completion.choices[0].message.content;
      
      try {
        const mealPlan = JSON.parse(responseText);
        return {
          success: true,
          mealPlan,
          generatedAt: new Date().toISOString(),
          validUntil: new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString(),
        };
      } catch (parseError) {
        console.error('Meal plan JSON parse error:', parseError);
        return {
          success: true,
          mealPlan: { error: '無法解析餐食計劃，請重試' },
          generatedAt: new Date().toISOString(),
        };
      }
    } catch (error) {
      console.error('Meal plan generation error:', error);
      throw new Error('餐食計劃生成服務暫時無法使用');
    }
  }

  /**
   * Analyze nutrition trends using AI
   * @param {Array} nutritionHistory - Historical nutrition data
   * @param {Object} userProfile - User profile data
   * @returns {Promise<Object>} Trend analysis result
   */
  static async analyzeNutritionTrends(nutritionHistory, userProfile) {
    try {
      const prompt = `
        分析以下用戶的營養趨勢數據：
        
        用戶資料：
        - 目標: ${userProfile.goal || '維持體重'}
        - 目標熱量: ${userProfile.targetCalories || 2000} kcal/天
        
        過去${nutritionHistory.length}天的營養數據：
        ${JSON.stringify(nutritionHistory, null, 2)}
        
        請分析：
        1. 熱量攝取趨勢
        2. 營養素平衡情況
        3. 進步和需要改善的地方
        4. 具體建議
        5. 預測未來趨勢
        
        請以繁體中文回應，提供專業且實用的分析。
      `;

      const completion = await openai.chat.completions.create({
        model: 'gpt-4',
        messages: [
          {
            role: 'system',
            content: '你是一個專業的營養分析師，擅長分析營養趨勢和提供改善建議。'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.5,
        max_tokens: 2000,
      });

      return {
        success: true,
        analysis: completion.choices[0].message.content,
        analyzedAt: new Date().toISOString(),
        periodDays: nutritionHistory.length,
      };
    } catch (error) {
      console.error('Trend analysis error:', error);
      throw new Error('趨勢分析服務暫時無法使用');
    }
  }
}

module.exports = AIService;
