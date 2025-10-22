const express = require('express');
const router = express.Router();
const userController = require('../Controllers/UserController');
const { authenticate, isAdmin } = require('../MiddleWares/auth');
const upload = require('../MiddleWares/upload');

/**
 * @route   GET /api/v1/users
 * @desc    Get all users (Admin only)
 * @access  Private/Admin
 */
router.get('/', authenticate, isAdmin, userController.getAllUsers);

/**
 * @route   GET /api/v1/users/:id
 * @desc    Get user by ID
 * @access  Private
 */
router.get('/:id', authenticate, userController.getUserById);

/**
 * @route   PUT /api/v1/users/:id
 * @desc    Update user profile
 * @access  Private
 */
router.put('/:id', authenticate, userController.updateUser);

/**
 * @route   DELETE /api/v1/users/:id
 * @desc    Delete user account
 * @access  Private
 */
router.delete('/:id', authenticate, userController.deleteUser);

/**
 * @route   PUT /api/v1/users/:id/change-password
 * @desc    Change user password
 * @access  Private
 */
router.put('/:id/change-password', authenticate, userController.changePassword);

/**
 * @route   POST /api/v1/users/:id/upload-avatar
 * @desc    Upload user avatar
 * @access  Private
 */
router.post('/:id/upload-avatar', authenticate, upload.single('avatar'), userController.uploadAvatar);

/**
 * @route   POST /api/v1/users (Admin)
 * @desc    Create new user (Admin only)
 * @access  Private/Admin
 */
router.post('/', authenticate, isAdmin, userController.createUser);

module.exports = router;