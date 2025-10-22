const express = require('express');
const router = express.Router();
const flightController = require('../Controllers/FlightController');
const { authenticate, isAdmin, optionalAuth } = require('../MiddleWares/auth');

/**
 * @route   GET /api/v1/flights/search
 * @desc    Search flights
 * @access  Public
 */
router.get('/search', optionalAuth, flightController.searchFlights);

/**
 * @route   GET /api/v1/flights
 * @desc    Get all flights with pagination
 * @access  Public
 */
router.get('/', optionalAuth, flightController.getAllFlights);

/**
 * @route   GET /api/v1/flights/:id
 * @desc    Get flight by ID
 * @access  Public
 */
router.get('/:id', optionalAuth, flightController.getFlightById);

/**
 * @route   GET /api/v1/flights/number/:flightNumber
 * @desc    Get flight by flight number
 * @access  Public
 */
router.get('/number/:flightNumber', optionalAuth, flightController.getFlightByNumber);

/**
 * @route   POST /api/v1/flights
 * @desc    Create new flight (Admin only)
 * @access  Private/Admin
 */
router.post('/', authenticate, isAdmin, flightController.createFlight);

/**
 * @route   PUT /api/v1/flights/:id
 * @desc    Update flight (Admin only)
 * @access  Private/Admin
 */
router.put('/:id', authenticate, isAdmin, flightController.updateFlight);

/**
 * @route   DELETE /api/v1/flights/:id
 * @desc    Delete flight (Admin only)
 * @access  Private/Admin
 */
router.delete('/:id', authenticate, isAdmin, flightController.deleteFlight);

/**
 * @route   GET /api/v1/flights/cheapest
 * @desc    Get cheapest flights for a route
 * @access  Public
 */
router.post('/cheapest', flightController.getCheapestFlights);

module.exports = router;