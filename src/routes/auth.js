const express = require('express');
const router = express.Router();

// 簡化的認證路由 - 暫時返回成功狀態
router.post('/login', (req, res) => {
  res.json({
    success: true,
    message: 'Login endpoint ready',
    token: 'demo-token'
  });
});

router.post('/register', (req, res) => {
  res.json({
    success: true,
    message: 'Register endpoint ready',
    token: 'demo-token'
  });
});

router.get('/verify', (req, res) => {
  res.json({
    success: true,
    message: 'Token verification endpoint ready'
  });
});

module.exports = router;
