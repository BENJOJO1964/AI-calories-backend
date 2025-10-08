const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { authenticateToken } = require('../middleware/auth');
const { validateRequest } = require('../middleware/validation');
const { query } = require('../database/connection');
const SimpleAIService = require('../services/SimpleAIService');
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
    cb(null, 'food-recognition-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('只支援圖片檔案 (JPEG, JPG, PNG, GIF, WEBP)'));
    }
  }
});

/**
 * @route POST /api/food-recognition/analyze
 * @desc Analyze food image and return nutrition data
 * @access Public (for demo)
 */
router.post('/analyze',
  upload.single('image'),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: '請上傳圖片檔案'
        });
      }

      // 使用真實AI服務進行食物識別
      const recognitionResult = await SimpleAIService.analyzeFoodImage(req.file.path);
      
      // 清理上傳的文件
      fs.unlinkSync(req.file.path);
      
      if (recognitionResult.success) {
        // 轉換為前端期望的格式
        const formattedResult = {
          success: true,
          foods: [{
            name: recognitionResult.data.foodName,
            confidence: parseFloat(recognitionResult.data.confidence.replace('%', '')) / 100,
            estimatedServing: recognitionResult.data.servingSize,
            nutrition: {
              calories: recognitionResult.data.nutrition.calories,
              protein: recognitionResult.data.nutrition.protein,
              carbs: recognitionResult.data.nutrition.carbs,
              fat: recognitionResult.data.nutrition.fat,
              fiber: 0,
              sugar: 0,
              sodium: 0
            }
          }],
          confidence: parseFloat(recognitionResult.data.confidence.replace('%', '')) / 100,
          timestamp: new Date().toISOString(),
          message: 'AI成功識別食物！'
        };
        res.json(formattedResult);
      } else {
        res.status(400).json({
          success: false,
          message: recognitionResult.error
        });
      }
    } catch (error) {
      console.error('Food recognition error:', error);
      
      // 清理上傳的文件
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
 * @route POST /api/food-recognition/analyze-base64
 * @desc Analyze base64 encoded image
 * @access Public (for demo)
 */
router.post('/analyze-base64',
  validateRequest({
    body: {
      image: { required: true, type: 'string' },
      imageType: { required: false, type: 'string' }
    }
  }),
  async (req, res) => {
    try {
      const { image, imageType = 'jpeg' } = req.body;
      
      // 模擬AI食物識別過程
      const mockRecognitionResult = await simulateFoodRecognitionFromBase64(image, imageType);
      
      res.json(mockRecognitionResult);
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
 * @route GET /api/food-recognition/foods
 * @desc Get food database for manual selection
 * @access Public
 */
router.get('/foods',
  validateRequest({
    query: {
      search: { required: false, type: 'string' },
      category: { required: false, type: 'string' },
      limit: { required: false, type: 'number', min: 1, max: 50 }
    }
  }),
  async (req, res) => {
    try {
      const { search, category, limit = 20 } = req.query;
      
      let searchQuery = `
        SELECT f.*, fc.name as category_name
        FROM foods f
        LEFT JOIN food_categories fc ON f.food_category_id = fc.id
        WHERE 1=1
      `;
      
      const queryParams = [];
      let paramIndex = 1;

      if (search) {
        searchQuery += ` AND (f.description ILIKE $${paramIndex} OR f.description_tw ILIKE $${paramIndex})`;
        queryParams.push(`%${search}%`);
        paramIndex++;
      }

      if (category) {
        searchQuery += ` AND f.food_category_id = $${paramIndex}`;
        queryParams.push(category);
        paramIndex++;
      }

      searchQuery += ` ORDER BY f.description ASC LIMIT $${paramIndex}`;
      queryParams.push(limit);

      const result = await query(searchQuery, queryParams);

      res.json({
        success: true,
        foods: result.rows,
        total: result.rows.length
      });
    } catch (error) {
      console.error('Food search error:', error);
      res.status(500).json({
        success: false,
        message: '食物搜尋失敗'
      });
    }
  }
);

/**
 * @route GET /api/food-recognition/nutrition/:foodId
 * @desc Get nutrition data for specific food
 * @access Public
 */
router.get('/nutrition/:foodId',
  validateRequest({
    params: {
      foodId: { required: true, type: 'number' }
    }
  }),
  async (req, res) => {
    try {
      const { foodId } = req.params;
      
      // Get food details
      const foodResult = await query(
        `SELECT f.*, fc.name as category_name
         FROM foods f
         LEFT JOIN food_categories fc ON f.food_category_id = fc.id
         WHERE f.id = $1`,
        [foodId]
      );

      if (foodResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: '食物不存在'
        });
      }

      const food = foodResult.rows[0];

      // Get nutrition information
      const nutritionResult = await query(
        `SELECT fn.*, n.name, n.name_tw, n.unit_name
         FROM food_nutrients fn
         JOIN nutrients n ON fn.nutrient_id = n.id
         WHERE fn.food_id = $1
         ORDER BY n.rank ASC`,
        [foodId]
      );

      // Format nutrition data
      const nutrition = {};
      nutritionResult.rows.forEach(row => {
        const nutrientName = row.name_tw || row.name;
        nutrition[nutrientName] = {
          amount: parseFloat(row.amount),
          unit: row.unit_name
        };
      });

      res.json({
        success: true,
        food: {
          ...food,
          nutrition
        }
      });
    } catch (error) {
      console.error('Nutrition data error:', error);
      res.status(500).json({
        success: false,
        message: '獲取營養數據失敗'
      });
    }
  }
);


module.exports = router;
