const OpenAI = require('openai');

module.exports = async (req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  try {
    console.log('收到圖片上傳請求 - 使用真實AI分析');
    console.log('OpenAI API Key存在:', !!process.env.OPENAI_API_KEY);
    
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({
        success: false,
        message: 'OpenAI API Key 未配置'
      });
    }

    // 這裡需要處理 multipart/form-data，但 Vercel 的 serverless 函數不直接支持
    // 所以我們需要一個不同的方法
    return res.status(501).json({
      success: false,
      message: '需要實現 multipart/form-data 處理'
    });

  } catch (error) {
    console.error('AI分析錯誤:', error);
    res.status(500).json({
      success: false,
      message: `AI分析失敗: ${error.message}`
    });
  }
};
