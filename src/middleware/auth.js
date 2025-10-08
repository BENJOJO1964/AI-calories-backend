// 簡化的認證中間件
const authenticateToken = (req, res, next) => {
  // 暫時跳過認證，直接通過
  req.user = { id: 'demo-user', name: 'Demo User' };
  next();
};

module.exports = {
  authenticateToken
};
