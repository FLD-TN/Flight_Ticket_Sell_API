const express = require('express');
const router = express.Router();
const ticketController = require('../Controllers/TicketController');
const { authenticate, isAdmin } = require('../MiddleWares/auth');

/**
 * @route   POST /api/v1/tickets
 * @desc    Book/Create a ticket
 * @access  Private
 */
router.post('/', authenticate, ticketController.createTicket);

/**
 * @route   GET /api/v1/tickets
 * @desc    Get all tickets (Admin) or user's tickets
 * @access  Private
 */
router.get('/', authenticate, ticketController.getTickets);

/**
 * @route   GET /api/v1/tickets/:id
 * @desc    Get ticket by ID
 * @access  Private
 */
router.get('/:id', authenticate, ticketController.getTicketById);

/**
 * @route   PUT /api/v1/tickets/:id
 * @desc    Update ticket (Admin only)
 * @access  Private/Admin
 */
router.put('/:id', authenticate, isAdmin, ticketController.updateTicket);

/**
 * @route   DELETE /api/v1/tickets/:id
 * @desc    Cancel ticket
 * @access  Private
 */
router.delete('/:id', authenticate, ticketController.cancelTicket);

/**
 * @route   GET /api/v1/tickets/user/:userId
 * @desc    Get tickets by user ID
 * @access  Private
 */
router.get('/user/:userId', authenticate, ticketController.getTicketsByUserId);

module.exports = router;