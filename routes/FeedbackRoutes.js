const express = require('express');
const router = express.Router();
const feedbackController = require('../Controllers/FeedbackController');
const { authenticate, isAdmin, optionalAuth } = require('../MiddleWares/auth');

/**
 * @route   POST /api/v1/feedbacks
 * @desc    Create feedback
 * @access  Private
 */
router.post('/', authenticate, feedbackController.createFeedback);

/**
 * @route   GET /api/v1/feedbacks
 * @desc    Get all feedbacks
 * @access  Public
 */
router.get('/', optionalAuth, feedbackController.getFeedbacks);

/**
 * @route   GET /api/v1/feedbacks/:id
 * @desc    Get feedback by ID
 * @access  Public
 */
router.get('/:id', optionalAuth, feedbackController.getFeedbackById);

/**
 * @route   DELETE /api/v1/feedbacks/:id
 * @desc    Delete feedback (Admin only)
 * @access  Private/Admin
 */
router.delete('/:id', authenticate, isAdmin, feedbackController.deleteFeedback);

module.exports = router;