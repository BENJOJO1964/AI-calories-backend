const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const { validateRequest } = require('../middleware/validation');
const { cache } = require('../database/redis');
const { query } = require('../database/connection');
const router = express.Router();

/**
 * @route GET /api/nutrition/daily
 * @desc Get daily nutrition data for a specific date
 * @access Private
 */
router.get('/daily',
  authenticateToken,
  validateRequest({
    query: {
      date: { required: true, type: 'string' }, // YYYY-MM-DD format
      includeMeals: { required: false, type: 'boolean' }
    }
  }),
  async (req, res) => {
    try {
      const { date, includeMeals = false } = req.query;
      
      // Validate date format
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(date)) {
        return res.status(400).json({
          success: false,
          message: '日期格式不正確，請使用 YYYY-MM-DD 格式'
        });
      }

      // Check cache first
      const cacheKey = `daily_nutrition:${req.user.id}:${date}`;
      const cachedData = await cache.get(cacheKey);
      
      if (cachedData && !includeMeals) {
        return res.json({
          success: true,
          ...cachedData,
          fromCache: true
        });
      }

      // Get user's target calories and preferences
      const userResult = await query(
        `SELECT u.*, up.calorie_goal, up.protein_goal, up.carb_goal, 
                up.fat_goal, up.fiber_goal, up.sugar_goal, up.sodium_goal
         FROM users u
         LEFT JOIN user_preferences up ON u.id = up.user_id
         WHERE u.id = $1`,
        [req.user.id]
      );

      if (userResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: '用戶不存在'
        });
      }

      const user = userResult.rows[0];

      // Get daily nutrition summary
      const nutritionResult = await query(
        `SELECT 
          COALESCE(SUM(calories), 0) as total_calories,
          COALESCE(SUM(protein), 0) as total_protein,
          COALESCE(SUM(carbs), 0) as total_carbs,
          COALESCE(SUM(fat), 0) as total_fat,
          COALESCE(SUM(fiber), 0) as total_fiber,
          COALESCE(SUM(sugar), 0) as total_sugar,
          COALESCE(SUM(sodium), 0) as total_sodium,
          COUNT(*) as total_foods
        FROM user_food_logs 
        WHERE user_id = $1 AND log_date = $2`,
        [req.user.id, date]
      );

      const nutrition = nutritionResult.rows[0];

      // Calculate targets (use preferences or calculate from user profile)
      const targets = {
        calories: user.calorie_goal || user.target_calories || 2000,
        protein: user.protein_goal || (user.weight ? user.weight * 1.6 : 150),
        carbs: user.carb_goal || (user.target_calories ? user.target_calories * 0.45 / 4 : 250),
        fat: user.fat_goal || (user.target_calories ? user.target_calories * 0.25 / 9 : 67),
        fiber: user.fiber_goal || 25,
        sugar: user.sugar_goal || 50,
        sodium: user.sodium_goal || 2300
      };

      // Calculate percentages
      const percentages = {
        calories: Math.round((nutrition.total_calories / targets.calories) * 100),
        protein: Math.round((nutrition.total_protein / targets.protein) * 100),
        carbs: Math.round((nutrition.total_carbs / targets.carbs) * 100),
        fat: Math.round((nutrition.total_fat / targets.fat) * 100),
        fiber: Math.round((nutrition.total_fiber / targets.fiber) * 100),
        sugar: Math.round((nutrition.total_sugar / targets.sugar) * 100),
        sodium: Math.round((nutrition.total_sodium / targets.sodium) * 100)
      };

      const response = {
        success: true,
        date,
        summary: {
          total: {
            calories: parseFloat(nutrition.total_calories),
            protein: parseFloat(nutrition.total_protein),
            carbs: parseFloat(nutrition.total_carbs),
            fat: parseFloat(nutrition.total_fat),
            fiber: parseFloat(nutrition.total_fiber),
            sugar: parseFloat(nutrition.total_sugar),
            sodium: parseFloat(nutrition.total_sodium)
          },
          targets,
          percentages,
          remaining: {
            calories: Math.max(0, targets.calories - nutrition.total_calories),
            protein: Math.max(0, targets.protein - nutrition.total_protein),
            carbs: Math.max(0, targets.carbs - nutrition.total_carbs),
            fat: Math.max(0, targets.fat - nutrition.total_fat),
            fiber: Math.max(0, targets.fiber - nutrition.total_fiber),
            sugar: Math.max(0, targets.sugar - nutrition.total_sugar),
            sodium: Math.max(0, targets.sodium - nutrition.total_sodium)
          },
          totalFoods: parseInt(nutrition.total_foods)
        }
      };

      // Get meal details if requested
      if (includeMeals) {
        const mealsResult = await query(
          `SELECT ufl.*, f.description as food_name, f.description_tw as food_name_tw
           FROM user_food_logs ufl
           LEFT JOIN foods f ON ufl.food_id = f.id
           WHERE ufl.user_id = $1 AND ufl.log_date = $2
           ORDER BY ufl.meal_type, ufl.log_time ASC`,
          [req.user.id, date]
        );

        // Group by meal type
        const meals = {
          breakfast: [],
          lunch: [],
          dinner: [],
          snack: []
        };

        mealsResult.rows.forEach(log => {
          if (meals[log.meal_type]) {
            meals[log.meal_type].push(log);
          }
        });

        response.meals = meals;
      }

      // Cache the result for 5 minutes
      await cache.set(cacheKey, response, 300);

      res.json(response);
    } catch (error) {
      console.error('Daily nutrition error:', error);
      res.status(500).json({
        success: false,
        message: '獲取每日營養數據失敗'
      });
    }
  }
);

/**
 * @route POST /api/nutrition/log
 * @desc Log food intake
 * @access Private
 */
router.post('/log',
  authenticateToken,
  validateRequest({
    body: {
      foodId: { required: false, type: 'number' },
      customFoodId: { required: false, type: 'uuid' },
      customFoodName: { required: false, type: 'string', maxLength: 200 },
      amount: { required: true, type: 'number', min: 0.1 },
      unit: { required: true, type: 'string', minLength: 1, maxLength: 20 },
      mealType: { required: true, type: 'string', enum: ['breakfast', 'lunch', 'dinner', 'snack'] },
      logDate: { required: true, type: 'string' }, // YYYY-MM-DD
      logTime: { required: false, type: 'string' }, // HH:MM:SS
      calories: { required: false, type: 'number', min: 0 },
      protein: { required: false, type: 'number', min: 0 },
      carbs: { required: false, type: 'number', min: 0 },
      fat: { required: false, type: 'number', min: 0 },
      fiber: { required: false, type: 'number', min: 0 },
      sugar: { required: false, type: 'number', min: 0 },
      sodium: { required: false, type: 'number', min: 0 }
    }
  }),
  async (req, res) => {
    try {
      const {
        foodId,
        customFoodId,
        customFoodName,
        amount,
        unit,
        mealType,
        logDate,
        logTime,
        calories,
        protein,
        carbs,
        fat,
        fiber,
        sugar,
        sodium
      } = req.body;

      // Validate date format
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(logDate)) {
        return res.status(400).json({
          success: false,
          message: '日期格式不正確，請使用 YYYY-MM-DD 格式'
        });
      }

      // Ensure at least one food source is provided
      if (!foodId && !customFoodId && !customFoodName) {
        return res.status(400).json({
          success: false,
          message: '必須提供食物ID或自定義食物信息'
        });
      }

      // If custom food, get nutrition info
      let nutritionData = {
        calories: calories || 0,
        protein: protein || 0,
        carbs: carbs || 0,
        fat: fat || 0,
        fiber: fiber || 0,
        sugar: sugar || 0,
        sodium: sodium || 0
      };

      if (customFoodId) {
        const customFoodResult = await query(
          'SELECT * FROM user_custom_foods WHERE id = $1 AND user_id = $2',
          [customFoodId, req.user.id]
        );

        if (customFoodResult.rows.length === 0) {
          return res.status(404).json({
            success: false,
            message: '自定義食物不存在'
          });
        }

        const customFood = customFoodResult.rows[0];
        nutritionData = {
          calories: (customFood.calories_per_serving || 0) * amount,
          protein: (customFood.protein_per_serving || 0) * amount,
          carbs: (customFood.carbs_per_serving || 0) * amount,
          fat: (customFood.fat_per_serving || 0) * amount,
          fiber: (customFood.fiber_per_serving || 0) * amount,
          sugar: (customFood.sugar_per_serving || 0) * amount,
          sodium: (customFood.sodium_per_serving || 0) * amount
        };
      } else if (foodId) {
        // Get nutrition info from food database
        const nutritionResult = await query(
          `SELECT fn.amount, n.name, n.unit_name
           FROM food_nutrients fn
           JOIN nutrients n ON fn.nutrient_id = n.id
           WHERE fn.food_id = $1 AND n.name IN (
             'Energy (kcal)', 'Protein', 'Carbohydrate, by difference',
             'Total lipid (fat)', 'Fiber, total dietary', 'Sugars, total',
             'Sodium, Na'
           )`,
          [foodId]
        );

        // Calculate nutrition based on serving size
        nutritionResult.rows.forEach(row => {
          const nutrientAmount = parseFloat(row.amount) * amount;
          switch (row.name) {
            case 'Energy (kcal)':
              nutritionData.calories = nutrientAmount;
              break;
            case 'Protein':
              nutritionData.protein = nutrientAmount;
              break;
            case 'Carbohydrate, by difference':
              nutritionData.carbs = nutrientAmount;
              break;
            case 'Total lipid (fat)':
              nutritionData.fat = nutrientAmount;
              break;
            case 'Fiber, total dietary':
              nutritionData.fiber = nutrientAmount;
              break;
            case 'Sugars, total':
              nutritionData.sugar = nutrientAmount;
              break;
            case 'Sodium, Na':
              nutritionData.sodium = nutrientAmount;
              break;
          }
        });
      }

      // Insert food log
      const result = await query(
        `INSERT INTO user_food_logs (
          user_id, food_id, custom_food_name, amount, unit, meal_type,
          log_date, log_time, calories, protein, carbs, fat, fiber, sugar, sodium
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
        RETURNING *`,
        [
          req.user.id, foodId, customFoodName, amount, unit, mealType,
          logDate, logTime || null, nutritionData.calories, nutritionData.protein,
          nutritionData.carbs, nutritionData.fat, nutritionData.fiber,
          nutritionData.sugar, nutritionData.sodium
        ]
      );

      // Clear cache for this date
      const cacheKey = `daily_nutrition:${req.user.id}:${logDate}`;
      await cache.del(cacheKey);

      res.status(201).json({
        success: true,
        log: result.rows[0],
        nutrition: nutritionData,
        message: '食物記錄添加成功'
      });
    } catch (error) {
      console.error('Food logging error:', error);
      res.status(500).json({
        success: false,
        message: '記錄食物失敗'
      });
    }
  }
);

/**
 * @route PUT /api/nutrition/log/:id
 * @desc Update food log entry
 * @access Private
 */
router.put('/log/:id',
  authenticateToken,
  validateRequest({
    params: {
      id: { required: true, type: 'uuid' }
    },
    body: {
      amount: { required: false, type: 'number', min: 0.1 },
      unit: { required: false, type: 'string', minLength: 1, maxLength: 20 },
      mealType: { required: false, type: 'string', enum: ['breakfast', 'lunch', 'dinner', 'snack'] },
      logTime: { required: false, type: 'string' }
    }
  }),
  async (req, res) => {
    try {
      const { id } = req.params;
      const updateData = req.body;

      // Check if log exists and belongs to user
      const checkResult = await query(
        'SELECT * FROM user_food_logs WHERE id = $1 AND user_id = $2',
        [id, req.user.id]
      );

      if (checkResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: '食物記錄不存在或無權限修改'
        });
      }

      const existingLog = checkResult.rows[0];

      // Build update query dynamically
      const updateFields = [];
      const updateValues = [];
      let paramIndex = 1;

      Object.keys(updateData).forEach(key => {
        if (updateData[key] !== undefined) {
          updateFields.push(`${key} = $${paramIndex}`);
          updateValues.push(updateData[key]);
          paramIndex++;
        }
      });

      if (updateFields.length === 0) {
        return res.status(400).json({
          success: false,
          message: '沒有提供要更新的數據'
        });
      }

      updateFields.push(`updated_at = CURRENT_TIMESTAMP`);
      updateValues.push(id, req.user.id);

      const result = await query(
        `UPDATE user_food_logs 
         SET ${updateFields.join(', ')} 
         WHERE id = $${paramIndex} AND user_id = $${paramIndex + 1}
         RETURNING *`,
        updateValues
      );

      // Clear cache for this date
      const cacheKey = `daily_nutrition:${req.user.id}:${existingLog.log_date}`;
      await cache.del(cacheKey);

      res.json({
        success: true,
        log: result.rows[0],
        message: '食物記錄更新成功'
      });
    } catch (error) {
      console.error('Food log update error:', error);
      res.status(500).json({
        success: false,
        message: '更新食物記錄失敗'
      });
    }
  }
);

/**
 * @route DELETE /api/nutrition/log/:id
 * @desc Delete food log entry
 * @access Private
 */
router.delete('/log/:id',
  authenticateToken,
  validateRequest({
    params: {
      id: { required: true, type: 'uuid' }
    }
  }),
  async (req, res) => {
    try {
      const { id } = req.params;

      // Get log date before deletion for cache clearing
      const logResult = await query(
        'SELECT log_date FROM user_food_logs WHERE id = $1 AND user_id = $2',
        [id, req.user.id]
      );

      if (logResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: '食物記錄不存在或無權限刪除'
        });
      }

      const logDate = logResult.rows[0].log_date;

      const result = await query(
        'DELETE FROM user_food_logs WHERE id = $1 AND user_id = $2 RETURNING id',
        [id, req.user.id]
      );

      // Clear cache for this date
      const cacheKey = `daily_nutrition:${req.user.id}:${logDate}`;
      await cache.del(cacheKey);

      res.json({
        success: true,
        message: '食物記錄刪除成功'
      });
    } catch (error) {
      console.error('Food log deletion error:', error);
      res.status(500).json({
        success: false,
        message: '刪除食物記錄失敗'
      });
    }
  }
);

/**
 * @route GET /api/nutrition/trends
 * @desc Get nutrition trends over time
 * @access Private
 */
router.get('/trends',
  authenticateToken,
  validateRequest({
    query: {
      period: { required: false, type: 'number', min: 7, max: 365 }, // days
      startDate: { required: false, type: 'string' },
      endDate: { required: false, type: 'string' }
    }
  }),
  async (req, res) => {
    try {
      const { period = 30, startDate, endDate } = req.query;

      let dateCondition = '';
      let queryParams = [req.user.id];

      if (startDate && endDate) {
        dateCondition = 'AND log_date BETWEEN $2 AND $3';
        queryParams.push(startDate, endDate);
      } else {
        dateCondition = `AND log_date >= CURRENT_DATE - INTERVAL '${period} days'`;
      }

      const result = await query(
        `SELECT 
          log_date,
          SUM(calories) as calories,
          SUM(protein) as protein,
          SUM(carbs) as carbs,
          SUM(fat) as fat,
          SUM(fiber) as fiber,
          SUM(sugar) as sugar,
          SUM(sodium) as sodium,
          COUNT(*) as food_count
        FROM user_food_logs 
        WHERE user_id = $1 ${dateCondition}
        GROUP BY log_date 
        ORDER BY log_date ASC`,
        queryParams
      );

      res.json({
        success: true,
        trends: result.rows.map(row => ({
          date: row.log_date,
          calories: parseFloat(row.calories),
          protein: parseFloat(row.protein),
          carbs: parseFloat(row.carbs),
          fat: parseFloat(row.fat),
          fiber: parseFloat(row.fiber),
          sugar: parseFloat(row.sugar),
          sodium: parseFloat(row.sodium),
          foodCount: parseInt(row.food_count)
        })),
        period: period,
        totalDays: result.rows.length
      });
    } catch (error) {
      console.error('Nutrition trends error:', error);
      res.status(500).json({
        success: false,
        message: '獲取營養趨勢失敗'
      });
    }
  }
);

/**
 * @route GET /api/nutrition/weekly-summary
 * @desc Get weekly nutrition summary
 * @access Private
 */
router.get('/weekly-summary',
  authenticateToken,
  validateRequest({
    query: {
      weekStart: { required: false, type: 'string' } // YYYY-MM-DD
    }
  }),
  async (req, res) => {
    try {
      const { weekStart } = req.query;
      
      let startDate;
      if (weekStart) {
        startDate = weekStart;
      } else {
        // Get current week start (Monday)
        const today = new Date();
        const dayOfWeek = today.getDay();
        const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
        const monday = new Date(today);
        monday.setDate(today.getDate() - daysToMonday);
        startDate = monday.toISOString().split('T')[0];
      }

      const endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + 6);
      const endDateStr = endDate.toISOString().split('T')[0];

      // Check cache first
      const cacheKey = `weekly_summary:${req.user.id}:${startDate}`;
      const cachedData = await cache.get(cacheKey);
      
      if (cachedData) {
        return res.json({
          success: true,
          ...cachedData,
          fromCache: true
        });
      }

      const result = await query(
        `SELECT 
          log_date,
          SUM(calories) as calories,
          SUM(protein) as protein,
          SUM(carbs) as carbs,
          SUM(fat) as fat,
          SUM(fiber) as fiber,
          SUM(sugar) as sugar,
          SUM(sodium) as sodium,
          COUNT(*) as food_count
        FROM user_food_logs 
        WHERE user_id = $1 AND log_date BETWEEN $2 AND $3
        GROUP BY log_date 
        ORDER BY log_date ASC`,
        [req.user.id, startDate, endDateStr]
      );

      // Calculate weekly totals and averages
      const weeklyData = {
        total: {
          calories: 0,
          protein: 0,
          carbs: 0,
          fat: 0,
          fiber: 0,
          sugar: 0,
          sodium: 0,
          foodCount: 0
        },
        average: {
          calories: 0,
          protein: 0,
          carbs: 0,
          fat: 0,
          fiber: 0,
          sugar: 0,
          sodium: 0
        },
        dailyData: result.rows.map(row => ({
          date: row.log_date,
          calories: parseFloat(row.calories),
          protein: parseFloat(row.protein),
          carbs: parseFloat(row.carbs),
          fat: parseFloat(row.fat),
          fiber: parseFloat(row.fiber),
          sugar: parseFloat(row.sugar),
          sodium: parseFloat(row.sodium),
          foodCount: parseInt(row.food_count)
        }))
      };

      // Calculate totals
      weeklyData.dailyData.forEach(day => {
        weeklyData.total.calories += day.calories;
        weeklyData.total.protein += day.protein;
        weeklyData.total.carbs += day.carbs;
        weeklyData.total.fat += day.fat;
        weeklyData.total.fiber += day.fiber;
        weeklyData.total.sugar += day.sugar;
        weeklyData.total.sodium += day.sodium;
        weeklyData.total.foodCount += day.foodCount;
      });

      // Calculate averages
      const daysWithData = weeklyData.dailyData.length || 1;
      weeklyData.average.calories = Math.round(weeklyData.total.calories / daysWithData);
      weeklyData.average.protein = Math.round(weeklyData.total.protein / daysWithData);
      weeklyData.average.carbs = Math.round(weeklyData.total.carbs / daysWithData);
      weeklyData.average.fat = Math.round(weeklyData.total.fat / daysWithData);
      weeklyData.average.fiber = Math.round(weeklyData.total.fiber / daysWithData);
      weeklyData.average.sugar = Math.round(weeklyData.total.sugar / daysWithData);
      weeklyData.average.sodium = Math.round(weeklyData.total.sodium / daysWithData);

      const response = {
        success: true,
        weekStart: startDate,
        weekEnd: endDateStr,
        summary: weeklyData
      };

      // Cache for 1 hour
      await cache.set(cacheKey, response, 3600);

      res.json(response);
    } catch (error) {
      console.error('Weekly summary error:', error);
      res.status(500).json({
        success: false,
        message: '獲取週營養摘要失敗'
      });
    }
  }
);

module.exports = router;
