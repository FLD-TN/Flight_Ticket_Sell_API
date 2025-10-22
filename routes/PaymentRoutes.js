const express = require('express');
const router = express.Router();
const paymentController = require('../Controllers/PaymentController');
const { authenticate } = require('../MiddleWares/auth');

/**
 * @route   POST /api/v1/payment/momo/create
 * @desc    Create MoMo payment
 * @access  Private
 */
router.post('/momo/create', authenticate, paymentController.createMomoPayment);

/**
 * @route   GET /api/v1/payment/momo/callback
 * @desc    MoMo payment callback
 * @access  Public
 */
router.get('/momo/callback', paymentController.momoCallback);

/**
 * @route   POST /api/v1/payment/momo/ipn
 * @desc    MoMo IPN (Instant Payment Notification)
 * @access  Public
 */
router.post('/momo/ipn', paymentController.momoIPN);

/**
 * @route   POST /api/v1/payment/vnpay/create
 * @desc    Create VNPAY payment
 * @access  Private
 */
router.post('/vnpay/create', authenticate, paymentController.createVNPayPayment);

/**
 * @route   GET /api/v1/payment/vnpay/callback
 * @desc    VNPAY payment callback
 * @access  Public
 */
router.get('/vnpay/callback', paymentController.vnpayCallback);

module.exports = router;