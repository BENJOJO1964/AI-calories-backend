module.exports = (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    version: 'api-health-v1',
    hasOpenAIKey: !!process.env.OPENAI_API_KEY
  });
};
