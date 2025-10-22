const express = require('express');
const router = express.Router();
const notificationController = require('../Controllers/NotificationController');
const { authenticate } = require('../MiddleWares/auth');

/**
 * @route   GET /api/v1/notifications
 * @desc    Get user's notifications
 * @access  Private
 */
router.get('/', authenticate, notificationController.getNotifications);

/**
 * @route   PUT /api/v1/notifications/:id/read
 * @desc    Mark notification as read
 * @access  Private
 */
router.put('/:id/read', authenticate, notificationController.markAsRead);

/**
 * @route   DELETE /api/v1/notifications/:id
 * @desc    Delete notification
 * @access  Private
 */
router.delete('/:id', authenticate, notificationController.deleteNotification);

/**
 * @route   DELETE /api/v1/notifications
 * @desc    Delete all user's notifications
 * @access  Private
 */
router.delete('/', authenticate, notificationController.deleteAllNotifications);

/**
 * @route   GET /api/v1/notifications/unread/count
 * @desc    Get unread notification count
 * @access  Private
 */
router.get('/unread/count', authenticate, notificationController.getUnreadCount);

module.exports = router;