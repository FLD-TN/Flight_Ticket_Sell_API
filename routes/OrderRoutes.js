const express = require('express');
const router = express.Router();
const orderController = require('../Controllers/OrderController');
const { authenticate, isAdmin } = require('../MiddleWares/auth');

/**
 * @route   POST /api/v1/orders
 * @desc    Create new order
 * @access  Private
 */
router.post('/', authenticate, orderController.createOrder);

/**
 * @route   GET /api/v1/orders
 * @desc    Get all orders (Admin) or user's orders
 * @access  Private
 */
router.get('/', authenticate, orderController.getOrders);

/**
 * @route   GET /api/v1/orders/:id
 * @desc    Get order by ID
 * @access  Private
 */
router.get('/:id', authenticate, orderController.getOrderById);

/**
 * @route   PUT /api/v1/orders/:id
 * @desc    Update order status
 * @access  Private
 */
router.put('/:id', authenticate, orderController.updateOrder);

/**
 * @route   DELETE /api/v1/orders/:id
 * @desc    Cancel order
 * @access  Private
 */
router.delete('/:id', authenticate, orderController.cancelOrder);

/**
 * @route   GET /api/v1/orders/user/:userId
 * @desc    Get orders by user ID
 * @access  Private
 */
router.get('/user/:userId', authenticate, orderController.getOrdersByUserId);

/**
 * @route   GET /api/v1/orders/:id/invoice
 * @desc    Get order invoice
 * @access  Private
 */
router.get('/:id/invoice', authenticate, orderController.getInvoice);

module.exports = router;