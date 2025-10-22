const express = require('express');
const router = express.Router();
const statisticsController = require('../Controllers/statisticsController');

// 1. Import middleware xác thực của bạn
const { authenticate, isAdmin } = require('../MiddleWares/auth');

// 2. Thêm authenticate và isAdmin vào route
router.get(
    '/all',
    authenticate, // Đảm bảo người dùng đã đăng nhập
    isAdmin,      // Đảm bảo người dùng là Admin
    statisticsController.getStatistics
);

module.exports = router;