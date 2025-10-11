module.exports = (req, res) => {
  res.json({
    message: 'This is a new serverless function',
    timestamp: new Date().toISOString()
  });
};

