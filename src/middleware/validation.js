// 簡化的驗證中間件
const validateRequest = (schema) => {
  return (req, res, next) => {
    // 暫時跳過驗證，直接通過
    next();
  };
};

module.exports = {
  validateRequest
};
