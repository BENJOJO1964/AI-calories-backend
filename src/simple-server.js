const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Basic middleware
app.use(cors());
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Basic food recognition endpoint
app.post('/api/food-recognition/analyze', (req, res) => {
  res.json({
    success: true,
    message: 'Backend is working, but AI service not configured',
    foods: [{
      name: 'Test Food',
      confidence: 0.95,
      estimatedServing: '1 portion',
      nutrition: {
        calories: 100,
        protein: 5,
        carbs: 15,
        fat: 3
      }
    }]
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📱 Environment: ${process.env.NODE_ENV || 'development'}`);
});

module.exports = app;
