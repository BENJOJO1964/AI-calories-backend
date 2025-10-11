const express = require('express');
const app = express();

app.get('/', (req, res) => {
  res.json({ 
    message: 'SIMPLE TEST WORKING!',
    timestamp: new Date().toISOString(),
    version: 'test-v1'
  });
});

// 對於 Vercel，不需要 app.listen
if (!process.env.VERCEL) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`Test server running on port ${port}`);
  });
}

module.exports = app;
