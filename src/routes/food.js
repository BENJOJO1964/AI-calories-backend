const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const { validateRequest } = require('../middleware/validation');
const { cache } = require('../database/redis');
const { query } = require('../database/connection');
const router = express.Router();

/**
 * @route GET /api/food/search
 * @desc Search foods in database
 * @access Private
 */
router.get('/search',
  authenticateToken,
  validateRequest({
    query: {
      q: { required: true, type: 'string', minLength: 1 },
      limit: { required: false, type: 'number', min: 1, max: 100 },
      offset: { required: false, type: 'number', min: 0 },
      category: { required: false, type: 'string' },
      brand: { required: false, type: 'string' }
    }
  }),
  async (req, res) => {
    try {
      const { q, limit = 20, offset = 0, category, brand } = req.query;
      
      // Check cache first
      const cacheKey = `food_search:${q}:${limit}:${offset}:${category || ''}:${brand || ''}`;
      const cachedResult = await cache.get(cacheKey);
      
      if (cachedResult) {
        return res.json({
          success: true,
          foods: cachedResult.foods,
          total: cachedResult.total,
          fromCache: true
        });
      }

      // Build search query
      let searchQuery = `
        SELECT DISTINCT f.*, fc.name as category_name
        FROM foods f
        LEFT JOIN food_categories fc ON f.food_category_id = fc.id
        WHERE (
          f.description ILIKE $1 
          OR f.description_tw ILIKE $1
          OR f.brand_name ILIKE $1
          OR f.ingredients ILIKE $1
        )
      `;
      
      const queryParams = [`%${q}%`];
      let paramIndex = 2;

      // Add category filter
      if (category) {
        searchQuery += ` AND f.food_category_id = $${paramIndex}`;
        queryParams.push(category);
        paramIndex++;
      }

      // Add brand filter
      if (brand) {
        searchQuery += ` AND f.brand_name ILIKE $${paramIndex}`;
        queryParams.push(`%${brand}%`);
        paramIndex++;
      }

      // Add ordering and pagination
      searchQuery += ` ORDER BY f.description ASC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
      queryParams.push(limit, offset);

      const result = await query(searchQuery, queryParams);

      // Get total count for pagination
      let countQuery = `
        SELECT COUNT(DISTINCT f.id) as total
        FROM foods f
        WHERE (
          f.description ILIKE $1 
          OR f.description_tw ILIKE $1
          OR f.brand_name ILIKE $1
          OR f.ingredients ILIKE $1
        )
      `;
      
      const countParams = [`%${q}%`];
      let countParamIndex = 2;

      if (category) {
        countQuery += ` AND f.food_category_id = $${countParamIndex}`;
        countParams.push(category);
        countParamIndex++;
      }

      if (brand) {
        countQuery += ` AND f.brand_name ILIKE $${countParamIndex}`;
        countParams.push(`%${brand}%`);
      }

      const countResult = await query(countQuery, countParams);
      const total = parseInt(countResult.rows[0].total);

      const response = {
        success: true,
        foods: result.rows,
        total,
        limit: parseInt(limit),
        offset: parseInt(offset),
        hasMore: offset + parseInt(limit) < total
      };

      // Cache the result for 10 minutes
      await cache.set(cacheKey, response, 600);

      // Log search history
      await query(
        'INSERT INTO food_search_history (user_id, search_query, search_results) VALUES ($1, $2, $3)',
        [req.user.id, q, JSON.stringify(response)]
      );

      res.json(response);
    } catch (error) {
      console.error('Food search error:', error);
      res.status(500).json({
        success: false,
        message: '食物搜索失敗'
      });
    }
  }
);

/**
 * @route GET /api/food/:id
 * @desc Get food details by ID
 * @access Private
 */
router.get('/:id',
  authenticateToken,
  validateRequest({
    params: {
      id: { required: true, type: 'number' }
    }
  }),
  async (req, res) => {
    try {
      const { id } = req.params;
      
      // Check cache first
      const cacheKey = `food:${id}`;
      const cachedFood = await cache.get(cacheKey);
      
      if (cachedFood) {
        return res.json({
          success: true,
          food: cachedFood,
          fromCache: true
        });
      }

      // Get food details
      const foodResult = await query(
        `SELECT f.*, fc.name as category_name, fc.name_tw as category_name_tw
         FROM foods f
         LEFT JOIN food_categories fc ON f.food_category_id = fc.id
         WHERE f.id = $1`,
        [id]
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
        [id]
      );

      food.nutrition = nutritionResult.rows;

      // Cache the result for 1 hour
      await cache.set(cacheKey, food, 3600);

      res.json({
        success: true,
        food
      });
    } catch (error) {
      console.error('Food details error:', error);
      res.status(500).json({
        success: false,
        message: '獲取食物詳情失敗'
      });
    }
  }
);

/**
 * @route GET /api/food/categories
 * @desc Get food categories
 * @access Private
 */
router.get('/categories',
  authenticateToken,
  async (req, res) => {
    try {
      // Check cache first
      const cacheKey = 'food_categories';
      const cachedCategories = await cache.get(cacheKey);
      
      if (cachedCategories) {
        return res.json({
          success: true,
          categories: cachedCategories,
          fromCache: true
        });
      }

      const result = await query(
        'SELECT * FROM food_categories ORDER BY name ASC'
      );

      // Cache for 24 hours
      await cache.set(cacheKey, result.rows, 86400);

      res.json({
        success: true,
        categories: result.rows
      });
    } catch (error) {
      console.error('Food categories error:', error);
      res.status(500).json({
        success: false,
        message: '獲取食物分類失敗'
      });
    }
  }
);

/**
 * @route POST /api/food/custom
 * @desc Create custom food
 * @access Private
 */
router.post('/custom',
  authenticateToken,
  validateRequest({
    body: {
      name: { required: true, type: 'string', minLength: 1, maxLength: 200 },
      description: { required: false, type: 'string', maxLength: 500 },
      servingSize: { required: true, type: 'number', min: 0.1 },
      servingUnit: { required: true, type: 'string', minLength: 1, maxLength: 20 },
      caloriesPerServing: { required: false, type: 'number', min: 0 },
      proteinPerServing: { required: false, type: 'number', min: 0 },
      carbsPerServing: { required: false, type: 'number', min: 0 },
      fatPerServing: { required: false, type: 'number', min: 0 },
      fiberPerServing: { required: false, type: 'number', min: 0 },
      sugarPerServing: { required: false, type: 'number', min: 0 },
      sodiumPerServing: { required: false, type: 'number', min: 0 },
      isPublic: { required: false, type: 'boolean' }
    }
  }),
  async (req, res) => {
    try {
      const {
        name,
        description,
        servingSize,
        servingUnit,
        caloriesPerServing,
        proteinPerServing,
        carbsPerServing,
        fatPerServing,
        fiberPerServing,
        sugarPerServing,
        sodiumPerServing,
        isPublic = false
      } = req.body;

      const result = await query(
        `INSERT INTO user_custom_foods (
          user_id, name, description, serving_size, serving_unit,
          calories_per_serving, protein_per_serving, carbs_per_serving,
          fat_per_serving, fiber_per_serving, sugar_per_serving,
          sodium_per_serving, is_public
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        RETURNING *`,
        [
          req.user.id, name, description, servingSize, servingUnit,
          caloriesPerServing, proteinPerServing, carbsPerServing,
          fatPerServing, fiberPerServing, sugarPerServing,
          sodiumPerServing, isPublic
        ]
      );

      res.status(201).json({
        success: true,
        food: result.rows[0],
        message: '自定義食物創建成功'
      });
    } catch (error) {
      console.error('Custom food creation error:', error);
      res.status(500).json({
        success: false,
        message: '創建自定義食物失敗'
      });
    }
  }
);

/**
 * @route GET /api/food/custom
 * @desc Get user's custom foods
 * @access Private
 */
router.get('/custom',
  authenticateToken,
  validateRequest({
    query: {
      limit: { required: false, type: 'number', min: 1, max: 100 },
      offset: { required: false, type: 'number', min: 0 },
      public: { required: false, type: 'boolean' }
    }
  }),
  async (req, res) => {
    try {
      const { limit = 20, offset = 0, public: includePublic = false } = req.query;

      let query = `
        SELECT * FROM user_custom_foods 
        WHERE user_id = $1
      `;
      
      const params = [req.user.id];

      if (includePublic) {
        query += ` OR is_public = true`;
      }

      query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
      params.push(limit, offset);

      const result = await query(query, params);

      res.json({
        success: true,
        foods: result.rows,
        limit: parseInt(limit),
        offset: parseInt(offset)
      });
    } catch (error) {
      console.error('Custom foods error:', error);
      res.status(500).json({
        success: false,
        message: '獲取自定義食物失敗'
      });
    }
  }
);

/**
 * @route PUT /api/food/custom/:id
 * @desc Update custom food
 * @access Private
 */
router.put('/custom/:id',
  authenticateToken,
  validateRequest({
    params: {
      id: { required: true, type: 'uuid' }
    },
    body: {
      name: { required: false, type: 'string', minLength: 1, maxLength: 200 },
      description: { required: false, type: 'string', maxLength: 500 },
      servingSize: { required: false, type: 'number', min: 0.1 },
      servingUnit: { required: false, type: 'string', minLength: 1, maxLength: 20 },
      caloriesPerServing: { required: false, type: 'number', min: 0 },
      proteinPerServing: { required: false, type: 'number', min: 0 },
      carbsPerServing: { required: false, type: 'number', min: 0 },
      fatPerServing: { required: false, type: 'number', min: 0 },
      fiberPerServing: { required: false, type: 'number', min: 0 },
      sugarPerServing: { required: false, type: 'number', min: 0 },
      sodiumPerServing: { required: false, type: 'number', min: 0 },
      isPublic: { required: false, type: 'boolean' }
    }
  }),
  async (req, res) => {
    try {
      const { id } = req.params;
      const updateData = req.body;

      // Check if food exists and belongs to user
      const checkResult = await query(
        'SELECT * FROM user_custom_foods WHERE id = $1 AND user_id = $2',
        [id, req.user.id]
      );

      if (checkResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: '自定義食物不存在或無權限修改'
        });
      }

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
        `UPDATE user_custom_foods 
         SET ${updateFields.join(', ')} 
         WHERE id = $${paramIndex} AND user_id = $${paramIndex + 1}
         RETURNING *`,
        updateValues
      );

      res.json({
        success: true,
        food: result.rows[0],
        message: '自定義食物更新成功'
      });
    } catch (error) {
      console.error('Custom food update error:', error);
      res.status(500).json({
        success: false,
        message: '更新自定義食物失敗'
      });
    }
  }
);

/**
 * @route DELETE /api/food/custom/:id
 * @desc Delete custom food
 * @access Private
 */
router.delete('/custom/:id',
  authenticateToken,
  validateRequest({
    params: {
      id: { required: true, type: 'uuid' }
    }
  }),
  async (req, res) => {
    try {
      const { id } = req.params;

      const result = await query(
        'DELETE FROM user_custom_foods WHERE id = $1 AND user_id = $2 RETURNING id',
        [id, req.user.id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: '自定義食物不存在或無權限刪除'
        });
      }

      res.json({
        success: true,
        message: '自定義食物刪除成功'
      });
    } catch (error) {
      console.error('Custom food deletion error:', error);
      res.status(500).json({
        success: false,
        message: '刪除自定義食物失敗'
      });
    }
  }
);

/**
 * @route GET /api/food/popular
 * @desc Get popular foods
 * @access Private
 */
router.get('/popular',
  authenticateToken,
  validateRequest({
    query: {
      limit: { required: false, type: 'number', min: 1, max: 50 }
    }
  }),
  async (req, res) => {
    try {
      const { limit = 20 } = req.query;

      // Check cache first
      const cacheKey = `popular_foods:${limit}`;
      const cachedFoods = await cache.get(cacheKey);
      
      if (cachedFoods) {
        return res.json({
          success: true,
          foods: cachedFoods,
          fromCache: true
        });
      }

      // Get popular foods based on search history
      const result = await query(
        `SELECT f.*, COUNT(fsh.id) as search_count
         FROM foods f
         JOIN food_search_history fsh ON fsh.search_query ILIKE '%' || f.description || '%'
         WHERE fsh.search_date >= CURRENT_DATE - INTERVAL '30 days'
         GROUP BY f.id
         ORDER BY search_count DESC, f.description ASC
         LIMIT $1`,
        [limit]
      );

      // Cache for 1 hour
      await cache.set(cacheKey, result.rows, 3600);

      res.json({
        success: true,
        foods: result.rows
      });
    } catch (error) {
      console.error('Popular foods error:', error);
      res.status(500).json({
        success: false,
        message: '獲取熱門食物失敗'
      });
    }
  }
);

module.exports = router;
