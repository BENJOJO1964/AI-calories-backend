const express = require('express');
const router = express.Router();

// 簡化的用戶路由 - 暫時返回成功狀態
router.get('/profile', (req, res) => {
  res.json({
    success: true,
    message: 'User profile endpoint ready',
    user: {
      id: 'demo-user',
      name: 'Demo User'
    }
  });
});

router.put('/profile', (req, res) => {
  res.json({
    success: true,
    message: 'Update profile endpoint ready'
  });
});

router.get('/stats', (req, res) => {
  res.json({
    success: true,
    message: 'User stats endpoint ready',
    stats: {
      totalMeals: 0,
      totalCalories: 0
    }
  });
});

module.exports = router;
