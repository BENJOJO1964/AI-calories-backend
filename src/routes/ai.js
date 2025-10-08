const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const AIService = require('../services/AIService');
const { authenticateToken } = require('../middleware/auth');
const { validateRequest } = require('../middleware/validation');
const { rateLimit } = require('../database/redis');
const router = express.Router();

// Configure multer for image uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../../uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'food-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE) || 10 * 1024 * 1024, // 10MB
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('只支援圖片檔案 (JPEG, JPG, PNG, GIF)'));
    }
  }
});

/**
 * @route POST /api/ai/recognize-food
 * @desc Recognize food from uploaded image
 * @access Private
 */
router.post('/recognize-food', 
  authenticateToken,
  upload.single('image'),
  async (req, res) => {
    try {
      // Rate limiting
      const rateLimitKey = `ai_recognize_${req.user.id}`;
      const rateLimitResult = await rateLimit.check(rateLimitKey, 10, 3600); // 10 requests per hour
      
      if (!rateLimitResult.allowed) {
        return res.status(429).json({
          success: false,
          message: '請求過於頻繁，請稍後再試',
          retryAfter: rateLimitResult.resetTime
        });
      }

      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: '請上傳圖片檔案'
        });
      }

      // Read and encode image
      const imageBuffer = fs.readFileSync(req.file.path);
      const imageBase64 = imageBuffer.toString('base64');
      
      // Recognize food
      const result = await AIService.recognizeFoodFromImage(imageBase64, req.file.path);
      
      // Clean up uploaded file
      fs.unlinkSync(req.file.path);
      
      res.json(result);
    } catch (error) {
      console.error('Food recognition error:', error);
      
      // Clean up uploaded file if it exists
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      
      res.status(500).json({
        success: false,
        message: error.message || '食物識別失敗'
      });
    }
  }
);

/**
 * @route POST /api/ai/recognize-food-base64
 * @desc Recognize food from base64 encoded image
 * @access Private
 */
router.post('/recognize-food-base64',
  authenticateToken,
  validateRequest({
    body: {
      image: { required: true, type: 'string' },
      imageUri: { required: false, type: 'string' }
    }
  }),
  async (req, res) => {
    try {
      // Rate limiting
      const rateLimitKey = `ai_recognize_${req.user.id}`;
      const rateLimitResult = await rateLimit.check(rateLimitKey, 10, 3600);
      
      if (!rateLimitResult.allowed) {
        return res.status(429).json({
          success: false,
          message: '請求過於頻繁，請稍後再試',
          retryAfter: rateLimitResult.resetTime
        });
      }

      const { image, imageUri } = req.body;
      
      // Remove data URL prefix if present
      const base64Data = image.replace(/^data:image\/[a-z]+;base64,/, '');
      
      // Recognize food
      const result = await AIService.recognizeFoodFromImage(base64Data, imageUri);
      
      res.json(result);
    } catch (error) {
      console.error('Food recognition error:', error);
      res.status(500).json({
        success: false,
        message: error.message || '食物識別失敗'
      });
    }
  }
);

/**
 * @route POST /api/ai/nutrition-advice
 * @desc Get personalized nutrition advice
 * @access Private
 */
router.post('/nutrition-advice',
  authenticateToken,
  validateRequest({
    body: {
      nutritionData: { required: true, type: 'object' }
    }
  }),
  async (req, res) => {
    try {
      // Rate limiting
      const rateLimitKey = `ai_advice_${req.user.id}`;
      const rateLimitResult = await rateLimit.check(rateLimitKey, 5, 3600); // 5 requests per hour
      
      if (!rateLimitResult.allowed) {
        return res.status(429).json({
          success: false,
          message: '請求過於頻繁，請稍後再試',
          retryAfter: rateLimitResult.resetTime
        });
      }

      const { nutritionData } = req.body;
      
      // Get user profile
      const { query } = require('../database/connection');
      const userResult = await query(
        'SELECT * FROM users WHERE id = $1',
        [req.user.id]
      );
      
      if (userResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: '用戶不存在'
        });
      }
      
      const userProfile = userResult.rows[0];
      
      // Get personalized advice
      const advice = await AIService.getPersonalizedNutritionAdvice(userProfile, nutritionData);
      
      // Log the analysis
      const { query: logQuery } = require('../database/connection');
      await logQuery(
        'INSERT INTO ai_analysis_logs (user_id, analysis_type, input_data, output_data, confidence_score, model_version) VALUES ($1, $2, $3, $4, $5, $6)',
        [
          req.user.id,
          'nutrition_advice',
          JSON.stringify({ userProfile, nutritionData }),
          JSON.stringify(advice),
          0.9,
          'gpt-4'
        ]
      );
      
      res.json(advice);
    } catch (error) {
      console.error('Nutrition advice error:', error);
      res.status(500).json({
        success: false,
        message: error.message || '營養建議生成失敗'
      });
    }
  }
);

/**
 * @route POST /api/ai/generate-meal-plan
 * @desc Generate personalized meal plan
 * @access Private
 */
router.post('/generate-meal-plan',
  authenticateToken,
  validateRequest({
    body: {
      preferences: { required: false, type: 'object' },
      days: { required: false, type: 'number', min: 1, max: 30 }
    }
  }),
  async (req, res) => {
    try {
      // Rate limiting
      const rateLimitKey = `ai_meal_plan_${req.user.id}`;
      const rateLimitResult = await rateLimit.check(rateLimitKey, 3, 86400); // 3 requests per day
      
      if (!rateLimitResult.allowed) {
        return res.status(429).json({
          success: false,
          message: '請求過於頻繁，請稍後再試',
          retryAfter: rateLimitResult.resetTime
        });
      }

      const { preferences = {}, days = 7 } = req.body;
      
      // Get user profile
      const { query } = require('../database/connection');
      const userResult = await query(
        'SELECT * FROM users WHERE id = $1',
        [req.user.id]
      );
      
      if (userResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: '用戶不存在'
        });
      }
      
      const userProfile = userResult.rows[0];
      
      // Generate meal plan
      const mealPlan = await AIService.generateMealPlan(userProfile, preferences, days);
      
      // Log the analysis
      const { query: logQuery } = require('../database/connection');
      await logQuery(
        'INSERT INTO ai_analysis_logs (user_id, analysis_type, input_data, output_data, confidence_score, model_version) VALUES ($1, $2, $3, $4, $5, $6)',
        [
          req.user.id,
          'meal_planning',
          JSON.stringify({ userProfile, preferences, days }),
          JSON.stringify(mealPlan),
          0.8,
          'gpt-4'
        ]
      );
      
      res.json(mealPlan);
    } catch (error) {
      console.error('Meal plan generation error:', error);
      res.status(500).json({
        success: false,
        message: error.message || '餐食計劃生成失敗'
      });
    }
  }
);

/**
 * @route POST /api/ai/analyze-trends
 * @desc Analyze nutrition trends
 * @access Private
 */
router.post('/analyze-trends',
  authenticateToken,
  validateRequest({
    body: {
      period: { required: false, type: 'number', min: 7, max: 365 } // days
    }
  }),
  async (req, res) => {
    try {
      // Rate limiting
      const rateLimitKey = `ai_trends_${req.user.id}`;
      const rateLimitResult = await rateLimit.check(rateLimitKey, 2, 86400); // 2 requests per day
      
      if (!rateLimitResult.allowed) {
        return res.status(429).json({
          success: false,
          message: '請求過於頻繁，請稍後再試',
          retryAfter: rateLimitResult.resetTime
        });
      }

      const { period = 30 } = req.body;
      
      // Get user profile
      const { query } = require('../database/connection');
      const userResult = await query(
        'SELECT * FROM users WHERE id = $1',
        [req.user.id]
      );
      
      if (userResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: '用戶不存在'
        });
      }
      
      const userProfile = userResult.rows[0];
      
      // Get nutrition history
      const historyResult = await query(
        `SELECT 
          log_date,
          SUM(calories) as calories,
          SUM(protein) as protein,
          SUM(carbs) as carbs,
          SUM(fat) as fat,
          SUM(fiber) as fiber
        FROM user_food_logs 
        WHERE user_id = $1 
          AND log_date >= CURRENT_DATE - INTERVAL '${period} days'
        GROUP BY log_date 
        ORDER BY log_date ASC`,
        [req.user.id]
      );
      
      const nutritionHistory = historyResult.rows;
      
      if (nutritionHistory.length === 0) {
        return res.status(400).json({
          success: false,
          message: '沒有足夠的營養數據進行分析'
        });
      }
      
      // Analyze trends
      const analysis = await AIService.analyzeNutritionTrends(nutritionHistory, userProfile);
      
      // Log the analysis
      const { query: logQuery } = require('../database/connection');
      await logQuery(
        'INSERT INTO ai_analysis_logs (user_id, analysis_type, input_data, output_data, confidence_score, model_version) VALUES ($1, $2, $3, $4, $5, $6)',
        [
          req.user.id,
          'trend_analysis',
          JSON.stringify({ userProfile, nutritionHistory, period }),
          JSON.stringify(analysis),
          0.85,
          'gpt-4'
        ]
      );
      
      res.json(analysis);
    } catch (error) {
      console.error('Trend analysis error:', error);
      res.status(500).json({
        success: false,
        message: error.message || '趨勢分析失敗'
      });
    }
  }
);

/**
 * @route GET /api/ai/tips
 * @desc Get daily AI tips
 * @access Private
 */
router.get('/tips',
  authenticateToken,
  async (req, res) => {
    try {
      // Rate limiting
      const rateLimitKey = `ai_tips_${req.user.id}`;
      const rateLimitResult = await rateLimit.check(rateLimitKey, 10, 3600); // 10 requests per hour
      
      if (!rateLimitResult.allowed) {
        return res.status(429).json({
          success: false,
          message: '請求過於頻繁，請稍後再試',
          retryAfter: rateLimitResult.resetTime
        });
      }

      // Get user profile for personalized tips
      const { query } = require('../database/connection');
      const userResult = await query(
        'SELECT goal, target_calories FROM users WHERE id = $1',
        [req.user.id]
      );
      
      const userProfile = userResult.rows[0] || {};
      
      // Generate personalized tip using OpenAI
      const prompt = `
        為一個${userProfile.goal || '維持體重'}目標的用戶生成一個簡短實用的營養小貼士。
        目標熱量：${userProfile.target_calories || 2000} kcal/天
        
        請提供：
        1. 一個實用的營養建議
        2. 簡短說明為什麼這個建議有效
        3. 具體的執行方法
        
        請用繁體中文，語氣親切，內容簡潔（不超過100字）。
      `;

      const completion = await require('openai').chat.completions.create({
        model: 'gpt-4',
        messages: [
          {
            role: 'system',
            content: '你是一個專業的營養師，提供簡潔實用的營養小貼士。'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.7,
        max_tokens: 200,
      });

      const tip = completion.choices[0].message.content;
      
      res.json({
        success: true,
        tip,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('AI tips error:', error);
      res.status(500).json({
        success: false,
        message: error.message || '小貼士生成失敗'
      });
    }
  }
);

module.exports = router;
